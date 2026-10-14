import "server-only";
import { cache } from "react";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getTemplateByKey, type TemplateKey } from "@/lib/theme-engine/alternates";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { localDay, timeZoneOffsetMinutes } from "@/lib/theme-schedules/rules";
import { assignVariant, EXPERIMENT_GOALS, GOAL_METRIC, type ExperimentGoal, type ExperimentMetric, type VariantKey } from "./assign";
import { applyVariant, parseVariants, sectionIsPresent, variantLabel, type ExperimentVariant } from "./rules";
import { analyzeExperiment, daysBetween, type ExperimentVerdict } from "./stats";

/**
 * Lot 4 §13 : résolution des tests A/B au rendu, comptage des événements, agrégation et résultats.
 *
 * Principes de sécurité :
 *  - l'affectation est TOUJOURS recalculée côté serveur à partir du cookie `axi_vid` (le client n'envoie que
 *    l'identifiant du test ; il ne peut pas choisir sa variante ni gonfler une autre variante) ;
 *  - dédoublonnage par visiteur, par jour et par métrique, débit limité par IP, robots ignorés ;
 *  - les compteurs ne déclenchent aucune action payante ;
 *  - toutes les lectures sont filtrées par `storeId`.
 */

export type RunningExperiment = {
  id: string;
  name: string;
  template: TemplateKey;
  sectionId: string;
  goal: ExperimentGoal;
  startedAt: Date | null;
  variants: ExperimentVariant[];
};

function toRunning(row: { id: string; name: string; template: string; sectionId: string; goal: string; startedAt: Date | null; variants: unknown }): RunningExperiment | null {
  const variants = parseVariants(row.variants);
  if (variants.length < 2) return null;
  const goal = (EXPERIMENT_GOALS as readonly string[]).includes(row.goal) ? (row.goal as ExperimentGoal) : "ORDER";
  return { id: row.id, name: row.name, template: row.template as TemplateKey, sectionId: row.sectionId, goal, startedAt: row.startedAt, variants };
}

/** Tests en cours de la boutique (mémorisé pour la durée de la requête). */
export const runningExperiments = cache(async (storeId: string): Promise<RunningExperiment[]> => {
  try {
    const rows = await db.experiment.findMany({
      where: { storeId, status: "RUNNING" },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, name: true, template: true, sectionId: true, goal: true, startedAt: true, variants: true },
    });
    return rows.map(toRunning).filter((e): e is RunningExperiment => !!e);
  } catch {
    return []; // la boutique ne doit jamais tomber à cause d'un test
  }
});

/* ───────────── Rendu ───────────── */

export type ExperimentAssignment = {
  experimentId: string;
  variantKey: VariantKey;
  /** Section testée. */
  sectionId: string;
  /** Élément à observer pour compter l'exposition (la section elle-même, ou la suivante si la variante la masque). */
  anchorId: string;
  goal: ExperimentGoal;
};

/**
 * Applique les tests en cours au document et renvoie les affectations à observer côté client.
 * Un test dont la section est absente du modèle rendu (thème programmé, modèle alternatif) est ignoré : il est
 * donc naturellement suspendu, sans écriture.
 */
export async function resolveExperiments(
  storeId: string,
  opts: { doc: ThemeDocument; templateKey: TemplateKey; visitorId: string | null },
): Promise<{ doc: ThemeDocument; assignments: ExperimentAssignment[] }> {
  if (!opts.visitorId) return { doc: opts.doc, assignments: [] };
  const all = await runningExperiments(storeId);
  if (all.length === 0) return { doc: opts.doc, assignments: [] };

  let doc = opts.doc;
  const assignments: ExperimentAssignment[] = [];
  for (const exp of all) {
    if (exp.template !== opts.templateKey) continue;
    if (!sectionIsPresent(doc, opts.templateKey, exp.sectionId)) continue;
    const variant = assignVariant(exp.variants, opts.visitorId, exp.id);
    if (!variant) continue;
    const before = getTemplateByKey(doc, opts.templateKey);
    const index = before ? before.order.indexOf(exp.sectionId) : -1;
    doc = applyVariant(doc, opts.templateKey, exp.sectionId, variant);
    const after = getTemplateByKey(doc, opts.templateKey);
    // Variante « masquée » : on observe la section suivante (sinon la précédente) pour compter l'exposition.
    let anchorId = exp.sectionId;
    if (after && !after.order.includes(exp.sectionId)) {
      anchorId = after.order[index] ?? after.order[index - 1] ?? "";
    }
    if (!anchorId) continue;
    assignments.push({ experimentId: exp.id, variantKey: variant.key, sectionId: exp.sectionId, anchorId, goal: exp.goal });
  }
  return { doc, assignments };
}

/** Identifiant visiteur cryptographique (128 bits) posé par le navigateur (cookie `axi_vid`, 1 an). */
export function freshVisitorId(): string {
  return randomBytes(16).toString("hex");
}

/* ───────────── Comptage ───────────── */

/** Secondes restantes avant la fin de la journée dans le fuseau de la boutique (fenêtre de dédoublonnage). */
export function secondsToEndOfDay(now: Date, timeZone: string): number {
  const localMs = now.getTime() + timeZoneOffsetMinutes(now, timeZone) * 60_000;
  const elapsed = ((localMs % 86_400_000) + 86_400_000) % 86_400_000;
  return Math.max(60, Math.min(86_400, Math.ceil((86_400_000 - elapsed) / 1000)));
}

/** Mémoire « ce visiteur a vu ce test » (30 jours) : sert à n'attribuer une commande qu'aux tests réellement vus. */
const SEEN_WINDOW_SEC = 30 * 24 * 3600;
const seenKey = (experimentId: string, visitorId: string) => `expseen:${experimentId}:${visitorId}`;

async function incrementStat(experimentId: string, variantKey: string, day: string, metric: ExperimentMetric) {
  await db.experimentStat.upsert({
    where: { experimentId_variantKey_day_metric: { experimentId, variantKey, day, metric } },
    create: { experimentId, variantKey, day, metric, count: 1 },
    update: { count: { increment: 1 } },
  });
}

export type EventResult = "counted" | "duplicate" | "ignored";

/**
 * Compte un événement de balise (exposition ou conversion client). L'affectation est recalculée ici : la variante
 * envoyée par le client, si elle existe, est ignorée.
 */
export async function recordBeaconEvent(args: {
  store: { id: string; timezone: string };
  experimentId: string;
  metric: Extract<ExperimentMetric, "exposure" | "add_to_cart" | "checkout_start">;
  visitorId: string;
  now?: Date;
}): Promise<EventResult> {
  const now = args.now ?? new Date();
  const experiments = await runningExperiments(args.store.id);
  const exp = experiments.find((e) => e.id === args.experimentId);
  if (!exp) return "ignored";
  const variant = assignVariant(exp.variants, args.visitorId, exp.id);
  if (!variant) return "ignored";

  const day = localDay(now, args.store.timezone);
  const dedup = await rateLimit(`exp:${exp.id}:${args.metric}:${args.visitorId}:${day}`, 1, secondsToEndOfDay(now, args.store.timezone));
  if (!dedup.ok) return "duplicate";

  if (args.metric === "exposure") await rateLimit(seenKey(exp.id, args.visitorId), 1, SEEN_WINDOW_SEC);
  await incrementStat(exp.id, variant.key, day, args.metric);
  return "counted";
}

/**
 * Conversion « commande » côté serveur (lot 4 §13) : appelée à l'affichage de la confirmation de commande.
 * Idempotente : l'attribution est écrite une seule fois dans `Order.attribution.experiments`.
 * N'attribue qu'aux tests que CE visiteur a réellement vus (mémoire d'exposition de 30 jours).
 */
export async function recordOrderConversion(args: { store: { id: string; timezone: string }; orderId: string; visitorId: string | null; now?: Date }): Promise<EventResult> {
  if (!args.visitorId) return "ignored";
  const now = args.now ?? new Date();
  const order = await db.order.findFirst({ where: { id: args.orderId, storeId: args.store.id }, select: { id: true, attribution: true, createdAt: true } });
  if (!order) return "ignored";
  const attribution = (order.attribution && typeof order.attribution === "object" && !Array.isArray(order.attribution) ? (order.attribution as Record<string, unknown>) : {}) as Record<string, unknown>;
  if (Array.isArray(attribution.experiments)) return "duplicate"; // déjà attribuée

  // Verrou d'idempotence persistant (la page de confirmation peut être rechargée) : un seul comptage par commande.
  const once = await rateLimit(`exporder:${order.id}`, 1, 30 * 24 * 3600);
  if (!once.ok) return "duplicate";

  const experiments = await runningExperiments(args.store.id);
  if (experiments.length === 0) return "ignored";

  const keys = experiments.map((e) => seenKey(e.id, args.visitorId!));
  const seen = new Set((await db.rateLimit.findMany({ where: { key: { in: keys }, resetAt: { gt: now } }, select: { key: true } })).map((r) => r.key));

  const attributed: { experimentId: string; variantKey: VariantKey }[] = [];
  for (const exp of experiments) {
    if (!seen.has(seenKey(exp.id, args.visitorId))) continue;
    const variant = assignVariant(exp.variants, args.visitorId, exp.id);
    if (!variant) continue;
    attributed.push({ experimentId: exp.id, variantKey: variant.key });
  }
  if (attributed.length === 0) return "ignored";

  const day = localDay(order.createdAt, args.store.timezone);
  await db.order.updateMany({
    where: { id: order.id, storeId: args.store.id },
    data: { attribution: { ...attribution, experiments: attributed } as Prisma.InputJsonValue },
  });
  for (const a of attributed) await incrementStat(a.experimentId, a.variantKey, day, "order");
  return "counted";
}

/* ───────────── Résultats ───────────── */

export type ExperimentResults = {
  id: string;
  name: string;
  template: string;
  sectionId: string;
  goal: ExperimentGoal;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  winnerKey: string | null;
  variants: ExperimentVariant[];
  /** Totaux par variante et par métrique. */
  totals: Record<string, Record<ExperimentMetric, number>>;
  verdict: ExperimentVerdict;
};

const ZERO: Record<ExperimentMetric, number> = { exposure: 0, add_to_cart: 0, checkout_start: 0, order: 0 };

/** Résultats d'un test (agrégation de `ExperimentStat`) ; `null` si le test n'appartient pas à la boutique. */
export async function experimentResults(storeId: string, experimentId: string, now = new Date()): Promise<ExperimentResults | null> {
  const row = await db.experiment.findFirst({
    where: { id: experimentId, storeId },
    select: { id: true, name: true, template: true, sectionId: true, goal: true, status: true, startedAt: true, endedAt: true, winnerKey: true, variants: true, createdAt: true, stats: { select: { variantKey: true, metric: true, count: true } } },
  });
  if (!row) return null;
  const variants = parseVariants(row.variants);
  const goal = (EXPERIMENT_GOALS as readonly string[]).includes(row.goal) ? (row.goal as ExperimentGoal) : "ORDER";

  const totals: Record<string, Record<ExperimentMetric, number>> = {};
  for (const v of variants) totals[v.key] = { ...ZERO };
  for (const s of row.stats) {
    const bucket = (totals[s.variantKey] ??= { ...ZERO });
    if ((["exposure", "add_to_cart", "checkout_start", "order"] as string[]).includes(s.metric)) bucket[s.metric as ExperimentMetric] += s.count;
  }

  const metric = GOAL_METRIC[goal];
  const reference = row.endedAt && row.endedAt.getTime() < now.getTime() ? row.endedAt : now;
  const verdict = analyzeExperiment(
    variants.map((v) => ({ key: v.key, label: variantLabel(v), exposures: totals[v.key]?.exposure ?? 0, conversions: totals[v.key]?.[metric] ?? 0 })),
    { daysRunning: row.startedAt ? daysBetween(row.startedAt, reference) : 0 },
  );

  return {
    id: row.id,
    name: row.name,
    template: row.template,
    sectionId: row.sectionId,
    goal,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    winnerKey: row.winnerKey,
    variants,
    totals,
    verdict,
  };
}

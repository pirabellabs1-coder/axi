"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { badIds, fail, guard, parseForm, success, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { getTemplateByKey, parseTemplateKey, type TemplateKey } from "@/lib/theme-engine/alternates";
import { MAX_DOCUMENT_BYTES, validateThemeDocument } from "@/lib/theme-engine/validate";
import type { SectionInstance, ThemeDocument } from "@/lib/theme-engine/types";
import { editorDocument, publishedDocument } from "@/lib/theme/bootstrap";
import { lot4PlanIssue } from "@/lib/theme/editor-plan";
import { EXPERIMENT_GOALS, evenWeights, VARIANT_KEYS, type VariantKey } from "./assign";
import { applyVariant, EXPERIMENTS_UPSELL, experimentAllowance, parseVariants, serializeVariants, validateVariantSection, type ExperimentVariant } from "./rules";

/**
 * Lot 4 §13 : actions des tests A/B de sections.
 * Garanties : capacité `theme.manage`, filtre `storeId`, variantes revalidées par le moteur de thème,
 * un seul test vivant par section (contrainte vérifiée sous verrou), limites de plan côté serveur, `audit()`.
 */

const LIVE_STATUSES = ["DRAFT", "RUNNING", "PAUSED"] as const;

const createSchema = z.object({
  storeId: z.string().min(8).max(64),
  name: z.string().trim().min(2, "Donnez un nom au test.").max(60),
  template: z.string().min(2).max(64),
  sectionId: z.string().min(1).max(64),
  goal: z.enum(EXPERIMENT_GOALS),
  variantsJson: z.string().min(2).max(MAX_DOCUMENT_BYTES),
});

function revalidate(storeId: string, slug: string) {
  revalidatePath(`/app/${storeId}/apparence/tests`);
  revalidatePath(`/s/${slug}`, "layout");
}

/** Document de référence d'un test : le thème PUBLIÉ (c'est lui que voient les visiteurs). */
function liveDocument(ctx: StoreContext): ThemeDocument {
  return publishedDocument(ctx.store) ?? editorDocument(ctx.store).doc;
}

type RawVariant = { key?: unknown; kind?: unknown; section?: unknown };

/** Lecture et validation des variantes envoyées par l'écran (2 ou 3 ; A = section actuelle). */
function readVariants(json: string, doc: ThemeDocument, template: TemplateKey, sectionId: string): { variants: ExperimentVariant[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: "Variantes illisibles." };
  }
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > VARIANT_KEYS.length) return { error: "Un test compte 2 ou 3 variantes." };
  const weights = evenWeights(raw.length);
  const out: ExperimentVariant[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = (raw[i] ?? {}) as RawVariant;
    const key = VARIANT_KEYS[i];
    if (i === 0) {
      out.push({ key, weight: weights[i], kind: "current", section: null });
      continue;
    }
    if (item.kind === "hidden") {
      out.push({ key, weight: weights[i], kind: "hidden", section: null });
      continue;
    }
    const checked = validateVariantSection(doc, template, item.section);
    if (!checked.ok) return { error: `Variante ${key} : ${checked.error}` };
    const section: SectionInstance = { ...checked.section, id: sectionId };
    out.push({ key, weight: weights[i], kind: "section", section });
  }
  if (out.some((v, i) => v.key !== VARIANT_KEYS[i])) return { error: "Variantes invalides." };
  return { variants: out };
}

/* ───────────── Création ───────────── */

export async function createExperiment(_prev: ActionResult<{ id: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const parsed = parseForm(createSchema, formData);
    if ("error" in parsed) return parsed.error;
    const input = parsed.data;
    const ctx = await requireStore(input.storeId, "theme.manage");
    const store = ctx.store;

    const allowance = experimentAllowance(ctx.planId);
    if (allowance === 0) return fail(EXPERIMENTS_UPSELL);

    const key = parseTemplateKey(input.template);
    if (!key) return fail("Modèle de page inconnu.", { template: ["Modèle de page inconnu."] });
    const templateKey = input.template as TemplateKey;
    const doc = liveDocument(ctx);
    const tpl = getTemplateByKey(doc, templateKey);
    const section = tpl?.sections[input.sectionId];
    if (!tpl || !section) return fail("Section introuvable dans ce modèle de page.", { sectionId: ["Section introuvable."] });

    const variants = readVariants(input.variantsJson, doc, templateKey, input.sectionId);
    if ("error" in variants) return fail(variants.error);

    const created: { clash?: { id: string; name: string }; id?: string } = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`experiment:${store.id}`}))`;
      const existing = await tx.experiment.findFirst({
        where: { storeId: store.id, template: templateKey, sectionId: input.sectionId, status: { in: [...LIVE_STATUSES] } },
        select: { id: true, name: true },
      });
      if (existing) return { clash: existing };
      const row = await tx.experiment.create({
        data: {
          storeId: store.id,
          name: input.name,
          template: templateKey,
          sectionId: input.sectionId,
          goal: input.goal,
          status: "DRAFT",
          variants: serializeVariants(variants.variants) as Prisma.InputJsonValue,
          createdById: ctx.user.id,
        },
        select: { id: true },
      });
      await audit({ storeId: store.id, actorId: ctx.user.id, action: "theme.experiment.create", target: row.id, metadata: { name: input.name, template: templateKey, sectionId: input.sectionId, goal: input.goal, variants: variants.variants.length } }, tx);
      return { id: row.id };
    });
    if (created.clash) return fail(`« ${created.clash.name} » teste déjà cette section. Terminez-le avant d'en créer un autre.`);
    if (!created.id) return fail("Test non enregistré. Réessayez.");

    revalidate(store.id, store.slug);
    return success({ id: created.id }, "Test créé. Démarrez-le quand vous êtes prêt.");
  });
}

/* ───────────── Cycle de vie ───────────── */

async function loadOwned(ctx: StoreContext, experimentId: string) {
  return db.experiment.findFirst({
    where: { id: experimentId, storeId: ctx.store.id },
    select: { id: true, name: true, status: true, template: true, sectionId: true, startedAt: true, variants: true },
  });
}

export async function startExperiment(storeId: string, experimentId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, experimentId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "theme.manage");
    const allowance = experimentAllowance(ctx.planId);
    if (allowance === 0) return fail(EXPERIMENTS_UPSELL);
    const row = await loadOwned(ctx, experimentId);
    if (!row) return fail("Test introuvable.");
    if (row.status === "RUNNING") return success(undefined, "Déjà en cours.");
    if (row.status === "COMPLETED") return fail("Ce test est terminé.");
    if (parseVariants(row.variants).length < 2) return fail("Ce test n'a pas assez de variantes.");

    const result: { limit?: number } = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`experiment:${ctx.store.id}`}))`;
      if (allowance != null) {
        const running = await tx.experiment.count({ where: { storeId: ctx.store.id, status: "RUNNING" } });
        if (running >= allowance) return { limit: allowance };
      }
      await tx.experiment.updateMany({
        where: { id: row.id, storeId: ctx.store.id },
        data: { status: "RUNNING", startedAt: row.startedAt ?? new Date(), endedAt: null },
      });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.experiment.start", target: row.id, metadata: { name: row.name } }, tx);
      return {};
    });
    if (result.limit != null) return fail(`Votre plan permet ${result.limit} test${result.limit > 1 ? "s" : ""} en cours. Terminez-en un avant d'en démarrer un autre.`);

    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Test démarré : les visiteurs sont répartis entre les variantes.");
  });
}

export async function pauseExperiment(storeId: string, experimentId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, experimentId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "theme.manage");
    const row = await loadOwned(ctx, experimentId);
    if (!row) return fail("Test introuvable.");
    if (row.status !== "RUNNING") return fail("Ce test n'est pas en cours.");
    await db.$transaction(async (tx) => {
      await tx.experiment.updateMany({ where: { id: row.id, storeId: ctx.store.id }, data: { status: "PAUSED" } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.experiment.pause", target: row.id, metadata: { name: row.name } }, tx);
    });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Test en pause : tous les visiteurs voient la section actuelle. Les mesures sont conservées.");
  });
}

export async function completeExperiment(storeId: string, experimentId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, experimentId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "theme.manage");
    const row = await loadOwned(ctx, experimentId);
    if (!row) return fail("Test introuvable.");
    if (row.status === "COMPLETED") return success(undefined, "Déjà terminé.");
    await db.$transaction(async (tx) => {
      await tx.experiment.updateMany({ where: { id: row.id, storeId: ctx.store.id }, data: { status: "COMPLETED", endedAt: new Date() } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.experiment.complete", target: row.id, metadata: { name: row.name } }, tx);
    });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Test terminé. La section actuelle est servie à tous les visiteurs.");
  });
}

export async function deleteExperiment(storeId: string, experimentId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, experimentId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "theme.manage");
    const row = await loadOwned(ctx, experimentId);
    if (!row) return fail("Test introuvable.");
    if (row.status === "RUNNING") return fail("Mettez le test en pause avant de le supprimer.");
    await db.$transaction(async (tx) => {
      await tx.experiment.deleteMany({ where: { id: row.id, storeId: ctx.store.id } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.experiment.delete", target: row.id, metadata: { name: row.name } }, tx);
    });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Test supprimé avec ses mesures.");
  });
}

/* ───────────── Appliquer la gagnante ───────────── */

/**
 * Remplace la section dans le BROUILLON du thème (jamais en ligne directement : le commerçant publie ensuite).
 * Le test est terminé et la gagnante mémorisée.
 */
export async function applyExperimentWinner(storeId: string, experimentId: string, variantKey: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, experimentId);
    if (bad) return bad;
    if (!(VARIANT_KEYS as readonly string[]).includes(variantKey)) return fail("Variante inconnue.");
    const ctx = await requireStore(storeId, "theme.manage");
    const store = ctx.store;
    const row = await loadOwned(ctx, experimentId);
    if (!row) return fail("Test introuvable.");

    const variants = parseVariants(row.variants);
    const winner = variants.find((v) => v.key === variantKey);
    if (!winner) return fail("Variante inconnue.");
    const templateKey = row.template as TemplateKey;
    if (!parseTemplateKey(templateKey)) return fail("Modèle de page inconnu.");

    const draft = editorDocument(store).doc;
    if (!getTemplateByKey(draft, templateKey)?.sections[row.sectionId]) return fail("La section n'existe plus dans votre thème : rien n'a été modifié.");

    const next = winner.kind === "current" ? draft : applyVariant(draft, templateKey, row.sectionId, winner);
    const v = validateThemeDocument(next);
    if (!v.ok) return fail(v.errors[0]?.message ?? "Thème invalide : rien n'a été modifié.");
    const planIssue = lot4PlanIssue(ctx.planId, v.doc, [publishedDocument(store), draft]);
    if (planIssue) return fail(planIssue);

    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: store.id }, data: { themeDocDraft: { ...v.doc, updatedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue } });
      await tx.experiment.updateMany({ where: { id: row.id, storeId: store.id }, data: { status: "COMPLETED", endedAt: new Date(), winnerKey: winner.key } });
      await audit({ storeId: store.id, actorId: ctx.user.id, action: "theme.experiment.apply_winner", target: row.id, metadata: { name: row.name, variantKey: winner.key, kind: winner.kind } }, tx);
    });

    revalidate(store.id, store.slug);
    revalidatePath(`/app/${store.id}/apparence`);
    return success(undefined, winner.kind === "current" ? "La section actuelle est conservée. Test terminé." : "Variante appliquée au brouillon du thème. Vérifiez l'aperçu, puis publiez.");
  });
}

export type { VariantKey };

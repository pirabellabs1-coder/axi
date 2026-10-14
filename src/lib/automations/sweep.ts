import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { TRIGGER_META, type AutomationTrigger } from "./templates";
import { triggerParam } from "./config";
import { dedupeKey } from "./rules";
import { lowStockItems } from "@/lib/inventory/service";
import { thresholdSince } from "@/lib/inventory/policy";
import { getStorePrefs } from "@/lib/notifications/prefs";
import { currentLowStockCrossing } from "@/lib/inventory/alerts";
import { LOG_CHANNEL, executeAutomation, loadAutomation, logTemplate, planBlockReason, type TriggerEvent } from "./engine";

/**
 * Balayage périodique des déclencheurs temporels (appelé par /api/jobs/run) :
 *  - customer.inactive : clients sans commande depuis N jours (une fois par période d'inactivité) ;
 *  - review.request    : commandes livrées depuis N jours (une fois par commande) ;
 *  - product.low_stock : articles suivis sous leur seuil (produit, sinon boutique), une alerte par franchissement.
 * Les clés déjà traitées sont écartées AVANT l'exécution : le journal n'est pas pollué à chaque passage.
 */

const DAY = 86_400_000;
const SWEEP_TRIGGERS: AutomationTrigger[] = ["customer.inactive", "review.request", "product.low_stock"];
const PER_AUTOMATION = 40;
/** Garde-fou : nombre maximal d'essais (doublons compris) par automatisation et par passage. */
const MAX_ATTEMPTS = 400;
/** Stock bas : fenêtre des mouvements examinés (le balayage passe toutes les ~10 min ; marge pour un cron en panne). */
const LOW_STOCK_WINDOW_DAYS = 2;
const SETTING_KEY = "automations.sweep";
const MIN_INTERVAL_MS = 9 * 60_000;

/** Verrou de fréquence global (PlatformSetting). Renvoie la date du passage précédent, ou null si trop tôt. */
export async function claimSweep(now = new Date(), minIntervalMs = MIN_INTERVAL_MS): Promise<{ previous: Date | null } | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SETTING_KEY}))`;
    const row = await tx.platformSetting.findUnique({ where: { key: SETTING_KEY } });
    const last = (row?.value as { lastRunAt?: string } | null)?.lastRunAt;
    const previous = last ? new Date(last) : null;
    if (previous && now.getTime() - previous.getTime() < minIntervalMs) return null;
    const value = { lastRunAt: now.toISOString() } as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value, updatedBy: "system" }, update: { value, updatedBy: "system" } });
    return { previous };
  });
}

async function candidates(trigger: AutomationTrigger, storeId: string, param: number, now: Date): Promise<TriggerEvent[]> {
  switch (trigger) {
    case "customer.inactive": {
      const rows = await db.customer.findMany({
        where: { storeId, lastOrderAt: { lte: new Date(now.getTime() - param * DAY), gte: new Date(now.getTime() - (param + 30) * DAY) } },
        orderBy: { lastOrderAt: "asc" },
        take: 200,
        select: { id: true, phone: true, name: true },
      });
      return rows.map((c) => ({ storeId, customerId: c.id, phone: c.phone, name: c.name }));
    }
    case "review.request": {
      const rows = await db.order.findMany({
        where: { storeId, status: "DELIVERED", deliveredAt: { lte: new Date(now.getTime() - param * DAY), gte: new Date(now.getTime() - (param + 7) * DAY) } },
        orderBy: { deliveredAt: "asc" },
        take: 200,
        select: { id: true },
      });
      return rows.map((o) => ({ storeId, orderId: o.id }));
    }
    case "product.low_stock": {
      // Candidats = articles dont le stock a BOUGÉ récemment (un franchissement est toujours un mouvement) et qui sont
      // sous leur seuil (produit, sinon boutique). Les vieilles ruptures sans mouvement n'occupent jamais de place.
      const moved = await db.inventoryMovement.groupBy({ by: ["productId", "variantId"], where: { storeId, createdAt: { gte: new Date(now.getTime() - LOW_STOCK_WINDOW_DAYS * DAY) } } });
      if (moved.length === 0) return [];
      const movedKeys = new Set(moved.map((m) => `${m.productId}:${m.variantId ?? "-"}`));
      const productIds = [...new Set(moved.map((m) => m.productId))];
      const prefs = await getStorePrefs(storeId);
      const items = (await lowStockItems(storeId, { storeThreshold: prefs.lowStockThreshold, scope: "active", limit: 5000, productIds })).filter((i) => movedKeys.has(`${i.productId}:${i.variantId ?? "-"}`));
      const products = new Map(
        (await db.product.findMany({ where: { storeId, id: { in: [...new Set(items.map((i) => i.productId))] } }, select: { id: true, lowStockThreshold: true, lowStockThresholdChangedAt: true } })).map((p) => [p.id, p]),
      );
      const out: TriggerEvent[] = [];
      for (const i of items) {
        const p = products.get(i.productId);
        // Franchissement postérieur au dernier changement de seuil uniquement (pas d'alerte rétroactive).
        const since = p ? thresholdSince(p, prefs.lowStockThresholdChangedAt) : null;
        const crossingId = await currentLowStockCrossing(storeId, i.productId, i.variantId, i.threshold, since);
        if (crossingId) out.push({ storeId, productId: i.productId, variantId: i.variantId, crossingId });
      }
      return out;
    }
    default:
      return [];
  }
}

/**
 * Clés d'anti-doublon déjà traitées pour une automatisation, parmi `keys` (requête ciblée, sans fenêtre de temps) :
 * exécutions réussies ou ignorées, et échecs de moins de 24 h (un échec plus ancien peut être retenté).
 */
export async function processedKeys(storeId: string, automationId: string, keys: string[], now: Date): Promise<Set<string>> {
  const done = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const rows = await db.$queryRaw<{ key: string; status: string; createdAt: Date }[]>`
      SELECT payload->>'dedupeKey' AS key, status::text AS status, "createdAt"
      FROM "Notification"
      WHERE "storeId" = ${storeId} AND channel = ${LOG_CHANNEL} AND template = ${logTemplate(automationId)}
        AND payload->>'dedupeKey' = ANY(${chunk}::text[])`;
    for (const r of rows) if (r.status !== "FAILED" || new Date(r.createdAt).getTime() > now.getTime() - DAY) done.add(r.key);
  }
  return done;
}

function keyOf(trigger: AutomationTrigger, e: TriggerEvent, lastOrderAt: Date | null, now: Date) {
  return dedupeKey(trigger, { orderId: e.orderId, customerId: e.customerId, lastOrderAt, productId: e.productId, variantId: e.variantId, crossingId: e.crossingId, now });
}

export async function runTimeTriggers(now = new Date()) {
  const rows = await db.automation.findMany({ where: { active: true, trigger: { in: SWEEP_TRIGGERS } }, orderBy: { createdAt: "asc" }, take: 300 });
  const stats = { automations: 0, executed: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    const a = loadAutomation(row);
    if (!a || TRIGGER_META[a.trigger].kind !== "sweep") continue;
    if (await planBlockReason(a)) continue; // pas de journal à chaque passage pour un plan insuffisant
    stats.automations++;
    const param = triggerParam(a.trigger, a.config) ?? 0;
    const list = await candidates(a.trigger, a.storeId, param, now);
    if (list.length === 0) continue;

    const lastOrders =
      a.trigger === "customer.inactive"
        ? new Map((await db.customer.findMany({ where: { id: { in: list.map((e) => e.customerId!).filter(Boolean) } }, select: { id: true, lastOrderAt: true } })).map((c) => [c.id, c.lastOrderAt]))
        : new Map<string, Date | null>();
    const keyed = list.map((e) => ({ e, key: keyOf(a.trigger, e, e.customerId ? (lastOrders.get(e.customerId) ?? null) : null, now) }));
    // Clés déjà traitées, SANS limite de durée, ciblées sur les clés des candidats (réussies ou ignorées ; échecs de moins de 24 h).
    const done = await processedKeys(a.storeId, a.id, keyed.map((k) => k.key), now);

    // Seules les exécutions réelles consomment une place : un doublon (déjà traité entre-temps) n'en prive pas un candidat.
    let n = 0;
    let attempts = 0;
    for (const { e, key } of keyed) {
      if (n >= PER_AUTOMATION || attempts >= MAX_ATTEMPTS) break;
      if (done.has(key)) continue;
      attempts++;
      try {
        const r = await executeAutomation(a, e, { fromSweep: true });
        if (r.status === "duplicate") continue;
        n++;
        if (r.status === "sent") stats.executed++;
        else if (r.status === "failed") stats.failed++;
        else if (r.status === "skipped") stats.skipped++;
      } catch (err) {
        n++;
        stats.failed++;
        console.error("[automations/sweep]", a.id, err);
      }
    }
  }
  return stats;
}

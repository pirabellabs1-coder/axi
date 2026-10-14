import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/inventory/policy";

/**
 * Préférences de notifications par boutique, stockées dans `Integration` (kind `axi_prefs`,
 * champ JSON `config`) faute de colonne dédiée. Le « vu jusqu'à » est stocké par membre
 * (kind `notif_seen:{userId}`), supprimé avec la boutique.
 *
 * Besoin de schéma (à prévoir) : une table StorePreference et un champ Membership.notificationsSeenAt.
 */
const PREFS_KIND = "axi_prefs";

export type StorePrefs = {
  /** Récapitulatif quotidien par e-mail au propriétaire. */
  dailyReport: boolean;
  /** Seuil « stock bas » par défaut de la boutique (produits sans seuil propre : alertes, filtres, vitrine). */
  lowStockThreshold: number;
  /** Dernier changement du seuil par défaut (ISO) : pas d'alerte pour les franchissements antérieurs. */
  lowStockThresholdChangedAt: string | null;
  /** Dernier récapitulatif envoyé (date locale AAAA-MM-JJ). */
  lastDailyReport: string | null;
};

const DEFAULTS: StorePrefs = { dailyReport: true, lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD, lowStockThresholdChangedAt: null, lastDailyReport: null };

export function parsePrefs(raw: unknown): StorePrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const threshold = Number(o.lowStockThreshold);
  return {
    dailyReport: typeof o.dailyReport === "boolean" ? o.dailyReport : DEFAULTS.dailyReport,
    lowStockThreshold: Number.isInteger(threshold) && threshold >= 0 && threshold <= 1000 ? threshold : DEFAULTS.lowStockThreshold,
    lowStockThresholdChangedAt: typeof o.lowStockThresholdChangedAt === "string" && !Number.isNaN(Date.parse(o.lowStockThresholdChangedAt)) ? o.lowStockThresholdChangedAt : null,
    lastDailyReport: typeof o.lastDailyReport === "string" ? o.lastDailyReport : null,
  };
}

export async function getStorePrefs(storeId: string, client: Tx | typeof db = db): Promise<StorePrefs> {
  const row = await client.integration.findUnique({ where: { storeId_kind: { storeId, kind: PREFS_KIND } }, select: { config: true } });
  return parsePrefs(row?.config);
}

export async function getPrefsForStores(storeIds: string[]): Promise<Map<string, StorePrefs>> {
  const rows = await db.integration.findMany({ where: { storeId: { in: storeIds }, kind: PREFS_KIND }, select: { storeId: true, config: true } });
  const map = new Map<string, StorePrefs>();
  for (const id of storeIds) map.set(id, { ...DEFAULTS });
  for (const r of rows) map.set(r.storeId, parsePrefs(r.config));
  return map;
}

export async function updateStorePrefs(storeId: string, patch: Partial<StorePrefs>, client: Tx | typeof db = db): Promise<StorePrefs> {
  const current = await getStorePrefs(storeId, client);
  const next = { ...current, ...patch };
  if (patch.lowStockThreshold !== undefined && patch.lowStockThreshold !== current.lowStockThreshold) next.lowStockThresholdChangedAt = new Date().toISOString();
  await client.integration.upsert({
    where: { storeId_kind: { storeId, kind: PREFS_KIND } },
    create: { storeId, kind: PREFS_KIND, status: "active", config: next as unknown as Prisma.InputJsonValue },
    update: { config: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

const seenKind = (userId: string) => `notif_seen:${userId}`;

export async function getSeenAt(storeId: string, userId: string): Promise<Date> {
  const row = await db.integration.findUnique({ where: { storeId_kind: { storeId, kind: seenKind(userId) } }, select: { config: true, createdAt: true } });
  const at = (row?.config as { at?: string } | null)?.at;
  const d = at ? new Date(at) : null;
  // Jamais consulté : on ne remonte pas au-delà de 7 jours (pas de compteur « 99+ » au premier passage).
  return d && !Number.isNaN(d.getTime()) ? d : new Date(Date.now() - 7 * 86_400_000);
}

export async function markSeen(storeId: string, userId: string, at = new Date()) {
  const config = { at: at.toISOString() } as Prisma.InputJsonValue;
  await db.integration.upsert({
    where: { storeId_kind: { storeId, kind: seenKind(userId) } },
    create: { storeId, kind: seenKind(userId), status: "active", config },
    update: { config },
  });
}

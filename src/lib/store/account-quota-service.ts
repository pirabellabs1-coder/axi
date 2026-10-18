import "server-only";
import { db, type Tx } from "@/lib/db";
import { inForceWhere } from "@/lib/addons/service";
import { effectivePlanId } from "@/lib/billing/rules";
import { audit } from "@/lib/audit";
import { OVER_STORE_LIMIT_REASON, accountStoresQuota, storesBeyondLimit, type AccountStoresQuota, type OwnedStoreForQuota } from "./account-quota";

/** Boutiques possédées (rôle OWNER) avec leur plan effectif et leurs options EXTRA_STORE en vigueur. */
export async function loadOwnedStoresForQuota(userId: string, tx: Tx | typeof db = db, now = new Date()): Promise<OwnedStoreForQuota[]> {
  const owned = await tx.membership.findMany({ where: { userId, role: "OWNER" }, include: { store: { include: { subscription: true } } } });
  const ids = owned.map((m) => m.store.id);
  const extras = ids.length
    ? await tx.addOnPurchase.findMany({ where: { ...inForceWhere("", now), storeId: { in: ids }, addOnId: "EXTRA_STORE" }, select: { storeId: true, quantity: true } })
    : [];
  return owned.map((m) => ({
    id: m.store.id,
    status: m.store.status,
    createdAt: m.store.createdAt,
    planId: effectivePlanId(m.store.subscription, now),
    extraStores: extras.filter((e) => e.storeId === m.store.id).reduce((s, e) => s + e.quantity, 0),
  }));
}

export async function getAccountStoresQuota(userId: string, tx: Tx | typeof db = db): Promise<AccountStoresQuota> {
  return accountStoresQuota(await loadOwnedStoresForQuota(userId, tx));
}

/**
 * Verrou de création de boutique par compte : la ligne User est verrouillée jusqu'à la fin de la transaction,
 * ce qui sérialise deux créations simultanées du même compte (la seconde relit le quota après la première).
 */
export async function lockAccountForStoreCreation(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

/**
 * Dépublie les boutiques en ligne au-delà de la limite du compte (les plus récentes), avec un motif explicite.
 * Ne supprime rien. Idempotent. Appelé à l'affichage des espaces compte (pas de cron dédié à ce jour).
 */
export async function enforceAccountStoreLimit(userId: string): Promise<string[]> {
  const stores = await loadOwnedStoresForQuota(userId);
  const q = accountStoresQuota(stores);
  if (q.firstStore) return [];
  const over = storesBeyondLimit(stores, q.limit).filter((s) => s.status === "PUBLISHED" || s.status === "CLOSED_TEMPORARILY");
  if (!over.length) return [];
  await db.$transaction(async (tx) => {
    for (const s of over) {
      const r = await tx.store.updateMany({ where: { id: s.id, status: { in: ["PUBLISHED", "CLOSED_TEMPORARILY"] } }, data: { status: "DRAFT", statusReason: OVER_STORE_LIMIT_REASON } });
      if (r.count) await audit({ storeId: s.id, action: "store.unpublished_over_limit", metadata: { used: q.used, limit: q.limit } }, tx);
    }
  });
  return over.map((s) => s.id);
}

/** La boutique fait-elle partie des places couvertes du compte de son propriétaire ? (contrôle de publication) */
export async function storeWithinAccountLimit(userId: string, storeId: string): Promise<boolean> {
  const stores = await loadOwnedStoresForQuota(userId);
  const q = accountStoresQuota(stores);
  return !storesBeyondLimit(stores, q.limit).some((s) => s.id === storeId);
}

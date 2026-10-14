import "server-only";
import { db, type Tx } from "@/lib/db";
import { PLANS, type PlanId } from "@/config/plans";
import { currentPeriod } from "@/lib/utils";

export type QuotaCheck = { allowed: boolean; used: number; limit: number | null; metric: string };

export async function getUsage(storeId: string, metric: string, period = currentPeriod(), tx: Tx | typeof db = db): Promise<number> {
  const row = await tx.usageCounter.findUnique({ where: { storeId_metric_period: { storeId, metric, period } } });
  return row?.value ?? 0;
}

export async function incrementUsage(storeId: string, metric: string, by = 1, tx: Tx | typeof db = db, period = currentPeriod()) {
  await tx.usageCounter.upsert({
    where: { storeId_metric_period: { storeId, metric, period } },
    create: { storeId, metric, period, value: by },
    update: { value: { increment: by } },
  });
}

export async function checkOrdersQuota(storeId: string, planId: PlanId, tx: Tx | typeof db = db): Promise<QuotaCheck> {
  const limit = PLANS[planId].limits.ordersPerMonth;
  const used = await getUsage(storeId, "orders", currentPeriod(), tx);
  return { allowed: limit == null || used < limit, used, limit, metric: "orders" };
}

export async function checkProductsQuota(storeId: string, planId: PlanId): Promise<QuotaCheck> {
  const limit = PLANS[planId].limits.products;
  const used = await db.product.count({ where: { storeId, status: { not: "ARCHIVED" } } });
  return { allowed: limit == null || used < limit, used, limit, metric: "products" };
}

export async function checkMembersQuota(storeId: string, planId: PlanId): Promise<QuotaCheck> {
  const { effectiveLimits } = await import("@/lib/addons/service");
  const limit = (await effectiveLimits(storeId, planId)).members;
  const [members, pending] = await Promise.all([
    db.membership.count({ where: { storeId, role: { not: "SUPPORT" } } }),
    db.invitation.count({ where: { storeId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  const used = members + pending;
  return { allowed: limit == null || used < limit, used, limit, metric: "members" };
}

export async function checkStoresQuota(userId: string, planId: PlanId): Promise<QuotaCheck> {
  const limit = PLANS[planId].limits.stores;
  const used = await db.membership.count({ where: { userId, role: "OWNER", store: { status: { not: "ARCHIVED" } } } });
  return { allowed: limit == null || used < limit, used, limit, metric: "stores" };
}

export function quotaMessage(q: QuotaCheck): string {
  const names: Record<string, string> = { orders: "commandes ce mois-ci", products: "produits", members: "membres d'équipe", stores: "boutiques" };
  return `Limite atteinte : ${q.used}/${q.limit} ${names[q.metric] ?? q.metric}. Passez à un plan supérieur pour continuer.`;
}

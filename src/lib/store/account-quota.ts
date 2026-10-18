/**
 * Quota de boutiques au niveau du COMPTE (fonctions pures, sans accès base).
 *
 * Règle : boutiques autorisées = limite du meilleur plan parmi les boutiques possédées (non archivées)
 *         + somme des options EXTRA_STORE en vigueur sur TOUTES ces boutiques.
 * La toute première boutique du compte (aucune boutique possédée, même archivée) est toujours autorisée (essai).
 * Les boutiques archivées ne comptent ni dans l'usage, ni pour le plan, ni pour les options.
 */
import { ADD_ONS, PLANS, TRIAL_PLAN, planRank, type PlanId } from "@/config/plans";

export type OwnedStoreForQuota = {
  id: string;
  status: string;
  createdAt: Date;
  planId: PlanId;
  /** Quantité d'options EXTRA_STORE en vigueur sur cette boutique. */
  extraStores: number;
};

export type AccountStoresQuota = {
  allowed: boolean;
  used: number;
  /** null = illimité. */
  limit: number | null;
  baseLimit: number | null;
  extraStores: number;
  bestPlan: PlanId;
  /** Boutique principale (meilleur plan, puis la plus ancienne) : porte la facturation des options du compte. */
  primaryStoreId: string | null;
  /** Le plan du compte permet d'acheter une boutique en plus. */
  canBuyExtra: boolean;
  firstStore: boolean;
};

const EXTRA_STORE_PLANS: readonly PlanId[] = ADD_ONS.find((a) => a.id === "EXTRA_STORE")?.plans ?? [];

export function isLiveStore(s: Pick<OwnedStoreForQuota, "status">): boolean {
  return s.status !== "ARCHIVED";
}

/** Boutiques non archivées, de la plus ancienne à la plus récente (ordre d'attribution des places). */
function bySeniority<T extends Pick<OwnedStoreForQuota, "status" | "createdAt" | "id">>(stores: T[]): T[] {
  return stores.filter(isLiveStore).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

export function accountStoresQuota(stores: OwnedStoreForQuota[]): AccountStoresQuota {
  if (stores.length === 0) {
    const limit = PLANS[TRIAL_PLAN].limits.stores;
    return { allowed: true, used: 0, limit, baseLimit: limit, extraStores: 0, bestPlan: TRIAL_PLAN, primaryStoreId: null, canBuyExtra: false, firstStore: true };
  }
  const live = bySeniority(stores);
  // Meilleur plan ; à rang égal, la boutique la plus ancienne (stable) porte la facturation.
  const primary = live.reduce<OwnedStoreForQuota | null>((best, s) => (!best || planRank(s.planId) > planRank(best.planId) ? s : best), null);
  const bestPlan: PlanId = primary?.planId ?? "FREE";
  const baseLimit = PLANS[bestPlan].limits.stores;
  const extraStores = live.reduce((sum, s) => sum + Math.max(0, s.extraStores), 0);
  const limit = baseLimit == null ? null : baseLimit + extraStores;
  const used = live.length;
  return {
    allowed: limit == null || used < limit,
    used,
    limit,
    baseLimit,
    extraStores,
    bestPlan,
    primaryStoreId: primary?.id ?? null,
    canBuyExtra: EXTRA_STORE_PLANS.includes(bestPlan),
    firstStore: false,
  };
}

/**
 * Boutiques au-delà de la limite du compte : les plus récentes (les plus anciennes gardent leur place).
 * Sert à dépublier ce qui dépasse quand une option EXTRA_STORE ou un plan arrive à échéance.
 */
export function storesBeyondLimit<T extends Pick<OwnedStoreForQuota, "id" | "status" | "createdAt">>(stores: T[], limit: number | null): T[] {
  if (limit == null) return [];
  return bySeniority(stores).slice(Math.max(0, limit));
}

/** Marqueur posé dans `Store.statusReason` quand la boutique est dépubliée pour dépassement de limite. */
export const OVER_STORE_LIMIT_REASON = "Hors limite du compte : la place de cette boutique n'est plus couverte par votre plan ou une option « Boutique en plus ». Rachetez une place pour la republier.";

export function storesQuotaLabel(q: Pick<AccountStoresQuota, "used" | "limit">): string {
  return q.limit == null ? `${q.used} boutique${q.used > 1 ? "s" : ""} (illimité)` : `${q.used}/${q.limit} boutiques`;
}

import { z } from "zod";
import { currencyDecimals, formatMoney } from "@/lib/money";

/** Configuration fidélité (Store.loyaltyConfig). Partagé client / serveur. */
export type LoyaltyConfig = {
  enabled: boolean;
  /** Points gagnés par tranche de base (1 000 FCFA, ou 10 unités pour les devises à centimes). */
  pointsPer1000: number;
  /** Seuil de points pour obtenir une récompense. */
  rewardPoints: number;
  /** Valeur de la récompense, en unités monétaires entières (FCFA, ou centimes pour EUR). */
  rewardValue: number;
};

export const DEFAULT_LOYALTY: LoyaltyConfig = { enabled: false, pointsPer1000: 1, rewardPoints: 100, rewardValue: 5000 };

const schema = z.object({
  enabled: z.boolean(),
  pointsPer1000: z.number().int().min(1).max(1000),
  rewardPoints: z.number().int().min(1).max(1_000_000),
  rewardValue: z.number().int().min(0).max(100_000_000),
});

export function parseLoyaltyConfig(raw: unknown): LoyaltyConfig {
  const r = schema.safeParse({ ...DEFAULT_LOYALTY, ...(raw && typeof raw === "object" ? raw : {}) });
  return r.success ? r.data : DEFAULT_LOYALTY;
}

/** Tranche de base en unités majeures : 1 000 pour FCFA, 10 pour EUR. */
export function loyaltyBase(currency: string): number {
  return currencyDecimals(currency) === 0 ? 1000 : 10;
}

export function loyaltyBaseLabel(currency: string): string {
  const base = loyaltyBase(currency);
  return formatMoney(base * 10 ** currencyDecimals(currency), currency);
}

/** Points gagnés pour un montant (unités entières de la devise). */
export function pointsForAmount(amount: number, currency: string, cfg: LoyaltyConfig): number {
  if (!cfg.enabled || amount <= 0) return 0;
  const major = amount / 10 ** currencyDecimals(currency);
  return Math.floor((major / loyaltyBase(currency)) * cfg.pointsPer1000);
}

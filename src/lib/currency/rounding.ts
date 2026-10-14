/**
 * Règles d'arrondi des prix convertis (spécification lot 2, §1.2). Module PUR, importable côté client.
 *
 * Appliquées aux prix catalogue (prix unitaire, prix barré) et à la livraison, JAMAIS aux remises ni aux taxes.
 * Toutes les opérations travaillent sur une valeur exacte exprimée en fraction d'unités mineures `num / den`
 * (BigInt) : aucune dérive flottante, quel que soit le montant.
 *
 *  - NONE                 : arrondi au plus proche de l'unité mineure (demi-unité vers le haut) ;
 *  - NEAREST_5 … _100     : arrondi SUPÉRIEUR au multiple de N unités MAJEURES (XOF : 5 FCFA ; EUR : 5 €) ;
 *  - UP_TO_99 / UP_TO_95  : plus petite valeur ≥ au montant se terminant par ,99 / ,95 (devises à centimes
 *                           uniquement ; sur une devise sans décimales, repli sur NONE).
 */

export const ROUNDING_RULES = ["NONE", "NEAREST_5", "NEAREST_10", "NEAREST_25", "NEAREST_50", "NEAREST_100", "UP_TO_99", "UP_TO_95"] as const;
export type RoundingRuleId = (typeof ROUNDING_RULES)[number];

export const ROUNDING_LABELS: Record<RoundingRuleId, string> = {
  NONE: "Au plus proche (aucun arrondi commercial)",
  NEAREST_5: "Au multiple de 5 supérieur",
  NEAREST_10: "Au multiple de 10 supérieur",
  NEAREST_25: "Au multiple de 25 supérieur",
  NEAREST_50: "Au multiple de 50 supérieur",
  NEAREST_100: "Au multiple de 100 supérieur",
  UP_TO_99: "Terminaison ,99 (devises à centimes)",
  UP_TO_95: "Terminaison ,95 (devises à centimes)",
};

const STEP: Partial<Record<RoundingRuleId, number>> = { NEAREST_5: 5, NEAREST_10: 10, NEAREST_25: 25, NEAREST_50: 50, NEAREST_100: 100 };
const ENDING: Partial<Record<RoundingRuleId, number>> = { UP_TO_99: 99, UP_TO_95: 95 };

export function isRoundingRule(v: unknown): v is RoundingRuleId {
  return typeof v === "string" && (ROUNDING_RULES as readonly string[]).includes(v);
}

/** Une règle à terminaison (,99 / ,95) n'a de sens que pour une devise à centimes. */
export function ruleAllowedFor(rule: RoundingRuleId, decimals: number): boolean {
  return ENDING[rule] == null || decimals >= 2;
}

/** Règle par défaut d'une devise : XOF / XAF au multiple de 5 (pièces en circulation), sinon NONE. */
export function defaultRoundingFor(currency: string): RoundingRuleId {
  return currency === "XOF" || currency === "XAF" ? "NEAREST_5" : "NONE";
}

const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const B10 = BigInt(10);

export const pow10 = (n: number): bigint => {
  let r = B1;
  for (let i = 0; i < n; i++) r *= B10;
  return r;
};

/** floor(num / den) pour den > 0 (BigInt tronque vers zéro). */
export function floorDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  return num % den !== B0 && num < B0 ? q - B1 : q;
}

/** ceil(num / den) pour den > 0. */
export function ceilDiv(num: bigint, den: bigint): bigint {
  return -floorDiv(-num, den);
}

/** round(num / den), demi-unité vers le haut (en valeur absolue : symétrique pour les négatifs), den > 0. */
export function roundHalfUp(num: bigint, den: bigint): bigint {
  if (num < B0) return -roundHalfUp(-num, den);
  return (B2 * num + den) / (B2 * den);
}

/**
 * Arrondit la valeur exacte `num / den` (en unités mineures de la devise cible, positive) selon la règle.
 * Retourne un entier d'unités mineures. Une valeur nulle ou négative est arrondie au plus proche (jamais gonflée).
 */
export function applyRounding(num: bigint, den: bigint, rule: RoundingRuleId, decimals: number): number {
  if (den <= B0) throw new Error("applyRounding : dénominateur invalide");
  if (num <= B0 || rule === "NONE") return Number(roundHalfUp(num, den));
  const step = STEP[rule];
  if (step != null) {
    const unit = BigInt(step) * pow10(decimals);
    return Number(ceilDiv(num, den * unit) * unit);
  }
  const ending = ENDING[rule];
  if (ending != null && decimals >= 2) {
    // Plus petite valeur v ≥ num/den avec v ≡ ending (mod 100 unités mineures), v ≥ ending.
    const hundred = BigInt(100);
    const e = BigInt(ending);
    let k = ceilDiv(num - e * den, hundred * den);
    if (k < B0) k = B0;
    return Number(k * hundred + e);
  }
  return Number(roundHalfUp(num, den));
}

/** Arrondi d'un montant entier déjà en unités mineures (prix fixé, tests). */
export function roundAmount(amountMinor: number, rule: RoundingRuleId, decimals: number): number {
  return applyRounding(BigInt(Math.trunc(amountMinor)), B1, rule, decimals);
}

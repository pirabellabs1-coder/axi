/**
 * Caisse : espèces, rendu de monnaie et plafonds de remise (lot 3 §2) — module PUR
 * (tests/pos-cash.test.ts). Montants entiers en XOF (aucune décimale).
 */

/** Arrondi des espèces au multiple de 5 FCFA (réglage de la boutique). */
export const CASH_ROUNDING_STEP = 5;

export type PosRole = "OWNER" | "MANAGER" | "STAFF" | "SUPPORT";

/** Plafond de remise manuelle par rôle (spec §2) ; au-delà, le code du gérant est exigé. */
export const MAX_DISCOUNT_PERCENT: Record<PosRole, number> = { OWNER: 100, MANAGER: 50, STAFF: 10, SUPPORT: 0 };

/** Arrondi au multiple le plus proche (0,5 arrondi vers le haut). */
export function roundCash(amount: number, step: number = CASH_ROUNDING_STEP): number {
  if (!Number.isFinite(amount)) return 0;
  if (step <= 1) return Math.round(amount);
  return Math.round(amount / step) * step;
}

/** Montant réellement demandé en espèces (arrondi si le réglage est actif). */
export function cashPayable(total: number, roundingEnabled: boolean, step: number = CASH_ROUNDING_STEP): number {
  return roundingEnabled ? roundCash(total, step) : Math.round(total);
}

/** Rendu de monnaie : jamais négatif (un encaissement insuffisant est refusé en amont). */
export function changeDue(payable: number, received: number): number {
  return Math.max(0, Math.round(received) - Math.round(payable));
}

export type CashFlows = {
  openingFloat: number;
  /** Encaissements en espèces de la session. */
  cashSales: number;
  /** Remboursements rendus en espèces. */
  cashRefunds?: number;
  /** Entrées de caisse hors vente (apport). */
  cashIn?: number;
  /** Sorties de caisse (prélèvement, dépense). */
  cashOut?: number;
};

/** Espèces attendues = fond + encaissements − rendus − sorties + entrées (spec §2 « Clôture »). */
export function expectedCash(f: CashFlows): number {
  return Math.round(f.openingFloat + f.cashSales + (f.cashIn ?? 0) - (f.cashRefunds ?? 0) - (f.cashOut ?? 0));
}

/** Écart de caisse = compté − attendu (négatif = manque). */
export function cashDiscrepancy(counted: number, expected: number): number {
  return Math.round(counted) - Math.round(expected);
}

/** Une remise manuelle est-elle permise à ce rôle sans code du gérant ? */
export function discountAllowed(role: PosRole, percent: number): boolean {
  if (!Number.isFinite(percent) || percent < 0) return false;
  return percent <= (MAX_DISCOUNT_PERCENT[role] ?? 0);
}

export function isPosRole(value: unknown): value is PosRole {
  return value === "OWNER" || value === "MANAGER" || value === "STAFF" || value === "SUPPORT";
}

/**
 * Rôle retenu pour le plafond de remise d'une vente rejouée depuis la file (bloquant n° 3).
 *
 * Une vente hors ligne peut être synchronisée par un AUTRE membre que le vendeur : juger la remise au
 * rôle de celui qui synchronise déforme la vente. La file transmet donc le rôle du vendeur, mais il
 * vient du client : on retient le plafond LE PLUS BAS des deux (jamais d'élévation de privilège par une
 * charge utile). Un dépassement reste possible avec le code du gérant, vérifié côté serveur.
 */
export function effectiveDiscountRole(authenticated: PosRole, claimed?: PosRole | null): PosRole {
  if (!claimed || !isPosRole(claimed)) return authenticated;
  return (MAX_DISCOUNT_PERCENT[claimed] ?? 0) < (MAX_DISCOUNT_PERCENT[authenticated] ?? 0) ? claimed : authenticated;
}

export function discountCapMessage(role: PosRole): string {
  const cap = MAX_DISCOUNT_PERCENT[role] ?? 0;
  return cap === 0
    ? "Votre rôle ne permet pas d'accorder une remise."
    : `Votre rôle permet une remise jusqu'à ${cap} %. Au-delà, demandez le code du gérant.`;
}

/** Montant d'une remise en pourcentage sur un sous-total (arrondi à l'entier le plus proche). */
export function discountAmount(subtotal: number, percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  const capped = Math.min(100, percent);
  return Math.min(subtotal, Math.round((subtotal * capped) / 100));
}

export type PaymentKind = "pos_cash" | "pos_momo" | "pos_card";

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  pos_cash: "Espèces",
  pos_momo: "Mobile Money",
  pos_card: "Carte (terminal)",
};

export function isPaymentKind(value: string): value is PaymentKind {
  return value === "pos_cash" || value === "pos_momo" || value === "pos_card";
}

export type PaymentSplit = { kind: PaymentKind; amount: number; reference?: string | null };

export type PaymentCheck =
  | { ok: true; paid: number; change: number }
  | { ok: false; error: string };

/**
 * Contrôle des paiements multiples d'une vente : Σ encaissé ≥ dû ; le dépassement n'est permis
 * qu'en espèces (rendu de monnaie) ; une référence est exigée pour Mobile Money et carte.
 */
export function checkPayments(total: number, splits: readonly PaymentSplit[]): PaymentCheck {
  if (!splits.length) return { ok: false, error: "Ajoutez un moyen de paiement." };
  let paid = 0;
  let cash = 0;
  for (const s of splits) {
    if (!Number.isInteger(s.amount) || s.amount <= 0) return { ok: false, error: "Montant encaissé invalide." };
    if ((s.kind === "pos_momo" || s.kind === "pos_card") && !(s.reference ?? "").trim()) {
      return { ok: false, error: `Saisissez la référence du paiement ${PAYMENT_KIND_LABELS[s.kind].toLowerCase()}.` };
    }
    paid += s.amount;
    if (s.kind === "pos_cash") cash += s.amount;
  }
  if (paid < total) return { ok: false, error: `Il manque ${total - paid} FCFA.` };
  const over = paid - total;
  if (over > 0 && over > cash) return { ok: false, error: "Le trop-perçu ne peut être rendu qu'en espèces." };
  return { ok: true, paid, change: over };
}

/**
 * Montants RÉELLEMENT acquis à la vente, moyen par moyen (Σ = total encaissé).
 * Le rendu de monnaie n'entre jamais en caisse : un excédent remis en espèces est retiré de la part
 * « espèces ». Les moyens non espèces sont servis d'abord (ils sont exacts par nature), les espèces
 * absorbent le reste. Fonction pure : c'est elle qui fait foi dans le rapport Z.
 */
export function settlePayments(total: number, splits: readonly PaymentSplit[]): PaymentSplit[] {
  let left = Math.max(0, Math.round(total));
  const out: PaymentSplit[] = [];
  for (const s of splits.filter((x) => x.kind !== "pos_cash")) {
    const amount = Math.min(s.amount, left);
    if (amount > 0) out.push({ ...s, amount });
    left -= amount;
  }
  for (const s of splits.filter((x) => x.kind === "pos_cash")) {
    const amount = Math.min(s.amount, left);
    if (amount > 0) out.push({ ...s, amount });
    left -= amount;
  }
  return out;
}

export type ZReportInput = {
  sales: { total: number; discount: number; taxTotal: number; priceSource: string | null }[];
  payments: { kind: string; amount: number }[];
  cashMoves: { kind: string; amount: number }[];
  openingFloat: number;
  countedCash: number | null;
  /** Remboursements rendus EN ESPÈCES sur les ventes de la session (déduits des espèces attendues). */
  cashRefunds?: number;
};

export type ZReport = {
  salesCount: number;
  grossTotal: number;
  discountTotal: number;
  taxTotal: number;
  byPayment: Record<string, number>;
  cashIn: number;
  cashOut: number;
  /** Remboursements en espèces rattachés aux ventes de la session. */
  cashRefunds: number;
  expectedCash: number;
  countedCash: number | null;
  discrepancy: number | null;
  offlinePriceMismatches: number;
};

/**
 * Rapport Z d'une session (immuable une fois la session fermée). Fonction pure.
 * `cashRefunds` vient des remboursements EN ESPÈCES des ventes de la session (majeur n° 9) : sans eux,
 * les espèces attendues seraient surévaluées et l'écart de caisse accuserait à tort le caissier.
 * Tout autre décaissement passe par un mouvement de caisse « Sortie d'espèces ».
 */
export function buildZReport(input: ZReportInput): ZReport {
  const byPayment: Record<string, number> = {};
  for (const p of input.payments) byPayment[p.kind] = (byPayment[p.kind] ?? 0) + p.amount;
  const cashIn = input.cashMoves.filter((m) => m.kind === "in").reduce((s, m) => s + m.amount, 0);
  const cashOut = input.cashMoves.filter((m) => m.kind === "out").reduce((s, m) => s + m.amount, 0);
  const cashRefunds = Math.max(0, Math.round(input.cashRefunds ?? 0));
  const expected = expectedCash({ openingFloat: input.openingFloat, cashSales: byPayment.pos_cash ?? 0, cashIn, cashOut, cashRefunds });
  return {
    salesCount: input.sales.length,
    grossTotal: input.sales.reduce((s, x) => s + x.total, 0),
    discountTotal: input.sales.reduce((s, x) => s + x.discount, 0),
    taxTotal: input.sales.reduce((s, x) => s + x.taxTotal, 0),
    byPayment,
    cashIn,
    cashOut,
    cashRefunds,
    expectedCash: expected,
    countedCash: input.countedCash,
    discrepancy: input.countedCash == null ? null : cashDiscrepancy(input.countedCash, expected),
    offlinePriceMismatches: input.sales.filter((s) => s.priceSource === "offline_snapshot").length,
  };
}

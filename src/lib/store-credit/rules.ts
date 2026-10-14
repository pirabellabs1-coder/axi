/**
 * Règles pures de l'avoir (store credit), spécification lot 1, §3 « Avoir ».
 * Solde dénormalisé `Customer.storeCreditBalance` + journal `StoreCreditTransaction`. Pas d'expiration au lot 1.
 */

export const STORE_CREDIT_MAX_OPERATION = 10_000_000;
export const STORE_CREDIT_NOTE_MAX = 300;

export type StoreCreditKind = "GRANT" | "REDEEM" | "REVERSAL" | "ADJUST" | "REFUND_TO_CREDIT";

export const STORE_CREDIT_KIND_LABELS: Record<StoreCreditKind, string> = {
  GRANT: "Geste commercial",
  REDEEM: "Utilisé sur une commande",
  REVERSAL: "Recrédit (annulation)",
  ADJUST: "Ajustement",
  REFUND_TO_CREDIT: "Remboursement en avoir",
};

/**
 * Qui peut utiliser l'avoir d'un client ?
 *  - un acheteur connecté par code dont la session porte ce `customerId` (jamais un invité : son téléphone est saisi librement) ;
 *  - ou le commerçant (`customers.manage`) dans une commande manuelle ou à la caisse.
 */
export function canUseStoreCredit(p: { customerId: string | null | undefined; buyerSessionCustomerId?: string | null; merchant?: boolean }): boolean {
  if (!p.customerId) return false;
  if (p.merchant === true) return true;
  return !!p.buyerSessionCustomerId && p.buyerSessionCustomerId === p.customerId;
}

/** Montant d'avoir applicable : min(solde, demandé, assiette des tenders restante), jamais négatif. */
export function applicableStoreCredit(balance: number, requested: number, base: number): number {
  return Math.max(0, Math.min(Math.floor(balance), Math.floor(requested), Math.floor(base)));
}

/** Solde après opération ; null si l'opération rendrait le solde négatif (refusée). */
export function nextStoreCreditBalance(balance: number, delta: number): number | null {
  const next = balance + delta;
  return next < 0 ? null : next;
}

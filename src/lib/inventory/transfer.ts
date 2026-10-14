/**
 * Transferts de stock entre dépôts (lot 3 §1.1) — machine d'états PURE (tests/transfer-state.test.ts).
 *
 *   DRAFT ──expédier──► IN_TRANSIT ──recevoir──► RECEIVED
 *     └──annuler──► CANCELLED ◄──annuler (restitue au dépôt source)── IN_TRANSIT
 *
 * Expédition : mouvement TRANSFER négatif à la source (conditionnel : `available ≥ qty`), stock AGRÉGÉ inchangé.
 * Réception : mouvement RECEIVE positif à la destination, quantités reçues ≤ expédiées ; l'écart est déclaré
 * en perte (ADJUSTMENT agrégé négatif, motif obligatoire).
 */

export type TransferStatusValue = "DRAFT" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";

export const TRANSFER_STATUS_LABELS: Record<TransferStatusValue, string> = {
  DRAFT: "Brouillon",
  IN_TRANSIT: "En transit",
  RECEIVED: "Reçu",
  CANCELLED: "Annulé",
};

const TRANSITIONS: Record<TransferStatusValue, readonly TransferStatusValue[]> = {
  DRAFT: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

export function canTransitionTransfer(from: TransferStatusValue, to: TransferStatusValue): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function nextTransferStatuses(from: TransferStatusValue): readonly TransferStatusValue[] {
  return TRANSITIONS[from] ?? [];
}

export type TransferItem = {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  /** Déjà reçu lors d'une réception antérieure (0 par défaut). */
  receivedQuantity?: number;
};

/**
 * Plan de réception : quantités à créditer au dépôt destination et écart à déclarer en perte.
 *
 * Invariant (majeur n° 3) : `receivedQuantity ≤ quantité réellement sortie du dépôt source`. L'expédition
 * étant TOUT OU RIEN (`shipTransfer` lève au moindre refus, la transaction est annulée), la quantité
 * sortie d'une ligne IN_TRANSIT vaut exactement `quantity` ; le reste à recevoir est donc
 * `quantity − receivedQuantity`. Toute saisie est bornée à ce reste : on ne peut jamais créditer la
 * destination de plus que ce qui a quitté la source, même en forgeant le formulaire.
 * Une saisie absente ou illisible vaut « tout le reste reçu ».
 */
export function receivePlan(
  items: readonly TransferItem[],
  received: ReadonlyMap<string, number>,
): { lines: ReceiveLine[]; totalMissing: number } {
  const lines = items.map((it) => {
    const shipped = Math.max(0, Math.trunc(it.quantity));
    const already = Math.max(0, Math.min(shipped, Math.trunc(it.receivedQuantity ?? 0)));
    const outstanding = shipped - already;
    const raw = received.has(it.id) ? received.get(it.id)! : outstanding;
    const credit = Number.isInteger(raw) ? Math.max(0, Math.min(outstanding, raw)) : 0;
    return { itemId: it.id, productId: it.productId, variantId: it.variantId, credit, received: already + credit, missing: outstanding - credit };
  });
  return { lines, totalMissing: lines.reduce((s, l) => s + l.missing, 0) };
}

export type ReceiveLine = {
  itemId: string;
  productId: string;
  variantId: string | null;
  /** Unités à créditer MAINTENANT au dépôt destination (mouvement RECEIVE). */
  credit: number;
  /** Total cumulé reçu pour cette ligne, écrit dans `StockTransferItem.receivedQuantity`. */
  received: number;
  /** Unités sorties de la source et jamais reçues : perte en transit (motif obligatoire). */
  missing: number;
};

/** Un transfert doit relier deux dépôts distincts et porter au moins une ligne de quantité positive. */
export function validateTransferDraft(p: { fromLocationId: string; toLocationId: string; items: readonly { quantity: number }[] }): string | null {
  if (p.fromLocationId === p.toLocationId) return "Choisissez deux dépôts différents.";
  const lines = p.items.filter((i) => Number.isInteger(i.quantity) && i.quantity > 0);
  if (!lines.length) return "Ajoutez au moins un article avec une quantité.";
  if (lines.length > 200) return "Maximum 200 lignes par transfert.";
  return null;
}

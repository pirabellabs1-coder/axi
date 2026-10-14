/**
 * Base de calcul des points de fidélité d'une commande (décision du 11/10/2026, revue « argent » du lot 1) :
 * net marchandise HORS lignes carte cadeau (lineTotal − discountAllocated), hors livraison, moins ce qui a été
 * réglé par cartes cadeaux et par avoir. Jamais négative. Fonction pure, testée.
 *
 * Commandes antérieures au lot 1 (`discountAllocated` absent) : la remise globale `discount` est retranchée.
 */
export function loyaltyBaseAmount(o: {
  items: { lineTotal: number; discountAllocated?: number | null; isGiftCard?: boolean | null }[];
  discount?: number | null;
  giftCardAmount?: number | null;
  storeCreditAmount?: number | null;
}): number {
  const allocated = o.items.reduce((s, i) => s + Math.max(0, i.discountAllocated ?? 0), 0);
  const merch = o.items.filter((i) => !i.isGiftCard).reduce((s, i) => s + Math.max(0, i.lineTotal - (i.discountAllocated ?? 0)), 0);
  const legacyDiscount = allocated === 0 ? Math.max(0, o.discount ?? 0) : 0;
  return Math.max(0, merch - legacyDiscount - Math.max(0, o.giftCardAmount ?? 0) - Math.max(0, o.storeCreditAmount ?? 0));
}

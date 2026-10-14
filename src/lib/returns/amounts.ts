/**
 * Montants remboursables d'un retour — module PUR (spec lot 1 §4 « Montant remboursable par article »).
 * Testé dans tests/returns-amounts.test.ts.
 *
 *  - Valeur d'un article : net de la ligne `lineTotal − discountAllocated`, réparti sur ses unités par la méthode du
 *    plus fort reste (égalités départagées par l'index d'unité). Les unités sont consommées dans l'ordre des retours :
 *    la somme des retours successifs d'une ligne vaut exactement son net (aucun FCFA perdu ni créé).
 *  - Frais de remise en stock : pourcentage de la valeur marchandise du retour, `Math.round`.
 *  - Livraison : ajoutée si `refundShipping` et retour total (toutes les unités retournables rendues, cumul compris),
 *    une seule fois par commande.
 *  - Plafond cumulé : total payé − remboursements et avoirs déjà accordés sur la commande.
 */
import { allocateProRata } from "@/lib/commerce/allocation";

/** Valeur de chaque unité d'une ligne (net réparti à parts égales, plus fort reste : `allocateProRata`). */
export function unitValues(net: number, quantity: number): number[] {
  if (quantity <= 0) return [];
  return allocateProRata(Math.max(0, Math.round(net)), Array.from({ length: quantity }, () => 1));
}

export type AmountOrderItem = { id: string; quantity: number; lineTotal: number; discountAllocated: number; isGiftCard?: boolean };

export function lineNet(item: Pick<AmountOrderItem, "lineTotal" | "discountAllocated">): number {
  return Math.max(0, item.lineTotal - Math.max(0, item.discountAllocated));
}

/** Valeur de `quantity` unités retournées après `priorQuantity` unités déjà retournées sur la même ligne. */
export function returnLineValue(item: AmountOrderItem, quantity: number, priorQuantity = 0): number {
  const units = unitValues(lineNet(item), item.quantity);
  const from = Math.min(Math.max(0, priorQuantity), item.quantity);
  const to = Math.min(from + Math.max(0, quantity), item.quantity);
  let sum = 0;
  for (let i = from; i < to; i++) sum += units[i]!;
  return sum;
}

export type ReturnLineInput = {
  orderItemId: string;
  quantity: number;
  /** Unités de cette ligne déjà prises par des retours antérieurs (non annulés ni refusés). */
  priorQuantity?: number;
};

export type ReturnAmountsInput = {
  order: { total: number; deliveryFee: number; items: AmountOrderItem[] };
  lines: ReturnLineInput[];
  restockingFeePercent: number;
  /** Frais de remise en stock annulés par le commerçant (ex. article défectueux). */
  waiveRestockingFee?: boolean;
  refundShipping: boolean;
  /** Unités prises par les AUTRES retours (non annulés ni refusés), par article : sert à détecter le retour total. */
  otherReturnedQty?: Record<string, number>;
  /** La livraison a déjà été rendue par un autre retour. */
  shippingAlreadyRefunded?: boolean;
  /** Remboursements (non refusés) et avoirs de retours déjà accordés sur la commande. */
  alreadyRefunded: number;
};

export type ReturnAmounts = {
  lines: { orderItemId: string; quantity: number; value: number }[];
  /** Valeur marchandise nette des articles retournés (base du retrait de fidélité). */
  merchandise: number;
  restockingFee: number;
  shipping: number;
  /** Montant avant plafond. */
  gross: number;
  /** Reste remboursable sur la commande. */
  cap: number;
  /** Montant remboursable suggéré (plafonné). */
  amount: number;
  capped: boolean;
  fullReturn: boolean;
};

export function computeReturnAmounts(input: ReturnAmountsInput): ReturnAmounts {
  const byId = new Map(input.order.items.map((i) => [i.id, i]));
  const lines: ReturnAmounts["lines"] = [];
  for (const l of input.lines) {
    const item = byId.get(l.orderItemId);
    if (!item || l.quantity <= 0) continue;
    lines.push({ orderItemId: l.orderItemId, quantity: l.quantity, value: returnLineValue(item, l.quantity, l.priorQuantity ?? 0) });
  }
  const merchandise = lines.reduce((s, l) => s + l.value, 0);
  const pct = Math.min(100, Math.max(0, input.restockingFeePercent));
  const restockingFee = input.waiveRestockingFee ? 0 : Math.min(merchandise, Math.round((merchandise * pct) / 100));

  const thisQty = new Map<string, number>();
  for (const l of lines) thisQty.set(l.orderItemId, (thisQty.get(l.orderItemId) ?? 0) + l.quantity);
  const returnable = input.order.items.filter((i) => !i.isGiftCard);
  const fullReturn =
    returnable.length > 0 && returnable.every((i) => (input.otherReturnedQty?.[i.id] ?? 0) + (thisQty.get(i.id) ?? 0) >= i.quantity);
  const shipping = input.refundShipping && fullReturn && !input.shippingAlreadyRefunded ? Math.max(0, input.order.deliveryFee) : 0;

  const gross = Math.max(0, merchandise - restockingFee + shipping);
  const cap = Math.max(0, input.order.total - Math.max(0, input.alreadyRefunded));
  const amount = Math.min(gross, cap);
  return { lines, merchandise, restockingFee, shipping, gross, cap, amount, capped: amount < gross, fullReturn };
}

/** Avoir accordé : montant × (1 + bonus %), bonus arrondi. */
export function storeCreditWithBonus(amount: number, bonusPercent: number): number {
  if (amount <= 0) return 0;
  const pct = Math.min(100, Math.max(0, bonusPercent));
  return amount + Math.round((amount * pct) / 100);
}

/** Échange : la valeur retournée est un « avoir d'échange » ; différence due par l'acheteur ou excédent à rendre. */
export function exchangeBalance(credit: number, exchangeTotal: number): { applied: number; due: number; surplus: number } {
  const c = Math.max(0, credit);
  const t = Math.max(0, exchangeTotal);
  return { applied: Math.min(c, t), due: Math.max(0, t - c), surplus: Math.max(0, c - t) };
}

/**
 * Retrait proportionnel de fidélité : points × montant remboursé / net marchandise, arrondi à l'inférieur.
 * Jamais plus que `available` (points encore attachés à la commande et solde du client).
 */
export function loyaltyPointsToRevoke(points: number, refundedNetMerch: number, netMerch: number, available = Number.POSITIVE_INFINITY): number {
  if (points <= 0 || refundedNetMerch <= 0 || netMerch <= 0) return 0;
  const raw = Math.floor((points * Math.min(refundedNetMerch, netMerch)) / netMerch);
  return Math.max(0, Math.min(raw, Math.floor(available)));
}

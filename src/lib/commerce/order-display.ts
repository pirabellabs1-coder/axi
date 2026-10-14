import { formatMoney } from "@/lib/money";

/**
 * Lot 2 : montant affiché à l'acheteur dans sa devise d'affichage au moment de la commande (instantané
 * `presentment*`), à titre indicatif : la commande est toujours due et encaissée dans la devise de la boutique.
 * Pur, importable côté client. Renvoie null sans instantané ou si la devise est celle de la boutique.
 */
export function presentmentTotalText(order: { currency: string; presentmentCurrency?: string | null; presentmentTotal?: number | null }): string | null {
  const cur = order.presentmentCurrency;
  if (!cur || cur === order.currency || order.presentmentTotal == null || !Number.isInteger(order.presentmentTotal) || order.presentmentTotal < 0) return null;
  return `≈ ${formatMoney(order.presentmentTotal, cur)}`;
}

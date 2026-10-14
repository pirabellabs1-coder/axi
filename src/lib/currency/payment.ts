/**
 * Devise d'encaissement d'une commande affichée dans une devise étrangère (spécification lot 2, §1.2, « Paiement »).
 * Module PUR, importable côté client.
 *
 *  - `PaymentMethod.currencies` vide = devise de la boutique uniquement ;
 *  - un moyen qui accepte la devise d'affichage (passerelle internationale) encaisse `presentment.amountDue` ;
 *  - sinon : encaissement en devise boutique, avec la mention « Vous serez débité de 6 560 FCFA (≈ 10,00 €) » ;
 *  - le Mobile Money manuel (et tout moyen manuel) n'est JAMAIS converti ;
 *  - paiement mixte (avoir) : encaissement en devise boutique (les tenders vivent en devise boutique).
 *
 * POINT D'INTÉGRATION (équipe P1, src/lib/payments/**) : `initiateGatewayPayment` initie aujourd'hui toujours
 * `amountDue` dans `order.currency`. Tant que les adaptateurs ne lisent pas la devise et le montant de la tentative,
 * `GATEWAY_PRESENTMENT_CHARGE` reste false : tout est encaissé en devise boutique, avec la mention, ce qui est
 * exact pour l'acheteur. Pour l'activer : initier avec `attempt.amount` / `attempt.currency` et passer ce drapeau à true.
 */
import { formatMoney } from "@/lib/money";

export const GATEWAY_PRESENTMENT_CHARGE = false;

export type ChargeMethod = { kind: string; currencies?: readonly string[] | null };

export function methodAcceptsCurrency(method: ChargeMethod | null | undefined, currency: string, storeCurrency: string): boolean {
  if (!method) return currency === storeCurrency;
  if (currency === storeCurrency) return true;
  if (method.kind !== "GATEWAY" || !GATEWAY_PRESENTMENT_CHARGE) return false;
  return (method.currencies ?? []).includes(currency);
}

export type ChargePlan = {
  currency: string;
  amount: number;
  /** Mention à afficher quand la devise débitée diffère de la devise affichée ; null sinon. */
  mention: string | null;
};

/**
 * Plan d'encaissement : `storeDue` (devise boutique) et `presentedDue` (devise d'affichage, null = pas de conversion).
 */
export function chargePlan(p: { method: ChargeMethod | null | undefined; storeCurrency: string; storeDue: number; presentment: { currency: string; amountDue: number; storeCreditAmount?: number } | null }): ChargePlan {
  const pres = p.presentment;
  if (!pres || pres.currency === p.storeCurrency) return { currency: p.storeCurrency, amount: p.storeDue, mention: null };
  const mixed = (pres.storeCreditAmount ?? 0) > 0;
  if (!mixed && methodAcceptsCurrency(p.method, pres.currency, p.storeCurrency)) return { currency: pres.currency, amount: pres.amountDue, mention: null };
  return { currency: p.storeCurrency, amount: p.storeDue, mention: chargeMention(p.storeDue, p.storeCurrency, pres.amountDue, pres.currency) };
}

/** « Vous serez débité de 6 560 FCFA (≈ 10,00 €) ». */
export function chargeMention(storeDue: number, storeCurrency: string, presentedDue: number, presentedCurrency: string): string {
  return `Vous serez débité de ${formatMoney(storeDue, storeCurrency)} (≈ ${formatMoney(presentedDue, presentedCurrency)})`;
}

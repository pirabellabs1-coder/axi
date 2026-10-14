/**
 * Conséquences d'un changement de nature sur un produit existant (module PUR, testé).
 *
 * Le formulaire produit laisse changer la nature d'une fiche déjà enregistrée (et parfois déjà vendue) :
 * avant d'appliquer, on énumère ce que le commerçant va perdre ou devoir faire (suivi de stock, fichiers,
 * exonération de TVA d'une carte cadeau, poids inutile…). Aucun effet de bord, aucune dépendance React :
 * la liste est affichée dans la fenêtre de confirmation et vérifiée par `tests/product-kind-change.test.ts`.
 */

import { PRODUCT_KIND_LABELS, kindRequiresShipping, kindTracksStock, type ProductKindValue } from "@/lib/digital/kinds";

export type KindChangeContext = {
  /** Le suivi de quantité est actif sur la fiche. */
  trackStock?: boolean;
  /** Des fichiers sont déjà attachés (produit numérique). */
  hasFiles?: boolean;
  /** Un poids est saisi. */
  weightSet?: boolean;
  /** Un prix promotionnel est saisi. */
  hasPromo?: boolean;
  /** Des groupes de suppléments existent. */
  hasSupplements?: boolean;
  /**
   * Produit déjà enregistré (donc possiblement déjà vendu) : les commandes passées gardent la nature
   * vendue à l'époque (`OrderItem.kind` est un instantané).
   */
  existing?: boolean;
};

/**
 * Liste, en français et dans l'ordre d'importance, ce qu'implique le passage de `from` à `to`.
 * Tableau vide = changement sans conséquence (aucune confirmation nécessaire).
 */
export function kindChangeConsequences(from: ProductKindValue, to: ProductKindValue, ctx: KindChangeContext = {}): string[] {
  if (from === to) return [];
  const out: string[] = [];

  if (ctx.existing) {
    out.push("Si ce produit a déjà été vendu, les commandes passées gardent la nature vendue à l'époque : seules les prochaines ventes suivent le nouveau type.");
  }
  if (ctx.trackStock && !kindTracksStock(to)) {
    out.push(`Le suivi de stock sera désactivé : un produit de type « ${PRODUCT_KIND_LABELS[to]} » ne se décompte pas.`);
  }
  if (to === "DIGITAL" && !ctx.hasFiles) {
    out.push("Un produit numérique doit recevoir au moins un fichier (carte « Fichiers à remettre »), sinon l'acheteur reçoit un lien vide.");
  }
  if (from === "DIGITAL" && ctx.hasFiles) {
    out.push("Les fichiers attachés ne seront plus remis aux acheteurs (ils restent enregistrés si vous revenez au numérique).");
  }
  if (to === "GIFT_CARD") {
    out.push("Une carte cadeau est exonérée de TVA : les réglages de taxes du produit ne s'appliquent plus (la carte « Taxes » disparaît après enregistrement).");
    if (ctx.hasPromo) out.push("Le prix promotionnel sera retiré : une carte cadeau se vend à sa valeur faciale.");
    if (ctx.hasSupplements) out.push("Retirez les suppléments : une carte cadeau n'en a pas.");
  }
  if (from === "GIFT_CARD") {
    out.push("Les cartes déjà émises restent valables, mais ce produit ne sera plus vendu comme carte cadeau et redevient soumis à la TVA.");
  }
  if (ctx.weightSet && !kindRequiresShipping(to)) {
    out.push("Le poids saisi ne servira plus : ce type de produit n'est pas expédié.");
  }
  if (kindRequiresShipping(to) && !kindRequiresShipping(from)) {
    out.push("Le produit redevient expédiable : renseignez son poids pour le calcul des frais de livraison.");
  }
  return out;
}

/** Faut-il demander une confirmation avant d'appliquer le changement ? */
export function needsKindConfirmation(from: ProductKindValue, to: ProductKindValue, ctx: KindChangeContext = {}): boolean {
  return kindChangeConsequences(from, to, ctx).length > 0;
}

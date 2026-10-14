/**
 * Synchronisation du stock depuis la fiche produit / l'import CSV — fonctions pures (tests/catalog-stock-delta.test.ts).
 *
 * La fiche envoie la quantité saisie ET la quantité affichée à l'ouverture (`stockBase`). Le serveur applique
 * uniquement la différence (incrément conditionnel), ce qui préserve les ventes intervenues entre-temps.
 * Sans base (import CSV : valeur absolue), la base est la valeur courante lue dans la transaction.
 */

/** Delta à appliquer : saisie − base affichée (ou − valeur courante à défaut de base). 0 = ne rien écrire. */
export function stockDelta(next: number, base: number | null | undefined, current: number): number {
  return next - (base ?? current);
}

/** Résultat d'un incrément conditionnel (`updateMany … where stock >= -delta`) : nouveau stock, ou null si refusé. */
export function applyStockDeltaTo(current: number, delta: number): number | null {
  if (delta < 0 && current < -delta) return null;
  return current + delta;
}

/** Erreur métier : le stock a trop baissé pendant l'édition pour appliquer la modification sans passer en négatif. */
export class StockConflictError extends Error {
  constructor(label: string) {
    super(`Le stock de « ${label} » a changé pendant la modification (ventes en cours) et deviendrait négatif. Rechargez la fiche puis réessayez.`);
    this.name = "StockConflictError";
  }
}

import { describe, it, expect } from "vitest";
import { applyStockDeltaTo, stockDelta, StockConflictError } from "@/lib/products/stock-sync";

/** Simule l'enregistrement d'une fiche : base lue à l'ouverture, saisie, stock courant au moment de l'écriture. */
function save(opened: number, typed: number, currentAtSave: number, withBase = true) {
  const delta = stockDelta(typed, withBase ? opened : null, currentAtSave);
  return { delta, result: delta === 0 ? currentAtSave : applyStockDeltaTo(currentAtSave, delta) };
}

describe("stock de la fiche produit : delta au lieu d'une valeur absolue (constat 1)", () => {
  it("stock non modifié : aucun delta, les ventes intercalées sont conservées", () => {
    // Ouverture à 10, 3 ventes pendant l'édition (courant 7), la saisie reste 10.
    expect(save(10, 10, 7)).toEqual({ delta: 0, result: 7 });
  });

  it("réassort pendant des ventes : on ajoute la différence saisie", () => {
    // Ouverture à 10, +5 saisis (15), 2 ventes entre-temps → 13 (et non 15).
    expect(save(10, 15, 8)).toEqual({ delta: 5, result: 13 });
  });

  it("baisse saisie compatible avec le stock courant", () => {
    expect(save(10, 6, 8)).toEqual({ delta: -4, result: 4 });
  });

  it("baisse devenue impossible (stock passerait sous zéro) : refus", () => {
    expect(save(10, 0, 8)).toEqual({ delta: -10, result: null });
  });

  it("sans base (import CSV, valeur absolue) : delta calculé sur la valeur courante", () => {
    expect(save(10, 4, 8, false)).toEqual({ delta: -4, result: 4 });
    expect(stockDelta(5, undefined, 5)).toBe(0);
  });

  it("erreur explicite en cas de conflit", () => {
    const e = new StockConflictError("Robe (M)");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toMatch(/Robe \(M\)/);
    expect(e.message).toMatch(/Rechargez/);
  });
});

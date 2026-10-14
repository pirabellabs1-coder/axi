import { describe, expect, it } from "vitest";
import { kindChangeConsequences, needsKindConfirmation } from "@/app/app/[storeId]/produits/kind-change";

const has = (xs: string[], needle: string) => xs.some((x) => x.includes(needle));

describe("kindChangeConsequences", () => {
  it("ne dit rien quand le type ne change pas", () => {
    expect(kindChangeConsequences("PHYSICAL", "PHYSICAL", { existing: true, trackStock: true })).toEqual([]);
    expect(needsKindConfirmation("DIGITAL", "DIGITAL", { existing: true })).toBe(false);
  });

  it("à la création (produit non enregistré, rien de saisi) : aucun avertissement", () => {
    expect(kindChangeConsequences("PHYSICAL", "DIGITAL", { hasFiles: true })).toEqual([]);
    expect(needsKindConfirmation("PHYSICAL", "SERVICE")).toBe(false);
  });

  it("rappelle que les ventes passées gardent leur nature sur un produit enregistré", () => {
    const out = kindChangeConsequences("PHYSICAL", "DIGITAL", { existing: true, hasFiles: true });
    expect(has(out, "commandes passées")).toBe(true);
    expect(needsKindConfirmation("PHYSICAL", "DIGITAL", { existing: true, hasFiles: true })).toBe(true);
  });

  it("physique → numérique : stock désactivé, poids inutile, fichier requis", () => {
    const out = kindChangeConsequences("PHYSICAL", "DIGITAL", { trackStock: true, weightSet: true });
    expect(has(out, "suivi de stock sera désactivé")).toBe(true);
    expect(has(out, "au moins un fichier")).toBe(true);
    expect(has(out, "poids saisi ne servira plus")).toBe(true);
  });

  it("physique → service : le stock reste possible (places limitées)", () => {
    const out = kindChangeConsequences("PHYSICAL", "SERVICE", { trackStock: true, weightSet: true });
    expect(has(out, "suivi de stock")).toBe(false);
    expect(has(out, "poids saisi ne servira plus")).toBe(true);
  });

  it("numérique → physique : fichiers plus remis, poids à renseigner", () => {
    const out = kindChangeConsequences("DIGITAL", "PHYSICAL", { hasFiles: true });
    expect(has(out, "fichiers attachés ne seront plus remis")).toBe(true);
    expect(has(out, "redevient expédiable")).toBe(true);
  });

  it("sans fichier attaché, rien à dire sur les fichiers en quittant le numérique", () => {
    expect(has(kindChangeConsequences("DIGITAL", "SERVICE", { hasFiles: false }), "fichiers attachés")).toBe(false);
  });

  it("→ carte cadeau : exonération de TVA, promo retirée, suppléments à retirer", () => {
    const out = kindChangeConsequences("PHYSICAL", "GIFT_CARD", { hasPromo: true, hasSupplements: true, trackStock: true });
    expect(has(out, "exonérée de TVA")).toBe(true);
    expect(has(out, "prix promotionnel sera retiré")).toBe(true);
    expect(has(out, "Retirez les suppléments")).toBe(true);
    expect(has(out, "suivi de stock sera désactivé")).toBe(true);
  });

  it("carte cadeau → physique : cartes émises valables, retour à la TVA", () => {
    const out = kindChangeConsequences("GIFT_CARD", "PHYSICAL", {});
    expect(has(out, "cartes déjà émises restent valables")).toBe(true);
    expect(has(out, "soumis à la TVA")).toBe(true);
    expect(has(out, "redevient expédiable")).toBe(true);
  });

  it("l'avertissement « déjà vendu » arrive en premier", () => {
    const out = kindChangeConsequences("PHYSICAL", "GIFT_CARD", { existing: true, hasPromo: true });
    expect(out[0]).toContain("commandes passées");
  });
});

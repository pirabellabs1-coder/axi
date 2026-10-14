import { describe, it, expect } from "vitest";
import { pickOrderVariant } from "@/lib/storefront/variants";

const product = {
  name: "Robe wax",
  variants: [
    { id: "v_ok", available: true },
    { id: "v_off", available: false },
  ],
};

describe("variante désactivée non commandable (constat 2)", () => {
  it("accepte une variante disponible", () => {
    expect(pickOrderVariant(product, "v_ok")).toEqual({ ok: true, variant: product.variants[0] });
  });

  it("refuse une variante available: false avec le message attendu", () => {
    expect(pickOrderVariant(product, "v_off")).toEqual({ ok: false, error: "Variante indisponible pour Robe wax." });
  });

  it("refuse une variante inconnue", () => {
    expect(pickOrderVariant(product, "v_autre")).toEqual({ ok: false, error: "Variante indisponible pour Robe wax." });
  });

  it("exige une variante pour un produit à variantes", () => {
    expect(pickOrderVariant(product, null)).toEqual({ ok: false, error: "Choisissez une variante pour Robe wax." });
  });

  it("produit simple : aucune variante", () => {
    expect(pickOrderVariant({ name: "Sac", variants: [] }, undefined)).toEqual({ ok: true, variant: null });
  });
});

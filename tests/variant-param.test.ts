import { describe, expect, it } from "vitest";
import { requestedVariantParam } from "@/lib/storefront/variants";

describe("fiche produit : variante demandée dans l'URL", () => {
  const id = "cmvariant0001abcd";
  it("lit ?variante= (liens de la fiche) et ?variant= (flux catalogue)", () => {
    expect(requestedVariantParam({ variante: id })).toBe(id);
    expect(requestedVariantParam({ variant: id })).toBe(id);
  });
  it("?variante= prime sur ?variant=", () => {
    expect(requestedVariantParam({ variante: id, variant: "cmautre000000000" })).toBe(id);
  });
  it("valeur invalide ignorée (repli sur l'autre paramètre, sinon null)", () => {
    expect(requestedVariantParam({ variante: "<script>", variant: id })).toBe(id);
    expect(requestedVariantParam({ variant: "court" })).toBeNull();
    expect(requestedVariantParam({ variant: "a".repeat(65) })).toBeNull();
    expect(requestedVariantParam({})).toBeNull();
  });
  it("paramètre répété : première valeur", () => {
    expect(requestedVariantParam({ variant: [id, "x"] })).toBe(id);
  });
});

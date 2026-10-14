import { describe, it, expect } from "vitest";
import { changeSelection, findVariant, initialSelection, normalizeOptions, valueStatus, variantAttributes } from "@/lib/storefront/variants";

const robe = [
  { id: "v-s-bleu", attributes: { Taille: "S", Couleur: "Bleu" }, stock: 3, available: true },
  { id: "v-m-bleu", attributes: { Taille: "M", Couleur: "Bleu" }, stock: 5, available: true },
  { id: "v-s-orange", attributes: { Taille: "S", Couleur: "Orange" }, stock: 4, available: true },
  { id: "v-m-orange", attributes: { Taille: "M", Couleur: "Orange" }, stock: 0, available: true },
  { id: "v-l-orange", attributes: { Taille: "L", Couleur: "Orange" }, stock: 6, available: true },
];

describe("normalizeOptions", () => {
  it("déduit les options des attributs des variantes (sans Product.options)", () => {
    const opts = normalizeOptions(null, robe);
    expect(opts.map((o) => o.name)).toEqual(["Taille", "Couleur"]);
    expect(opts[0].values.map((v) => v.value)).toEqual(["S", "M", "L"]);
    expect(opts[1].type).toBe("color");
    expect(opts[0].type).toBe("size");
  });

  it("respecte l'ordre et les pastilles de Product.options, retire les valeurs jamais utilisées", () => {
    const raw = [
      { name: "Couleur", type: "color", values: [{ value: "Orange", swatch: "#E0702A" }, { value: "Vert", swatch: "#2F6B3A" }, { value: "Bleu", swatch: "#1F4E9C" }] },
      { name: "Taille", type: "size", values: ["L", "M", "S"] },
    ];
    const opts = normalizeOptions(raw, robe);
    expect(opts.map((o) => o.name)).toEqual(["Couleur", "Taille"]);
    expect(opts[0].values).toEqual([{ value: "Orange", swatch: "#E0702A" }, { value: "Bleu", swatch: "#1F4E9C" }]);
    expect(opts[1].values.map((v) => v.value)).toEqual(["L", "M", "S"]);
  });

  it("ignore les pastilles et images invalides", () => {
    const opts = normalizeOptions([{ name: "Couleur", values: [{ value: "Rouge", swatch: "red", image: "javascript:alert(1)" }] }]);
    expect(opts[0].values[0]).toEqual({ value: "Rouge" });
  });

  it("variantAttributes ne garde que des chaînes", () => {
    expect(variantAttributes({ Taille: "M", x: { a: 1 }, Pointure: 42 })).toEqual({ Taille: "M", Pointure: "42" });
    expect(variantAttributes("nope")).toEqual({});
  });
});

describe("résolution de variante", () => {
  const options = normalizeOptions(null, robe);

  it("trouve la variante exacte et rien si une option manque", () => {
    expect(findVariant(options, robe, { Taille: "M", Couleur: "Bleu" })?.id).toBe("v-m-bleu");
    expect(findVariant(options, robe, { Taille: "M" })).toBeNull();
    expect(findVariant(options, robe, { Taille: "L", Couleur: "Bleu" })).toBeNull();
  });

  it("états par combinaison : disponible, épuisé, inexistant", () => {
    const sel = { Couleur: "Orange" };
    expect(valueStatus(options, robe, sel, "Taille", "S", true)).toBe("available");
    expect(valueStatus(options, robe, sel, "Taille", "M", true)).toBe("soldout");
    expect(valueStatus(options, robe, { Couleur: "Bleu" }, "Taille", "L", true)).toBe("unavailable");
    // Sans suivi de stock, une variante à 0 reste achetable.
    expect(valueStatus(options, robe, sel, "Taille", "M", false)).toBe("available");
  });

  it("sélection initiale : variante demandée (?variante=), sinon première achetable", () => {
    expect(initialSelection(options, robe, true, "v-l-orange")).toEqual({ Taille: "L", Couleur: "Orange" });
    expect(initialSelection(options, robe, true, "inconnue")).toEqual({ Taille: "S", Couleur: "Bleu" });
    const allOut = robe.map((v) => ({ ...v, stock: 0 }));
    expect(initialSelection(options, allOut, true)).toEqual({ Taille: "S", Couleur: "Bleu" });
  });

  it("changer une valeur ajuste les autres options vers une combinaison existante", () => {
    // Bleu / M → L : L n'existe qu'en Orange.
    expect(changeSelection(options, robe, { Taille: "M", Couleur: "Bleu" }, "Taille", "L", true)).toEqual({ Taille: "L", Couleur: "Orange" });
    // Combinaison existante : conservée telle quelle.
    expect(changeSelection(options, robe, { Taille: "S", Couleur: "Bleu" }, "Couleur", "Orange", true)).toEqual({ Taille: "S", Couleur: "Orange" });
  });

  it("produit sans variantes : aucune sélection, aucune variante", () => {
    expect(initialSelection([], [], true)).toEqual({});
    expect(findVariant([], [], {})).toBeNull();
  });
});

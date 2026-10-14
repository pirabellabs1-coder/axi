import { describe, it, expect } from "vitest";
import { buildVariantMatrix, combinations, emptyVariant, optionsFromVariants, readOptions, stockSummary, variantName, type ProductOption, type VariantDraft } from "@/lib/products/variants";
import { productPayloadSchema, variantsConsistencyIssue } from "@/lib/products/schemas";

const color = (values: string[]): ProductOption => ({ name: "Couleur", type: "color", values: values.map((value) => ({ value })) });
const size = (values: string[]): ProductOption => ({ name: "Taille", type: "size", values: values.map((value) => ({ value })) });
const withId = (v: VariantDraft, id: string, price: number): VariantDraft => ({ ...v, id, price, stock: 3 });

describe("matrice de variantes", () => {
  it("génère le produit cartésien dans l'ordre des options", () => {
    const opts = [color(["Rouge", "Jaune"]), size(["S", "M", "L"])];
    const combos = combinations(opts);
    expect(combos).toHaveLength(6);
    expect(variantName(combos[0], opts)).toBe("Rouge / S");
    expect(variantName(combos[5], opts)).toBe("Jaune / L");
  });

  it("ajouter une valeur conserve les variantes existantes (id, prix, stock)", () => {
    const opts = [color(["Rouge", "Jaune"]), size(["S", "M"])];
    const first = buildVariantMatrix(opts, []).map((v, i) => withId(v, `v${i}`, 1000 + i));
    const next = buildVariantMatrix([color(["Rouge", "Jaune"]), size(["S", "M", "L"])], first);
    expect(next).toHaveLength(6);
    for (const old of first) {
      const kept = next.find((n) => n.id === old.id)!;
      expect(kept.attributes).toEqual(old.attributes);
      expect(kept.price).toBe(old.price);
      expect(kept.stock).toBe(3);
    }
    expect(next.filter((n) => !n.id)).toHaveLength(2);
  });

  it("retirer une valeur supprime uniquement ses combinaisons", () => {
    const opts = [color(["Rouge", "Jaune"]), size(["S", "M", "L"])];
    const first = buildVariantMatrix(opts, []).map((v, i) => withId(v, `v${i}`, 1000 + i));
    const next = buildVariantMatrix([color(["Rouge"]), size(["S", "M", "L"])], first);
    expect(next.map((n) => n.id)).toEqual(first.filter((f) => f.attributes.Couleur === "Rouge").map((f) => f.id));
  });

  it("ajouter une option rattache les variantes existantes à la première valeur", () => {
    const first = buildVariantMatrix([color(["Rouge", "Jaune"])], []).map((v, i) => withId(v, `c${i}`, 500));
    const next = buildVariantMatrix([color(["Rouge", "Jaune"]), size(["S", "M"])], first);
    expect(next).toHaveLength(4);
    expect(next.find((n) => n.id === "c0")?.attributes).toEqual({ Couleur: "Rouge", Taille: "S" });
    expect(next.find((n) => n.id === "c1")?.attributes).toEqual({ Couleur: "Jaune", Taille: "S" });
  });

  it("retirer une option fusionne sans dupliquer les ids", () => {
    const first = buildVariantMatrix([color(["Rouge"]), size(["S", "M"])], []).map((v, i) => withId(v, `x${i}`, 700));
    const next = buildVariantMatrix([color(["Rouge"])], first);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("x0");
  });

  it("renommer une valeur garde la variante", () => {
    const first = buildVariantMatrix([color(["Rouge", "Jaune"])], []).map((v, i) => withId(v, `r${i}`, 900));
    const next = buildVariantMatrix([color(["Bordeaux", "Jaune"])], first, { Couleur: { Rouge: "Bordeaux" } });
    expect(next[0]).toMatchObject({ id: "r0", attributes: { Couleur: "Bordeaux" } });
  });

  it("reconstruit les options à partir de variantes anciennes et lit le JSON tolérant", () => {
    const opts = optionsFromVariants([{ attributes: { Taille: "M", Couleur: "Rouge" } }, { attributes: { Taille: "L", Couleur: "Rouge" } }]);
    expect(opts.map((o) => [o.name, o.type, o.values.length])).toEqual([["Taille", "size", 2], ["Couleur", "color", 1]]);
    expect(readOptions([{ name: "Couleur", values: ["Rouge", { value: "Jaune", swatch: "#FFD600" }] }, "x"])).toEqual([
      { name: "Couleur", type: "color", values: [{ value: "Rouge" }, { value: "Jaune", swatch: "#FFD600" }] },
    ]);
  });

  it("résume le stock total", () => {
    expect(stockSummary({ trackStock: true, stock: 0, variants: [{ stock: 2 }, { stock: 10 }] }).label).toBe("12 en stock pour 2 variantes");
    expect(stockSummary({ trackStock: false, stock: 4, variants: [] }).label).toBe("Non suivi");
  });
});

describe("validation zod du produit", () => {
  const base = { name: "Robe wax", price: 15000 };
  const opts = [color(["Rouge", "Jaune"]), size(["S"])];
  const variants = buildVariantMatrix(opts, []);

  it("accepte un produit avec options et variantes cohérentes", () => {
    const r = productPayloadSchema.safeParse({ ...base, options: opts, variants });
    expect(r.success).toBe(true);
  });

  it("refuse plus de 3 options", () => {
    const four = [color(["A"]), size(["S"]), { name: "Matière", type: "text", values: [{ value: "Coton" }] }, { name: "Coupe", type: "text", values: [{ value: "Droite" }] }];
    const r = productPayloadSchema.safeParse({ ...base, options: four, variants: buildVariantMatrix(four as ProductOption[], []) });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.message.includes("3 options"))).toBe(true);
  });

  it("refuse plus de 100 variantes", () => {
    const big = [color(Array.from({ length: 11 }, (_, i) => `C${i}`)), size(Array.from({ length: 10 }, (_, i) => `T${i}`))];
    const r = productPayloadSchema.safeParse({ ...base, options: big, variants: buildVariantMatrix(big, []) });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.message.includes("100 variantes"))).toBe(true);
  });

  it("exige des pastilles #RRGGBB", () => {
    const ok = productPayloadSchema.safeParse({ ...base, options: [{ name: "Couleur", type: "color", values: [{ value: "Rouge", swatch: "#c62828" }] }], variants: [emptyVariant({ Couleur: "Rouge" })] });
    expect(ok.success).toBe(true);
    expect(ok.data?.options[0].values[0].swatch).toBe("#C62828");
    for (const bad of ["red", "#FFF", "#GGGGGG", "#1234567"]) {
      const r = productPayloadSchema.safeParse({ ...base, options: [{ name: "Couleur", type: "color", values: [{ value: "Rouge", swatch: bad }] }], variants: [emptyVariant({ Couleur: "Rouge" })] });
      expect(r.success, bad).toBe(false);
    }
  });

  it("détecte les variantes incohérentes avec les options", () => {
    expect(variantsConsistencyIssue(opts, [emptyVariant({ Couleur: "Vert", Taille: "S" })])).toMatch(/inconnue/);
    expect(variantsConsistencyIssue(opts, [emptyVariant({ Couleur: "Rouge", Taille: "S" }), emptyVariant({ Couleur: "Rouge", Taille: "S" })])).toMatch(/même combinaison/);
    expect(variantsConsistencyIssue([], [emptyVariant({ Couleur: "Rouge" })])).toMatch(/sans option/);
  });

  it("refuse les valeurs ou options en double et un prix promo supérieur", () => {
    expect(productPayloadSchema.safeParse({ ...base, options: [color(["Rouge", "rouge"])], variants: [] }).success).toBe(false);
    expect(productPayloadSchema.safeParse({ ...base, promoPrice: 20000 }).success).toBe(false);
  });
});

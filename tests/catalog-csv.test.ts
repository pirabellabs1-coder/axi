import { describe, it, expect } from "vitest";
import { exportCatalogRows, guessColumn, parseAmount, parseCatalogRows } from "@/lib/products/csv-catalog";
import { csvEscape, parseCsv, toCsv } from "@/lib/csv";
import { productPayloadSchema } from "@/lib/products/schemas";

const CSV = `Handle;Titre;Prix;Option1 Nom;Option1 Valeur;Option2 Nom;Option2 Valeur;SKU;Stock;Image;Étiquettes
robe-wax;Robe wax;15000;Couleur;Rouge;Taille;S;RW-R-S;4;https://exemple.test/rouge.jpg;wax, femme
robe-wax;;15000;Couleur;Rouge;Taille;M;RW-R-M;2;;
robe-wax;;17 000;Couleur;Jaune;Taille;S;RW-J-S;0;https://exemple.test/jaune.jpg;
sac;Sac cuir;25000;;;;;SAC-1;3;;cuir
chemise;Chemise;abc;Couleur;Bleu;;;;;;
;Sans prix;;;;;;;;;
pull;Pull;9000;Couleur;Noir;;;;;;
pull;;9000;Couleur;Noir;;;;;;`;

function load() {
  const rows = parseCsv(CSV);
  const mapping = rows[0].map(guessColumn);
  return parseCatalogRows(rows.slice(1), mapping, 2);
}

describe("export CSV : injection de formules (m4)", () => {
  const TAB = String.fromCharCode(9);
  const CRLF = String.fromCharCode(13, 10);

  it("formule neutralisée, y compris après des espaces de tête (comme csvCell)", () => {
    for (const evil of ['=HYPERLINK("http://x")', "+1+1", "-2+3", "@SUM(A1)", `${TAB}=1`, "  =cmd|' /C calc'!A0", ` ${TAB}@SUM(A1)`]) {
      expect(csvEscape(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvEscape("Robe wax")).toBe("Robe wax");
    expect(csvEscape(null)).toBe("");
    expect(toCsv(["Titre"], [["  =1+1"]]).split(CRLF)[1].replace(/^"/, "").startsWith("'")).toBe(true);
  });
});

describe("import CSV avec variantes", () => {
  it("reconnaît les en-têtes français et Shopify", () => {
    expect(guessColumn("Variant Price")).toBe("price");
    expect(guessColumn("Option1 Name")).toBe("opt1Name");
    expect(guessColumn("étiquettes")).toBe("tags");
    expect(guessColumn("inconnu")).toBe("");
  });

  it("regroupe une ligne par variante en un produit avec options", () => {
    const { products } = load();
    const robe = products.find((p) => p.handle === "robe-wax")!;
    expect(robe.options.map((o) => [o.name, o.type, o.values.map((v) => v.value)])).toEqual([
      ["Couleur", "color", ["Rouge", "Jaune"]],
      ["Taille", "size", ["S", "M"]],
    ]);
    expect(robe.variants).toHaveLength(3);
    expect(robe.price).toBe(15000);
    expect(robe.variants.map((v) => v.price)).toEqual([null, null, 17000]);
    expect(robe.variants[0]).toMatchObject({ sku: "RW-R-S", stock: 4 });
    expect(robe.images.map((i) => i.url)).toEqual(["https://exemple.test/rouge.jpg", "https://exemple.test/jaune.jpg"]);
    expect(robe.tags).toEqual(["wax", "femme"]);
  });

  it("produit simple sans option", () => {
    const sac = load().products.find((p) => p.handle === "sac")!;
    expect(sac).toMatchObject({ price: 25000, sku: "SAC-1", stock: 3, options: [], variants: [] });
  });

  it("rapporte les erreurs avec le numéro de ligne", () => {
    const { issues, products } = load();
    expect(products.map((p) => p.handle)).toEqual(["robe-wax", "sac"]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 6, message: expect.stringMatching(/Prix invalide/) }),
        expect.objectContaining({ line: 7 }),
        expect.objectContaining({ line: 9, message: expect.stringMatching(/double/) }),
      ]),
    );
  });

  it("chaque brouillon importé passe la validation du formulaire produit", () => {
    for (const p of load().products) {
      const r = productPayloadSchema.safeParse({ name: p.name, price: p.price, options: p.options, variants: p.variants, images: p.images, tags: p.tags });
      expect(r.success, p.handle).toBe(true);
    }
  });

  it("export puis réimport : aller-retour sans perte des variantes", () => {
    const { products } = load();
    const robe = products[0];
    const { headers, rows } = exportCatalogRows([
      { slug: robe.handle, name: robe.name, description: null, vendor: null, productType: null, tags: robe.tags, status: "ACTIVE", collection: null, seoTitle: null, seoDescription: null, price: robe.price, compareAtPrice: null, costPrice: null, sku: null, trackStock: true, stock: 0, weightGrams: null, images: robe.images, options: robe.options, variants: robe.variants },
    ]);
    const again = parseCatalogRows(rows.map((r) => r.map(String)), headers.map(guessColumn), 2);
    expect(again.issues).toEqual([]);
    expect(again.products[0].variants.map((v) => [v.attributes, v.price, v.stock])).toEqual(robe.variants.map((v) => [v.attributes, v.price, v.stock]));
  });

  it("montants : espaces, virgules, invalides", () => {
    expect(parseAmount("12 000")).toBe(12000);
    expect(parseAmount("12000,00")).toBe(12000);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("15 000 FCFA")).toBe(15000);
    expect(Number.isNaN(parseAmount("abc"))).toBe(true);
    expect(Number.isNaN(parseAmount("1-2"))).toBe(true);
  });
});

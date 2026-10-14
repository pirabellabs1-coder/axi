import { describe, it, expect } from "vitest";
import { exportCatalogRows, guessColumn, parseCatalogRows, parseQuantity } from "@/lib/products/csv-catalog";
import { draftToPayload, type ImportExisting } from "@/lib/products/import-payload";
import { productPayloadSchema } from "@/lib/products/schemas";
import { parseCsv } from "@/lib/csv";

/** Colonnes d'inventaire du CSV : politique de rupture (format Shopify), seuil, code-barres d'un produit simple. */

function parse(csv: string) {
  const rows = parseCsv(csv);
  return parseCatalogRows(rows.slice(1), rows[0].map(guessColumn), 2);
}

const CSV = `Handle;Title;Variant Price;Option1 Name;Option1 Value;Variant Inventory Qty;Variant Inventory Policy;Variant Barcode;Seuil stock bas
robe;Robe;15000;Taille;S;0;continue;111;2
robe;;15000;Taille;M;4;deny;222;
sac;Sac cuir;25000;;;3;continue;3760001;8
pull;Pull;9000;;;1;peut-être;;abc`;

function existing(over: Partial<ImportExisting> = {}): ImportExisting {
  return {
    id: "prod_existing_1", description: null, status: "ACTIVE", isFeatured: false, categoryId: null, productType: null, vendor: null, tags: [], seoTitle: null, seoDescription: null,
    compareAtPrice: null, costPrice: null, promoPrice: null, promoStart: null, promoEnd: null, sku: null, barcode: null, trackStock: true, stock: -2, inventoryPolicy: "CONTINUE", lowStockThreshold: 4,
    minQty: 1, maxQty: null, weightGrams: null, images: [], options: [], details: [], variants: [], manualCollectionIds: [],
    ...over,
  };
}

describe("CSV : Variant Inventory Policy, seuil, code-barres", () => {
  it("reconnaît l'en-tête Shopify et les alias français", () => {
    expect(guessColumn("Variant Inventory Policy")).toBe("inventoryPolicy");
    expect(guessColumn("Politique de stock")).toBe("inventoryPolicy");
    expect(guessColumn("Seuil stock bas")).toBe("lowStock");
    expect(guessColumn("Variant Barcode")).toBe("barcode");
  });

  it("lit la politique par variante, et sur le produit pour un produit simple", () => {
    const { products, issues } = parse(CSV);
    const robe = products.find((p) => p.handle === "robe")!;
    expect(robe.variants.map((v) => v.inventoryPolicy)).toEqual(["CONTINUE", "DENY"]);
    expect(robe.lowStockThreshold).toBe(2);
    expect(robe.inventoryPolicy).toBeNull(); // avec variantes : réglage par variante
    const sac = products.find((p) => p.handle === "sac")!;
    expect(sac).toMatchObject({ inventoryPolicy: "CONTINUE", barcode: "3760001", lowStockThreshold: 8, stock: 3 });
    // Valeurs illisibles : signalées, non bloquantes
    const pull = products.find((p) => p.handle === "pull")!;
    expect(pull.inventoryPolicy).toBeNull();
    expect(pull.lowStockThreshold).toBeNull();
    expect(issues.some((i) => /deny ou continue/.test(i.message))).toBe(true);
    expect(issues.some((i) => /Seuil de stock bas/.test(i.message))).toBe(true);
  });

  it("création : la charge utile passe la validation du formulaire avec ces champs", () => {
    const { products } = parse(CSV);
    const sac = draftToPayload(products.find((p) => p.handle === "sac")!, true, []);
    const d = productPayloadSchema.parse(sac);
    expect(d).toMatchObject({ inventoryPolicy: "CONTINUE", lowStockThreshold: 8, barcode: "3760001", trackStock: true, stock: 3 });
    const robe = productPayloadSchema.parse(draftToPayload(products.find((p) => p.handle === "robe")!, true, []));
    expect(robe.variants.map((v) => v.inventoryPolicy)).toEqual(["CONTINUE", "DENY"]);
  });

  it("mise à jour : colonnes absentes = valeurs existantes conservées ; survente réexportée = aucun mouvement", () => {
    const { products } = parse(`Handle;Titre;Prix;Stock\nsac;Sac cuir;25000;-2`);
    const payload = draftToPayload(products[0], true, [], existing());
    expect(payload).toMatchObject({ inventoryPolicy: "CONTINUE", lowStockThreshold: 4, stock: -2, stockBase: -2 });
    expect(productPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("survente qui a bougé depuis l'export : la valeur négative du CSV est traitée comme inchangée, avec avertissement", () => {
    const { products } = parse(`Handle;Titre;Prix;Stock\nsac;Sac cuir;25000;-5`);
    const warnings: string[] = [];
    const payload = draftToPayload(products[0], true, [], existing({ stock: -1 }), (m) => warnings.push(m));
    expect(payload).toMatchObject({ stock: -1, stockBase: -1 }); // aucun mouvement
    expect(productPayloadSchema.safeParse(payload).success).toBe(true);
    expect(warnings[0]).toMatch(/Stock -5 ignoré.*actuel : -1/);
    // Variante : même règle
    const v = parse(`Handle;Titre;Prix;Option1 Nom;Option1 Valeur;Stock\nrobe;Robe;15000;Taille;S;-4`).products[0];
    const w2: string[] = [];
    const pv = draftToPayload(
      v,
      true,
      [],
      existing({ options: [{ name: "Taille", type: "size", values: [{ value: "S" }] }], variants: [{ id: "var_s_000001", attributes: { Taille: "S" }, price: null, compareAtPrice: null, sku: null, barcode: null, stock: 2, weightGrams: null, imageUrl: null, available: true }] }),
      (m) => w2.push(m),
    );
    expect(pv.variants?.[0]).toMatchObject({ stock: 2, stockBase: 2 });
    expect(w2).toHaveLength(1);
  });

  it("une quantité négative pour un produit nouveau est refusée par le schéma", () => {
    const { products } = parse(`Handle;Titre;Prix;Stock\nsac;Sac cuir;25000;-5`);
    expect(productPayloadSchema.safeParse(draftToPayload(products[0], true, [])).success).toBe(false);
  });

  it("stock illisible : erreur de ligne, colonne non considérée comme fournie (stock existant conservé)", () => {
    const { products, issues } = parse(`Handle;Titre;Prix;Stock\nsac;Sac cuir;25000;douze`);
    expect(issues.some((i) => i.line === 2 && /Stock « douze » illisible/.test(i.message))).toBe(true);
    expect(products[0].given).not.toContain("stock");
    expect(draftToPayload(products[0], true, [], existing({ stock: 7 }))).toMatchObject({ stock: 7, stockBase: 7 });
    const v = parse(`Handle;Titre;Prix;Option1 Nom;Option1 Valeur;Stock\nrobe;Robe;15000;Taille;S;x`);
    expect(v.issues.some((i) => /illisible/.test(i.message))).toBe(true);
    expect(v.products[0].variants[0].given).not.toContain("stock");
  });

  it("parseQuantity accepte un entier négatif (export d'une survente)", () => {
    expect(parseQuantity("-3")).toBe(-3);
    expect(parseQuantity("12")).toBe(12);
    expect(parseQuantity("")).toBeNull();
    expect(Number.isNaN(parseQuantity("abc"))).toBe(true);
  });

  it("export : deny / continue par ligne, seuil sur la 1re ligne, code-barres du produit simple", () => {
    const { headers, rows } = exportCatalogRows([
      {
        slug: "sac", name: "Sac", description: null, vendor: null, productType: null, tags: [], status: "ACTIVE", collection: null, seoTitle: null, seoDescription: null,
        price: 25000, compareAtPrice: null, costPrice: null, sku: "SAC-1", barcode: "3760001", trackStock: true, stock: -1, inventoryPolicy: "CONTINUE", lowStockThreshold: 8,
        weightGrams: null, images: [], options: [], variants: [],
      },
      {
        slug: "robe", name: "Robe", description: null, vendor: null, productType: null, tags: [], status: "ACTIVE", collection: null, seoTitle: null, seoDescription: null,
        price: 15000, compareAtPrice: null, costPrice: null, sku: null, trackStock: true, stock: 0, weightGrams: null, images: [],
        options: [{ name: "Taille", type: "size", values: [{ value: "S" }, { value: "M" }] }],
        variants: [
          { attributes: { Taille: "S" }, price: null, compareAtPrice: null, sku: null, barcode: "111", stock: 0, weightGrams: null, imageUrl: null, available: true, inventoryPolicy: "CONTINUE" },
          { attributes: { Taille: "M" }, price: null, compareAtPrice: null, sku: null, barcode: null, stock: 2, weightGrams: null, imageUrl: null, available: true },
        ],
      },
    ]);
    const col = (h: string) => headers.indexOf(h);
    expect(col("Variant Inventory Policy")).toBeGreaterThan(-1);
    expect(rows[0][col("Variant Inventory Policy")]).toBe("continue");
    expect(rows[0][col("Seuil stock bas")]).toBe(8);
    expect(rows[0][col("Code-barres")]).toBe("3760001");
    expect(rows[0][col("Stock")]).toBe(-1);
    expect(rows[1][col("Variant Inventory Policy")]).toBe("continue");
    expect(rows[2][col("Variant Inventory Policy")]).toBe("deny");
    // Aller-retour : le fichier exporté se réimporte avec la même politique
    const csv = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
    const back = parse(csv).products;
    expect(back.find((p) => p.handle === "sac")).toMatchObject({ inventoryPolicy: "CONTINUE", lowStockThreshold: 8, stock: -1 });
    expect(back.find((p) => p.handle === "robe")!.variants.map((v) => v.inventoryPolicy)).toEqual(["CONTINUE", "DENY"]);
  });
});

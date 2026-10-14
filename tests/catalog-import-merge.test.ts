import { describe, it, expect } from "vitest";
import { guessColumn, parseCatalogRows } from "@/lib/products/csv-catalog";
import { draftToPayload, type ImportExisting } from "@/lib/products/import-payload";
import { productPayloadSchema } from "@/lib/products/schemas";
import { parseCsv } from "@/lib/csv";

function parse(csv: string) {
  const rows = parseCsv(csv);
  return parseCatalogRows(rows.slice(1), rows[0].map(guessColumn), 2);
}

// Image existante déjà migrée vers le stockage des médias (les data-URL ne sont plus acceptées à l'écriture).
const DATA_URL = "/media/stores/storeaaaa01/2026/10/" + "ab".repeat(32) + ".png";

function existing(over: Partial<ImportExisting> = {}): ImportExisting {
  return {
    id: "prod_existing_1",
    description: "Description d'origine",
    status: "ACTIVE",
    isFeatured: true,
    categoryId: "cat_main_0001",
    productType: "Robe",
    vendor: "Maison A",
    tags: ["wax", "femme"],
    seoTitle: "SEO d'origine",
    seoDescription: null,
    compareAtPrice: 30000,
    costPrice: 8000,
    promoPrice: 12000,
    promoStart: new Date("2026-01-01T00:00:00Z"),
    promoEnd: new Date("2027-01-01T00:00:00Z"),
    sku: "ROBE-1",
    trackStock: true,
    stock: 7,
    minQty: 2,
    maxQty: 5,
    weightGrams: 400,
    images: [{ url: DATA_URL, alt: "photo compressée" }],
    options: [],
    details: [{ title: "Entretien", body: "Lavage à froid" }],
    variants: [],
    manualCollectionIds: ["cat_main_0001", "cat_extra_001"],
    ...over,
  };
}

const collections = [
  { id: "cat_main_0001", name: "Robes", slug: "robes" },
  { id: "cat_other_001", name: "Soldes", slug: "soldes" },
];

describe("import CSV — prix des variantes sans prix (constat 5)", () => {
  it("une variante sans prix hérite du prix de base lu, pas du minimum", () => {
    const { products, issues } = parse(`Handle;Titre;Prix;Option1 Nom;Option1 Valeur;SKU
robe;Robe;20000;Taille;S;R-S
robe;;;Taille;M;R-M
robe;;15000;Taille;L;R-L`);
    expect(issues).toEqual([]);
    const robe = products[0];
    expect(robe.price).toBe(15000);
    // M sans prix → 20000 (prix de base lu) ; S au même prix garde 20000 explicite ; L = minimum → hérite (null).
    expect(robe.variants.map((v) => [v.attributes.Taille, v.price])).toEqual([
      ["S", 20000],
      ["M", 20000],
      ["L", null],
    ]);
  });
});

describe("import CSV — mise à jour en partant de la fiche existante (constat 4)", () => {
  it("ne remplace que les colonnes associées non vides et conserve le reste", () => {
    const { products } = parse(`Handle;Titre;Prix;Description;Marque;Image;Collection;Stock
robe;Robe wax;15000;;;;;`);
    const payload = draftToPayload(products[0], true, collections, existing());
    const d = productPayloadSchema.parse(payload);
    expect(d).toMatchObject({
      productId: "prod_existing_1",
      name: "Robe wax",
      price: 15000,
      description: "Description d'origine",
      vendor: "Maison A",
      productType: "Robe",
      tags: ["wax", "femme"],
      isFeatured: true,
      minQty: 2,
      maxQty: 5,
      promoPrice: 12000,
      compareAtPrice: 30000,
      costPrice: 8000,
      sku: "ROBE-1",
      weightGrams: 400,
      categoryId: "cat_main_0001",
      collectionIds: ["cat_extra_001"],
      details: [{ title: "Entretien", body: "Lavage à froid" }],
      trackStock: true,
      // Stock absent : stock = base ⇒ delta nul, aucun mouvement.
      stock: 7,
      stockBase: 7,
    });
    expect(d.promoStart?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(d.images).toEqual([{ url: DATA_URL, alt: "photo compressée" }]);
  });

  it("applique les colonnes fournies (statut, collection, images, stock absolu sans base)", () => {
    const { products } = parse(`Handle;Titre;Prix;Statut;Collection;Image;Stock;Étiquettes
robe;Robe wax;15000;brouillon;Soldes;https://exemple.test/a.jpg;3;été`);
    const d = productPayloadSchema.parse(draftToPayload(products[0], true, collections, existing()));
    expect(d.status).toBe("DRAFT");
    expect(d.categoryId).toBe("cat_other_001");
    expect(d.collectionIds).toEqual(["cat_main_0001", "cat_extra_001"]);
    expect(d.images).toEqual([{ url: "https://exemple.test/a.jpg", alt: "" }]);
    expect(d.tags).toEqual(["été"]);
    expect(d.stock).toBe(3);
    expect(d.stockBase).toBeNull();
  });

  it("collection inconnue : nouvelle collection créée, catégorie principale retirée", () => {
    const { products } = parse(`Handle;Titre;Prix;Collection
robe;Robe wax;15000;Nouveautés`);
    const d = productPayloadSchema.parse(draftToPayload(products[0], true, collections, existing()));
    expect(d.categoryId).toBeNull();
    expect(d.newCollection).toBe("Nouveautés");
  });

  it("variantes : fusion par combinaison, champs vides conservés, stock vide inchangé", () => {
    const ex = existing({
      options: [{ name: "Couleur", type: "color", values: [{ value: "Rouge", swatch: "#FF0000" }, { value: "Bleu", swatch: "#0000FF" }] }],
      variants: [
        { id: "var_rouge_001", attributes: { Couleur: "Rouge" }, price: null, compareAtPrice: 25000, sku: "R-1", barcode: "111", stock: 4, weightGrams: 300, imageUrl: null, available: false },
        { id: "var_bleu_0001", attributes: { Couleur: "Bleu" }, price: null, compareAtPrice: null, sku: "B-1", barcode: null, stock: 9, weightGrams: null, imageUrl: null, available: true },
      ],
    });
    const { products } = parse(`Handle;Titre;Prix;Option1 Nom;Option1 Valeur;SKU;Stock
robe;Robe wax;15000;Couleur;Rouge;;
robe;;15000;Couleur;Bleu;B-2;2
robe;;15000;Couleur;Vert;;5`);
    const d = productPayloadSchema.parse(draftToPayload(products[0], true, collections, ex));
    const byColor = Object.fromEntries(d.variants.map((v) => [v.attributes.Couleur, v]));
    expect(byColor.Rouge).toMatchObject({ id: "var_rouge_001", sku: "R-1", barcode: "111", compareAtPrice: 25000, weightGrams: 300, available: false, stock: 4, stockBase: 4 });
    expect(byColor.Bleu).toMatchObject({ id: "var_bleu_0001", sku: "B-2", stock: 2, stockBase: null });
    expect(byColor.Vert).toMatchObject({ stock: 5, stockBase: null });
    expect(byColor.Vert.id).toBeUndefined();
    expect(d.options[0].values.find((v) => v.value === "Rouge")?.swatch).toBe("#FF0000");
  });

  it("sans colonnes d'options : les variantes existantes sont conservées telles quelles", () => {
    const ex = existing({
      options: [{ name: "Taille", type: "size", values: [{ value: "S" }, { value: "M" }] }],
      variants: [
        { id: "var_s_000001", attributes: { Taille: "S" }, price: 16000, compareAtPrice: null, sku: "S", barcode: null, stock: 1, weightGrams: null, imageUrl: null, available: true },
        { id: "var_m_000001", attributes: { Taille: "M" }, price: null, compareAtPrice: null, sku: "M", barcode: null, stock: 0, weightGrams: null, imageUrl: null, available: true },
      ],
    });
    const { products } = parse(`Handle;Titre;Prix
robe;Robe wax;15000`);
    const d = productPayloadSchema.parse(draftToPayload(products[0], true, collections, ex));
    expect(d.variants.map((v) => [v.id, v.price, v.stock, v.stockBase])).toEqual([
      ["var_s_000001", 16000, 1, 1],
      ["var_m_000001", null, 0, 0],
    ]);
  });

  it("création : comportement inchangé (pas de productId ni de base de stock)", () => {
    const { products } = parse(`Handle;Titre;Prix;Stock;Collection
sac;Sac;9000;3;Inconnue`);
    const d = productPayloadSchema.parse(draftToPayload(products[0], true, collections, null));
    expect(d.productId).toBeUndefined();
    expect(d).toMatchObject({ stock: 3, stockBase: null, trackStock: true, categoryId: null, newCollection: "Inconnue", isFeatured: false });
  });
});

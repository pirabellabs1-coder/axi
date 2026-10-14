/**
 * Import / export CSV du catalogue au format « une ligne par variante », proche de Shopify.
 * Fonctions pures (aucun accès base) : l'aperçu client et l'action serveur partagent le même parseur.
 * Testé dans tests/catalog-csv.test.ts.
 */
import { slugify } from "@/lib/utils";
import { MAX_OPTIONS, MAX_VARIANTS, guessType, variantName, type ProductOption, type VariantDraft } from "./variants";
import { parseInventoryPolicy, policyToCsv, MAX_LOW_STOCK_THRESHOLD, type InventoryPolicyValue } from "@/lib/inventory/policy";

export type CsvColumn =
  | "handle" | "title" | "description" | "vendor" | "type" | "tags" | "status" | "collection" | "kind"
  | "opt1Name" | "opt1Value" | "opt2Name" | "opt2Value" | "opt3Name" | "opt3Value"
  | "sku" | "price" | "compareAt" | "cost" | "stock" | "barcode" | "weight" | "variantImage" | "available"
  | "inventoryPolicy" | "lowStock"
  | "image" | "imageAlt" | "seoTitle" | "seoDescription";

/** En-têtes exportés (ordre) et alias reconnus à l'import (français, Shopify, variantes courantes). */
export const CSV_COLUMNS: { id: CsvColumn; header: string; aliases: string[] }[] = [
  { id: "handle", header: "Handle", aliases: ["handle", "identifiant", "slug", "url"] },
  { id: "title", header: "Titre", aliases: ["titre", "title", "nom", "name", "produit", "product"] },
  { id: "description", header: "Description", aliases: ["description", "body (html)", "body", "corps", "desc"] },
  { id: "vendor", header: "Marque", aliases: ["marque", "vendor", "fournisseur", "brand"] },
  { id: "type", header: "Type", aliases: ["type", "type de produit", "product type", "type (personnalisé)", "custom product type"] },
  { id: "tags", header: "Étiquettes", aliases: ["étiquettes", "etiquettes", "tags", "mots-clés"] },
  { id: "status", header: "Statut", aliases: ["statut", "status", "published", "publié"] },
  { id: "collection", header: "Collection", aliases: ["collection", "catégorie", "categorie", "category", "product category"] },
  // Vague 2 : nature du produit (physique par défaut). Colonne facultative : absente, la nature reste inchangée.
  { id: "kind", header: "Nature", aliases: ["nature", "nature du produit", "kind", "product kind", "type d'article", "type d article"] },
  { id: "opt1Name", header: "Option1 Nom", aliases: ["option1 nom", "option1 name"] },
  { id: "opt1Value", header: "Option1 Valeur", aliases: ["option1 valeur", "option1 value"] },
  { id: "opt2Name", header: "Option2 Nom", aliases: ["option2 nom", "option2 name"] },
  { id: "opt2Value", header: "Option2 Valeur", aliases: ["option2 valeur", "option2 value"] },
  { id: "opt3Name", header: "Option3 Nom", aliases: ["option3 nom", "option3 name"] },
  { id: "opt3Value", header: "Option3 Valeur", aliases: ["option3 valeur", "option3 value"] },
  { id: "sku", header: "SKU", aliases: ["sku", "variant sku", "référence", "reference", "ref"] },
  { id: "price", header: "Prix", aliases: ["prix", "price", "variant price", "tarif"] },
  { id: "compareAt", header: "Prix barré", aliases: ["prix barré", "prix barre", "compare at price", "variant compare at price", "compare-at price"] },
  { id: "cost", header: "Coût", aliases: ["coût", "cout", "cost per item", "cost", "coût d'achat"] },
  { id: "stock", header: "Stock", aliases: ["stock", "variant inventory qty", "quantité", "quantite", "qty", "inventory"] },
  { id: "barcode", header: "Code-barres", aliases: ["code-barres", "code barres", "barcode", "variant barcode", "ean"] },
  { id: "weight", header: "Poids (g)", aliases: ["poids (g)", "poids", "variant grams", "weight", "grams"] },
  { id: "variantImage", header: "Image variante", aliases: ["image variante", "variant image"] },
  { id: "available", header: "Disponible", aliases: ["disponible", "available"] },
  // Nom et valeurs (deny / continue) identiques à l'export Shopify : réimport direct d'un fichier Shopify.
  { id: "inventoryPolicy", header: "Variant Inventory Policy", aliases: ["variant inventory policy", "inventory policy", "politique de stock", "politique de rupture", "vendre en rupture", "continuer à vendre", "continuer a vendre"] },
  { id: "lowStock", header: "Seuil stock bas", aliases: ["seuil stock bas", "seuil de stock bas", "seuil d'alerte", "low stock threshold", "low stock alert"] },
  { id: "image", header: "Image", aliases: ["image", "image src", "images", "photo"] },
  { id: "imageAlt", header: "Texte alternatif", aliases: ["texte alternatif", "image alt text", "alt"] },
  { id: "seoTitle", header: "Titre SEO", aliases: ["titre seo", "seo title"] },
  { id: "seoDescription", header: "Description SEO", aliases: ["description seo", "seo description"] },
];

const ALIAS = new Map<string, CsvColumn>(CSV_COLUMNS.flatMap((c) => c.aliases.map((a) => [a, c.id] as const)));

export function guessColumn(header: string): CsvColumn | "" {
  return ALIAS.get(header.trim().toLowerCase()) ?? "";
}

export type ImportStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

/** Nature du produit en CSV (vague 2) : français ou anglais, accents et casse indifférents. */
export type ImportKind = "PHYSICAL" | "DIGITAL" | "SERVICE" | "GIFT_CARD";

const KIND_WORDS: Record<ImportKind, string[]> = {
  PHYSICAL: ["physique", "physical", "produit physique", "standard"],
  DIGITAL: ["numerique", "numérique", "digital", "produit numerique", "produit numérique", "fichier", "telechargement", "téléchargement", "download"],
  SERVICE: ["service", "prestation", "rendez-vous", "rendez vous"],
  GIFT_CARD: ["carte cadeau", "carte-cadeau", "gift card", "giftcard", "gift_card"],
};

export const KIND_CSV_LABELS: Record<ImportKind, string> = { PHYSICAL: "physique", DIGITAL: "numérique", SERVICE: "service", GIFT_CARD: "carte cadeau" };

export function parseProductKindCell(raw: string | undefined): ImportKind | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  for (const [kind, words] of Object.entries(KIND_WORDS) as [ImportKind, string[]][]) {
    if (words.includes(v)) return kind;
  }
  return null;
}

/** Variante importée + colonnes non vides de sa ligne (mise à jour : seules ces colonnes remplacent l'existant). */
export type ImportVariant = VariantDraft & { given: CsvColumn[] };

export type ImportDraft = {
  line: number;
  handle: string;
  name: string;
  description: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: ImportStatus;
  collection: string | null;
  /** Vague 2 : nature du produit ; null = colonne absente ou illisible (nature inchangée). */
  kind: ImportKind | null;
  seoTitle: string | null;
  seoDescription: string | null;
  price: number;
  compareAtPrice: number | null;
  costPrice: number | null;
  sku: string | null;
  /** Code-barres d'un produit sans variante. */
  barcode: string | null;
  stock: number | null;
  /** Politique de rupture d'un produit sans variante (null = non fournie). */
  inventoryPolicy: InventoryPolicyValue | null;
  /** Seuil « stock bas » du produit (null = non fourni). */
  lowStockThreshold: number | null;
  weightGrams: number | null;
  images: { url: string; alt: string }[];
  options: ProductOption[];
  variants: ImportVariant[];
  /** Colonnes associées et non vides au niveau produit (1re ligne ; « image » si au moins une image valide). */
  given: CsvColumn[];
};

export type ImportIssue = { line: number; message: string };

/** « 12 000 », « 12000,00 », « 12000.5 » → 12000 / 12001. Vide → null. Invalide → NaN. */
export function parseAmount(raw: string | undefined): number | null {
  const t = (raw ?? "").replace(/[\s  ]/g, "").replace(/(fcfa|xof|xaf|cfa|eur|€|\$|f)$/i, "");
  if (!t) return null;
  if (!/^[\d.,]+$/.test(t)) return NaN;
  const s = t;
  const normalized = s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
}

/** Quantité de stock : entier, éventuellement négatif (survente exportée). Vide → null. Invalide → NaN. */
export function parseQuantity(raw: string | undefined): number | null {
  const t = (raw ?? "").replace(/[\s  ]/g, "");
  if (!t) return null;
  if (/^-\d+$/.test(t)) return Number(t);
  return parseAmount(t);
}

function parseStatus(raw: string): ImportStatus | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (["actif", "active", "true", "oui", "publié", "publie", "1"].includes(s)) return "ACTIVE";
  if (["brouillon", "draft", "false", "non", "0"].includes(s)) return "DRAFT";
  if (["archivé", "archive", "archived", "archivee", "archivée"].includes(s)) return "ARCHIVED";
  return null;
}

function parseBool(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (["oui", "true", "1", "yes", "disponible"].includes(s)) return true;
  if (["non", "false", "0", "no", "indisponible"].includes(s)) return false;
  return null;
}

const httpsUrl = (u: string) => /^https:\/\/[^\s"'<>]+$/i.test(u);

/**
 * Transforme les lignes d'un CSV (sans l'en-tête) en brouillons de produits, une ligne par variante.
 * `mapping[i]` = colonne cible de la colonne i. Les lignes d'un même produit partagent le même Handle
 * (ou, à défaut, le même titre) ; les champs produit sont lus sur la première ligne.
 * `firstLine` = numéro de ligne du fichier de la 1re ligne de données (pour le rapport d'erreurs).
 */
export function parseCatalogRows(rows: string[][], mapping: (CsvColumn | "")[], firstLine = 2): { products: ImportDraft[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const groups = new Map<string, { line: number; cells: Partial<Record<CsvColumn, string>> }[]>();
  let lastKey: string | null = null;
  rows.forEach((r, i) => {
    const line = firstLine + i;
    const cells: Partial<Record<CsvColumn, string>> = {};
    mapping.forEach((col, ci) => {
      if (col) cells[col] = (r[ci] ?? "").trim();
    });
    const handle = slugify(cells.handle || "") || slugify(cells.title || "");
    // Ligne de continuation sans handle ni titre : rattachée au produit précédent (format Shopify).
    const key = handle || lastKey;
    if (!key) {
      issues.push({ line, message: "Titre ou Handle manquant" });
      return;
    }
    lastKey = key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ line, cells });
  });

  const products: ImportDraft[] = [];
  for (const [handle, lines] of groups) {
    const head = lines[0];
    const c = head.cells;
    const name = (c.title ?? "").trim();
    if (name.length < 2) {
      issues.push({ line: head.line, message: `Titre manquant ou trop court pour « ${handle} »` });
      continue;
    }
    const optionNames = [c.opt1Name, c.opt2Name, c.opt3Name].map((n) => (n ?? "").trim()).filter((n, i, arr) => n && !/^title$/i.test(n) && arr.indexOf(n) === i).slice(0, MAX_OPTIONS);
    const options: ProductOption[] = optionNames.map((n) => ({ name: n, type: guessType(n), values: [] }));
    const images: { url: string; alt: string }[] = [];
    const variants: ImportVariant[] = [];
    let failed = false;
    let basePrice: number | null = null;

    for (const { line, cells } of lines) {
      if (cells.image) {
        if (!httpsUrl(cells.image)) issues.push({ line, message: "Image ignorée : l'adresse doit commencer par https://" });
        else if (!images.some((im) => im.url === cells.image)) images.push({ url: cells.image, alt: cells.imageAlt ?? "" });
      }
      const values = [cells.opt1Value, cells.opt2Value, cells.opt3Value].slice(0, options.length).map((v) => (v ?? "").trim());
      const hasVariantData = values.some(Boolean) || !!cells.price || !!cells.sku;
      if (!hasVariantData) continue; // ligne « image seule »
      const price = parseAmount(cells.price);
      if (price != null && Number.isNaN(price)) {
        issues.push({ line, message: `Prix invalide « ${cells.price} »` });
        failed = true;
        continue;
      }
      if (basePrice == null && price != null) basePrice = price;
      if (options.length === 0) continue; // produit simple : une seule ligne utile
      if (values.some((v) => !v)) {
        issues.push({ line, message: `Valeur d'option manquante (${options.map((o) => o.name).join(", ")})` });
        failed = true;
        continue;
      }
      const attributes: Record<string, string> = {};
      options.forEach((o, i) => {
        attributes[o.name] = values[i];
        if (!o.values.some((v) => v.value === values[i])) o.values.push({ value: values[i] });
      });
      if (variants.some((v) => options.every((o) => v.attributes[o.name] === attributes[o.name]))) {
        issues.push({ line, message: `Combinaison en double : ${variantName(attributes, options)}` });
        failed = true;
        continue;
      }
      const stock = parseQuantity(cells.stock);
      // Stock illisible : erreur de ligne et colonne considérée comme NON fournie (pas d'écrasement par 0).
      const badStock = stock != null && Number.isNaN(stock);
      if (badStock) issues.push({ line, message: `Stock « ${cells.stock} » illisible : nombre entier attendu (valeur ignorée)` });
      const policy = parseInventoryPolicy(cells.inventoryPolicy);
      if (cells.inventoryPolicy && !policy) issues.push({ line, message: `Politique de stock « ${cells.inventoryPolicy} » ignorée : indiquez deny ou continue` });
      const compareAt = parseAmount(cells.compareAt);
      const weight = parseAmount(cells.weight);
      const vImg = cells.variantImage && httpsUrl(cells.variantImage) ? cells.variantImage : null;
      if (vImg && !images.some((im) => im.url === vImg)) images.push({ url: vImg, alt: "" });
      variants.push({
        attributes,
        price: price ?? null,
        compareAtPrice: compareAt != null && !Number.isNaN(compareAt) ? compareAt : null,
        sku: cells.sku || null,
        barcode: cells.barcode || null,
        stock: stock != null && !Number.isNaN(stock) ? stock : 0,
        weightGrams: weight != null && !Number.isNaN(weight) ? weight : null,
        imageUrl: vImg,
        available: parseBool(cells.available ?? "") ?? true,
        ...(policy ? { inventoryPolicy: policy } : {}),
        given: (Object.keys(cells) as CsvColumn[]).filter((k) => !!cells[k] && (k !== "inventoryPolicy" || !!policy) && (k !== "stock" || !badStock)),
      });
    }
    if (failed) continue;
    if (basePrice == null) {
      issues.push({ line: head.line, message: `Prix manquant pour « ${name} »` });
      continue;
    }
    if (variants.length > MAX_VARIANTS) {
      issues.push({ line: head.line, message: `« ${name} » : ${variants.length} variantes (${MAX_VARIANTS} maximum)` });
      continue;
    }
    if (options.length > 0 && variants.length === 0) {
      issues.push({ line: head.line, message: `« ${name} » : options sans aucune variante` });
      continue;
    }
    // Variante sans prix : elle hérite du prix de base lu (1re ligne avec un prix), AVANT le calcul du minimum.
    for (const v of variants) v.price ??= basePrice;
    // Le prix de base = prix le plus bas ; les variantes au même prix héritent (null).
    const minPrice = variants.length ? Math.min(...variants.map((v) => v.price ?? basePrice!)) : basePrice;
    for (const v of variants) if (v.price === minPrice) v.price = null;
    const status = parseStatus(c.status ?? "");
    const kind = parseProductKindCell(c.kind);
    if (c.kind && !kind) issues.push({ line: head.line, message: `Nature « ${c.kind} » ignorée : physique, numérique, service ou carte cadeau` });
    const stockCell = parseQuantity(c.stock);
    const badProductStock = !options.length && stockCell != null && Number.isNaN(stockCell);
    if (badProductStock) issues.push({ line: head.line, message: `Stock « ${c.stock} » illisible : nombre entier attendu (valeur ignorée)` });
    const productPolicy = options.length ? null : parseInventoryPolicy(c.inventoryPolicy);
    if (!options.length && c.inventoryPolicy && !productPolicy) issues.push({ line: head.line, message: `Politique de stock « ${c.inventoryPolicy} » ignorée : indiquez deny ou continue` });
    const thresholdCell = parseAmount(c.lowStock);
    const lowStockThreshold = thresholdCell != null && !Number.isNaN(thresholdCell) && thresholdCell <= MAX_LOW_STOCK_THRESHOLD ? thresholdCell : null;
    if (c.lowStock && lowStockThreshold == null) issues.push({ line: head.line, message: `Seuil de stock bas « ${c.lowStock} » ignoré : nombre entier attendu` });
    products.push({
      line: head.line,
      handle,
      name: name.slice(0, 120),
      description: c.description || null,
      vendor: c.vendor || null,
      productType: c.type || null,
      tags: [...new Set((c.tags ?? "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean))].slice(0, 50),
      status: status ?? "ACTIVE",
      collection: c.collection || null,
      kind,
      seoTitle: c.seoTitle || null,
      seoDescription: c.seoDescription || null,
      price: minPrice,
      compareAtPrice: options.length ? null : (() => { const n = parseAmount(c.compareAt); return n != null && !Number.isNaN(n) ? n : null; })(),
      costPrice: (() => { const n = parseAmount(c.cost); return n != null && !Number.isNaN(n) ? n : null; })(),
      sku: options.length ? null : c.sku || null,
      barcode: options.length ? null : c.barcode || null,
      stock: options.length ? null : stockCell != null && !Number.isNaN(stockCell) ? stockCell : null,
      inventoryPolicy: productPolicy,
      lowStockThreshold,
      weightGrams: options.length ? null : (() => { const n = parseAmount(c.weight); return n != null && !Number.isNaN(n) ? n : null; })(),
      images,
      options,
      variants,
      given: [
        ...(Object.keys(c) as CsvColumn[]).filter(
          (k) => !!c[k] && k !== "image" && (k !== "inventoryPolicy" || !!productPolicy) && (k !== "lowStock" || lowStockThreshold != null) && (k !== "stock" || !badProductStock) && (k !== "kind" || !!kind),
        ),
        ...(images.length ? (["image"] as CsvColumn[]) : []),
      ],
    });
  }
  return { products, issues };
}

/** Lignes d'export (une par variante, champs produit sur la 1re ligne, images supplémentaires en lignes « image seule »). */
export type ExportProduct = {
  slug: string;
  name: string;
  description: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: string;
  collection: string | null;
  /** Vague 2 : nature du produit (colonne « Nature »). */
  kind?: ImportKind | string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  price: number;
  compareAtPrice: number | null;
  costPrice: number | null;
  sku: string | null;
  barcode?: string | null;
  trackStock: boolean;
  stock: number;
  inventoryPolicy?: string;
  lowStockThreshold?: number | null;
  weightGrams: number | null;
  images: { url: string; alt?: string }[];
  options: ProductOption[];
  variants: { attributes: Record<string, string>; price: number | null; compareAtPrice: number | null; sku: string | null; barcode: string | null; stock: number; weightGrams: number | null; imageUrl: string | null; available: boolean; inventoryPolicy?: string }[];
  /** Lot 4 : cellules supplémentaires du produit (champs personnalisés `metafield:…`), sur sa 1re ligne. */
  extra?: Record<string, string>;
};

const STATUS_FR: Record<string, string> = { ACTIVE: "actif", DRAFT: "brouillon", ARCHIVED: "archivé" };

export function exportCatalogRows(products: ExportProduct[], extraHeaders: string[] = []): { headers: string[]; rows: (string | number)[][] } {
  const headers = [...CSV_COLUMNS.map((c) => c.header), ...extraHeaders];
  const rows: (string | number)[][] = [];
  const idx = new Map(CSV_COLUMNS.map((c, i) => [c.id, i]));
  const blank = () => [...CSV_COLUMNS.map(() => "" as string | number), ...extraHeaders.map(() => "" as string | number)];
  for (const p of products) {
    const images = p.images.filter((i) => httpsUrl(i.url));
    const lines = p.variants.length ? p.variants : [null];
    lines.forEach((v, i) => {
      const r = blank();
      const set = (k: CsvColumn, val: string | number | null | undefined) => {
        r[idx.get(k)!] = val ?? "";
      };
      set("handle", p.slug);
      if (i === 0) {
        set("title", p.name);
        set("description", p.description);
        set("vendor", p.vendor);
        set("type", p.productType);
        set("tags", p.tags.join(", "));
        set("status", STATUS_FR[p.status] ?? p.status);
        set("collection", p.collection);
        set("kind", p.kind ? (KIND_CSV_LABELS[p.kind as ImportKind] ?? String(p.kind).toLowerCase()) : "");
        set("seoTitle", p.seoTitle);
        set("seoDescription", p.seoDescription);
        set("cost", p.costPrice);
        set("lowStock", p.lowStockThreshold);
        extraHeaders.forEach((h, k) => {
          r[CSV_COLUMNS.length + k] = p.extra?.[h] ?? "";
        });
      }
      if (v) {
        p.options.forEach((o, oi) => {
          set(`opt${oi + 1}Name` as CsvColumn, o.name);
          set(`opt${oi + 1}Value` as CsvColumn, v.attributes[o.name]);
        });
        set("sku", v.sku);
        set("price", v.price ?? p.price);
        set("compareAt", v.compareAtPrice);
        set("stock", p.trackStock ? v.stock : "");
        set("barcode", v.barcode);
        set("weight", v.weightGrams);
        set("variantImage", v.imageUrl && httpsUrl(v.imageUrl) ? v.imageUrl : "");
        set("available", v.available ? "oui" : "non");
        set("inventoryPolicy", policyToCsv(v.inventoryPolicy));
      } else {
        set("sku", p.sku);
        set("price", p.price);
        set("compareAt", p.compareAtPrice);
        set("stock", p.trackStock ? p.stock : "");
        set("barcode", p.barcode);
        set("weight", p.weightGrams);
        set("available", "oui");
        set("inventoryPolicy", policyToCsv(p.inventoryPolicy));
      }
      if (images[i]) {
        set("image", images[i].url);
        set("imageAlt", images[i].alt);
      }
      rows.push(r);
    });
    for (let i = lines.length; i < images.length; i++) {
      const r = blank();
      r[idx.get("handle")!] = p.slug;
      r[idx.get("image")!] = images[i].url;
      r[idx.get("imageAlt")!] = images[i].alt ?? "";
      rows.push(r);
    }
  }
  return { headers, rows };
}

/** Lot 4 : colonnes `metafield:…` d'un fichier (index et en-tête), envoyées à l'import avec l'association. */
export function metafieldHeaderColumns(header: string[]): { index: number; header: string }[] {
  return header.map((h, index) => ({ index, header: (h ?? "").trim() })).filter((c) => c.header.toLowerCase().startsWith("metafield:")).slice(0, 60);
}

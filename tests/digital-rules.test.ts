import { describe, it, expect } from "vitest";
import { priceCart, type PipelineInput, type PipelineLine } from "@/lib/commerce/checkout-pipeline";
import { canTransition, nextStatuses } from "@/lib/commerce/order-state";
import { codRefusedMessage, kindRequiresShipping, kindTracksStock, normalizeKind, productKindOf, summarizeCartKinds } from "@/lib/digital/kinds";
import { assetsForLine, downloadsLabel, grantProblemMessage, grantState, resolveDownloadExpiry, resolveDownloadLimit } from "@/lib/digital/rules";
import { DOWNLOAD_TOKEN_RE, generateDownloadToken, hashDownloadToken, isDownloadTokenShape, sameDownloadHash } from "@/lib/digital/token";
import { downloadFileName, isValidFileKey, buildFileKey, sniffFileType, mimeForFileKey, fileKeyBelongsTo } from "@/lib/storage/file-keys";
import { isValidMediaKey } from "@/lib/storage/keys";
import { parseProductKindCell, exportCatalogRows, parseCatalogRows, CSV_COLUMNS, guessColumn, type CsvColumn } from "@/lib/products/csv-catalog";
import { resolveProductKind } from "@/lib/products/schemas";

/**
 * Vague 2 — produits numériques et services : règles PURES.
 * Panier (livraison, paiement à la livraison, stock), transitions d'états, jeton, clés de fichiers, CSV.
 */

const NOW = new Date("2026-10-11T12:00:00Z");
const SECRET = "x".repeat(48);

const L = (productId: string, unitPrice: number, quantity: number, over: Partial<PipelineLine> = {}): PipelineLine => ({
  productId,
  name: productId,
  unitPrice,
  quantity,
  collectionIds: [],
  isGiftCard: false,
  onSale: false,
  ...over,
});
const run = (over: Partial<PipelineInput>) => priceCart({ lines: [], delivery: { type: "PICKUP" }, now: NOW, currency: "XOF", ...over });

describe("nature des produits", () => {
  it("déduit la nature, en gardant la cohérence avec isGiftCard", () => {
    expect(productKindOf({ kind: "DIGITAL" })).toBe("DIGITAL");
    expect(productKindOf({ kind: "PHYSICAL", isGiftCard: true })).toBe("GIFT_CARD");
    expect(productKindOf({ kind: "n'importe quoi" })).toBe("PHYSICAL");
    expect(productKindOf(null)).toBe("PHYSICAL");
    expect(normalizeKind("SERVICE")).toEqual({ kind: "SERVICE", isGiftCard: false });
    expect(normalizeKind("SERVICE", true)).toEqual({ kind: "GIFT_CARD", isGiftCard: true });
  });

  it("expédition et stock par nature", () => {
    expect(kindRequiresShipping("PHYSICAL")).toBe(true);
    for (const k of ["DIGITAL", "SERVICE", "GIFT_CARD"] as const) expect(kindRequiresShipping(k)).toBe(false);
    expect(kindTracksStock("DIGITAL")).toBe(false);
    expect(kindTracksStock("GIFT_CARD")).toBe(false);
    expect(kindTracksStock("SERVICE")).toBe(true);
    expect(kindTracksStock("PHYSICAL")).toBe(true);
  });

  it("résout la nature à l'enregistrement (formulaire, CSV, MCP)", () => {
    expect(resolveProductKind({ kind: "DIGITAL" })).toBe("DIGITAL");
    expect(resolveProductKind({}, { kind: "SERVICE" })).toBe("SERVICE");
    expect(resolveProductKind({}, { isGiftCard: true })).toBe("GIFT_CARD");
    expect(resolveProductKind({ isGiftCard: true, kind: "DIGITAL" })).toBe("GIFT_CARD");
    expect(resolveProductKind({ isGiftCard: false }, { kind: "GIFT_CARD", isGiftCard: true })).toBe("PHYSICAL");
    expect(resolveProductKind({})).toBe("PHYSICAL");
  });

  it("résume un panier : expédition, prépaiement, numérique", () => {
    expect(summarizeCartKinds([])).toMatchObject({ digitalOnly: false, requiresShipping: false });
    expect(summarizeCartKinds([{ kind: "DIGITAL" }])).toMatchObject({ digitalOnly: true, hasDigital: true, prepaymentRequired: true });
    expect(summarizeCartKinds([{ kind: "SERVICE" }])).toMatchObject({ digitalOnly: true, hasDigital: false, prepaymentRequired: false, hasService: true });
    expect(summarizeCartKinds([{ kind: "DIGITAL" }, { kind: "PHYSICAL" }])).toMatchObject({ digitalOnly: false, requiresShipping: true, hasDigital: true });
    expect(summarizeCartKinds([{ isGiftCard: true }])).toMatchObject({ digitalOnly: true, prepaymentRequired: true });
    // Compatibilité : une ligne sans `kind` est physique.
    expect(summarizeCartKinds([{}])).toMatchObject({ digitalOnly: false, requiresShipping: true });
  });

  it("message de refus du paiement à la livraison", () => {
    expect(codRefusedMessage({ hasDigital: true })).toMatch(/produit numérique/);
    expect(codRefusedMessage({ hasDigital: false })).toMatch(/carte cadeau/);
  });
});

describe("pipeline : livraison et lignes non expédiées", () => {
  it("panier 100 % numérique : aucun frais de livraison même en mode DELIVERY", () => {
    const r = run({ lines: [L("d1", 5000, 1, { kind: "DIGITAL" })], delivery: { type: "DELIVERY", fee: 1500 } });
    expect(r.deliveryFee).toBe(0);
    expect(r.total).toBe(5000);
  });

  it("panier de services : aucun frais de livraison", () => {
    const r = run({ lines: [L("s1", 20000, 1, { kind: "SERVICE" })], delivery: { type: "DELIVERY", fee: 2000 } });
    expect(r.deliveryFee).toBe(0);
  });

  it("panier mixte : la livraison s'applique, mais seules les lignes physiques comptent pour la livraison offerte", () => {
    const mixed = run({ lines: [L("p1", 6000, 1), L("d1", 9000, 1, { kind: "DIGITAL" })], delivery: { type: "DELIVERY", fee: 1500, freeAbove: 10000 } });
    // Net physique = 6 000 < 10 000 : les 9 000 du fichier n'ouvrent pas la livraison offerte.
    expect(mixed.deliveryFee).toBe(1500);
    const physical = run({ lines: [L("p1", 12000, 1), L("d1", 9000, 1, { kind: "DIGITAL" })], delivery: { type: "DELIVERY", fee: 1500, freeAbove: 10000 } });
    expect(physical.deliveryFee).toBe(0);
  });

  it("comportement historique inchangé sans `kind` (produits physiques)", () => {
    const r = run({ lines: [L("p1", 12000, 1)], delivery: { type: "DELIVERY", fee: 1500, freeAbove: 10000 } });
    expect(r.deliveryFee).toBe(0);
    const r2 = run({ lines: [L("p1", 8000, 1)], delivery: { type: "DELIVERY", fee: 1500, freeAbove: 10000 } });
    expect(r2.deliveryFee).toBe(1500);
  });
});

describe("machine d'états : commande sans expédition", () => {
  it("transitions historiques inchangées", () => {
    expect(canTransition("NEW", "CONFIRMED")).toBe(true);
    expect(canTransition("NEW", "DELIVERED")).toBe(false);
    expect(canTransition("CONFIRMED", "DELIVERED")).toBe(false);
    expect(canTransition("DELIVERED", "REFUNDED")).toBe(true);
    expect(nextStatuses("NEW")).toEqual(["CONFIRMED", "CANCELLED"]);
  });

  it("commande sans expédition : remise directe autorisée", () => {
    expect(canTransition("NEW", "DELIVERED", { intangible: true })).toBe(true);
    expect(canTransition("CONFIRMED", "DELIVERED", { intangible: true })).toBe(true);
    expect(canTransition("PREPARING", "DELIVERED", { intangible: true })).toBe(true);
    // Rien de neuf après la remise, ni depuis un état terminal.
    expect(canTransition("DELIVERED", "NEW", { intangible: true })).toBe(false);
    expect(canTransition("CANCELLED", "DELIVERED", { intangible: true })).toBe(false);
    expect(nextStatuses("NEW", { intangible: true })).toEqual(["CONFIRMED", "CANCELLED", "DELIVERED"]);
  });
});

describe("accès de téléchargement : limites et expiration", () => {
  it("limite et expiration par défaut", () => {
    expect(resolveDownloadLimit(null)).toBe(5);
    expect(resolveDownloadLimit(3)).toBe(3);
    expect(resolveDownloadLimit(0)).toBeNull();
    expect(resolveDownloadLimit(-4)).toBeNull();
    expect(resolveDownloadExpiry(null, NOW)?.toISOString()).toBe(new Date(NOW.getTime() + 365 * 86_400_000).toISOString());
    expect(resolveDownloadExpiry(0, NOW)).toBeNull();
    expect(resolveDownloadExpiry(7, NOW)?.toISOString()).toBe(new Date(NOW.getTime() + 7 * 86_400_000).toISOString());
  });

  it("état d'un accès : utilisable, expiré, épuisé", () => {
    const base = { downloadCount: 0, downloadLimit: 3, expiresAt: new Date(NOW.getTime() + 1000) };
    expect(grantState(base, NOW)).toEqual({ expired: false, exhausted: false, remaining: 3, usable: true });
    expect(grantState({ ...base, downloadCount: 3 }, NOW)).toMatchObject({ exhausted: true, remaining: 0, usable: false });
    expect(grantState({ ...base, expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toMatchObject({ expired: true, usable: false });
    expect(grantState({ downloadCount: 99, downloadLimit: null, expiresAt: null }, NOW)).toMatchObject({ remaining: null, usable: true });
    // Compteur au-delà de la limite (donnée abîmée) : jamais de reste négatif.
    expect(grantState({ downloadCount: 9, downloadLimit: 3, expiresAt: null }, NOW).remaining).toBe(0);
  });

  it("messages et libellés", () => {
    expect(grantProblemMessage(grantState({ downloadCount: 0, downloadLimit: 1, expiresAt: new Date(NOW.getTime() - 1) }, NOW))).toMatch(/expiré/);
    expect(grantProblemMessage(grantState({ downloadCount: 1, downloadLimit: 1, expiresAt: null }, NOW))).toMatch(/atteint/);
    expect(grantProblemMessage(grantState({ downloadCount: 0, downloadLimit: 1, expiresAt: null }, NOW))).toBeNull();
    expect(downloadsLabel({ downloadCount: 1, downloadLimit: 5, expiresAt: null }, NOW)).toBe("4 téléchargements restants sur 5");
    expect(downloadsLabel({ downloadCount: 0, downloadLimit: null, expiresAt: null }, NOW)).toBe("Téléchargements illimités");
  });

  it("fichiers d'une ligne : communs + ceux de la variante achetée, ordre stable", () => {
    const assets = [
      { id: "a", variantId: null, position: 1, name: "Guide.pdf" },
      { id: "b", variantId: "v1", position: 0, name: "Bonus v1.zip" },
      { id: "c", variantId: "v2", position: 0, name: "Bonus v2.zip" },
    ];
    expect(assetsForLine(assets, "v1").map((a) => a.id)).toEqual(["b", "a"]);
    expect(assetsForLine(assets, null).map((a) => a.id)).toEqual(["a"]);
    expect(assetsForLine(assets, "v9").map((a) => a.id)).toEqual(["a"]);
  });
});

describe("jeton de téléchargement", () => {
  it("256 bits base64url, forme vérifiable, aléatoire", () => {
    const a = generateDownloadToken();
    const b = generateDownloadToken();
    expect(a).toMatch(DOWNLOAD_TOKEN_RE);
    expect(a).not.toBe(b);
    expect(isDownloadTokenShape(a)).toBe(true);
    expect(isDownloadTokenShape("court")).toBe(false);
    expect(isDownloadTokenShape(`${a}!`)).toBe(false);
    expect(isDownloadTokenShape(null)).toBe(false);
  });

  it("empreinte HMAC stable, non réversible, comparaison en temps constant", () => {
    const token = generateDownloadToken();
    const h = hashDownloadToken(token, SECRET);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain(token.slice(0, 8));
    expect(hashDownloadToken(token, SECRET)).toBe(h);
    expect(hashDownloadToken(generateDownloadToken(), SECRET)).not.toBe(h);
    // Clé différente = empreinte différente (un jeton d'un autre déploiement ne vaut rien).
    expect(hashDownloadToken(token, "y".repeat(48))).not.toBe(h);
    expect(sameDownloadHash(h, h)).toBe(true);
    expect(sameDownloadHash(h, h.slice(0, 63))).toBe(false);
    expect(sameDownloadHash(h, "0".repeat(64))).toBe(false);
  });
});

describe("clés des fichiers vendus", () => {
  it("forme stricte, jamais une clé de média (donc jamais servie par /media)", () => {
    const key = buildFileKey("storeabcd1234", "a".repeat(64), "pdf", NOW);
    expect(key).toBe("stores/storeabcd1234/files/2026/10/" + "a".repeat(64) + ".pdf");
    expect(isValidFileKey(key)).toBe(true);
    expect(isValidMediaKey(key)).toBe(false);
    expect(mimeForFileKey(key)).toBe("application/pdf");
    expect(fileKeyBelongsTo(key, "storeabcd1234")).toBe(true);
    expect(fileKeyBelongsTo(key, "autreboutique1")).toBe(false);
  });

  it("refuse les clés hors forme (traversée, extension inconnue)", () => {
    for (const bad of [
      "stores/storeabcd1234/files/2026/13/" + "a".repeat(64) + ".pdf",
      "stores/storeabcd1234/files/2026/10/" + "a".repeat(64) + ".exe",
      "stores/storeabcd1234/2026/10/" + "a".repeat(64) + ".pdf",
      "../stores/storeabcd1234/files/2026/10/" + "a".repeat(64) + ".pdf",
      "stores/storeabcd1234/files/2026/10/../../" + "a".repeat(64) + ".pdf",
    ]) {
      expect(isValidFileKey(bad)).toBe(false);
    }
  });

  it("format décidé par les octets, jamais par le type annoncé", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(sniffFileType(pdf)).toEqual({ mime: "application/pdf", ext: "pdf" });
    const zip = new Uint8Array(40);
    zip.set([0x50, 0x4b, 0x03, 0x04]);
    expect(sniffFileType(zip)).toEqual({ mime: "application/zip", ext: "zip" });
    const epub = new Uint8Array(80);
    epub.set([0x50, 0x4b, 0x03, 0x04]);
    epub.set([..."mimetypeapplication/epub+zip"].map((c) => c.charCodeAt(0)), 30);
    expect(sniffFileType(epub)).toEqual({ mime: "application/epub+zip", ext: "epub" });
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0]);
    expect(sniffFileType(mp3)?.ext).toBe("mp3");
    const mp4 = new Uint8Array(16);
    mp4.set([..."ftypisom"].map((c) => c.charCodeAt(0)), 4);
    expect(sniffFileType(mp4)?.ext).toBe("mp4");
    // Exécutable, HTML et SVG refusés.
    expect(sniffFileType(new Uint8Array([0x4d, 0x5a, 0x90]))).toBeNull();
    expect(sniffFileType(new Uint8Array([..."<html>"].map((c) => c.charCodeAt(0))))).toBeNull();
    expect(sniffFileType(new Uint8Array([..."<svg xmlns"].map((c) => c.charCodeAt(0))))).toBeNull();
    expect(sniffFileType(new Uint8Array(0))).toBeNull();
  });

  it("nom de fichier servi : assaini, extension de la clé", () => {
    const key = buildFileKey("storeabcd1234", "b".repeat(64), "zip", NOW);
    expect(downloadFileName('Mon "pack" / complet', key)).toBe("Mon pack complet.zip");
    expect(downloadFileName("deja.zip", key)).toBe("deja.zip");
    expect(downloadFileName("", key)).toBe("fichier.zip");
    expect(downloadFileName("ligne\nsuite", key)).toBe("ligne suite.zip");
    expect(downloadFileName("a".repeat(200), key)).toHaveLength(84);
  });
});

describe("CSV : colonne Nature", () => {
  it("lit les natures en français et en anglais, ignore une valeur inconnue", () => {
    expect(parseProductKindCell("numérique")).toBe("DIGITAL");
    expect(parseProductKindCell("Digital")).toBe("DIGITAL");
    expect(parseProductKindCell("service")).toBe("SERVICE");
    expect(parseProductKindCell("carte cadeau")).toBe("GIFT_CARD");
    expect(parseProductKindCell("physique")).toBe("PHYSICAL");
    expect(parseProductKindCell("")).toBeNull();
    expect(parseProductKindCell("bizarre")).toBeNull();
  });

  it("colonne reconnue par ses alias, sans casser l'existant", () => {
    expect(guessColumn("Nature")).toBe("kind");
    expect(guessColumn("product kind")).toBe("kind");
    // Les colonnes historiques restent associées comme avant.
    expect(guessColumn("Titre")).toBe("title");
    expect(guessColumn("Type")).toBe("type");
    expect(guessColumn("Variant Inventory Policy")).toBe("inventoryPolicy");
  });

  it("import : nature lue, erreur non bloquante si illisible", () => {
    const mapping: (CsvColumn | "")[] = ["title", "price", "kind"];
    const ok = parseCatalogRows([["Guide PDF", "5000", "numérique"]], mapping);
    expect(ok.products[0].kind).toBe("DIGITAL");
    expect(ok.products[0].given).toContain("kind");
    const bad = parseCatalogRows([["Guide PDF", "5000", "zzz"]], mapping);
    expect(bad.products).toHaveLength(1);
    expect(bad.products[0].kind).toBeNull();
    expect(bad.products[0].given).not.toContain("kind");
    expect(bad.issues[0].message).toMatch(/Nature/);
    // Colonne absente : nature inchangée (null).
    const none = parseCatalogRows([["Guide PDF", "5000"]], ["title", "price"]);
    expect(none.products[0].kind).toBeNull();
  });

  it("export : en-tête ajouté en fin de bloc produit, valeurs historiques intactes", () => {
    const { headers, rows } = exportCatalogRows([
      {
        slug: "guide", name: "Guide", description: null, vendor: null, productType: null, tags: [], status: "ACTIVE", collection: null,
        seoTitle: null, seoDescription: null, price: 5000, compareAtPrice: null, costPrice: null, sku: null, trackStock: false, stock: 0,
        weightGrams: null, images: [], options: [], variants: [], kind: "DIGITAL",
      },
    ]);
    expect(headers).toEqual(CSV_COLUMNS.map((c) => c.header));
    const i = CSV_COLUMNS.findIndex((c) => c.id === "kind");
    expect(rows[0][i]).toBe("numérique");
    // Un produit physique n'affiche pas de bruit dans la colonne.
    const phys = exportCatalogRows([
      {
        slug: "robe", name: "Robe", description: null, vendor: null, productType: null, tags: [], status: "ACTIVE", collection: null,
        seoTitle: null, seoDescription: null, price: 15000, compareAtPrice: null, costPrice: null, sku: null, trackStock: false, stock: 0,
        weightGrams: null, images: [], options: [], variants: [], kind: "PHYSICAL",
      },
    ]);
    expect(phys.rows[0][i]).toBe("physique");
  });

  it("aller-retour export → import : la nature est conservée", () => {
    const { headers, rows } = exportCatalogRows([
      {
        slug: "atelier", name: "Atelier couture", description: null, vendor: null, productType: null, tags: [], status: "ACTIVE", collection: null,
        seoTitle: null, seoDescription: null, price: 25000, compareAtPrice: null, costPrice: null, sku: null, trackStock: false, stock: 0,
        weightGrams: null, images: [], options: [], variants: [], kind: "SERVICE",
      },
    ]);
    const mapping = headers.map((h) => guessColumn(h));
    const parsed = parseCatalogRows(rows.map((r) => r.map(String)), mapping);
    expect(parsed.products[0].kind).toBe("SERVICE");
  });
});

describe("vitrine : paiement à la livraison selon la nature du panier", () => {
  it("refuse le paiement à la livraison pour un panier numérique ou une carte cadeau, l'autorise sinon", () => {
    expect(summarizeCartKinds([{ kind: "DIGITAL" }]).prepaymentRequired).toBe(true);
    expect(summarizeCartKinds([{ isGiftCard: true }]).prepaymentRequired).toBe(true);
    expect(summarizeCartKinds([{ kind: "PHYSICAL" }, { kind: "DIGITAL" }]).prepaymentRequired).toBe(true);
    expect(summarizeCartKinds([{ kind: "PHYSICAL" }]).prepaymentRequired).toBe(false);
    expect(summarizeCartKinds([{ kind: "SERVICE" }]).prepaymentRequired).toBe(false);
    // Un instantané de panier antérieur (sans `kind`) reste un produit physique.
    expect(summarizeCartKinds([{}]).prepaymentRequired).toBe(false);
  });
});

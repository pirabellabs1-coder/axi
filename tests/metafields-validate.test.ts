import { describe, it, expect } from "vitest";
import { normalizeValidations, regexIssue, validateMetafieldValue, metafieldText, effectiveStorefrontVisible, isEmptyInput } from "@/lib/metafields/validate";
import { METAFIELD_TYPES, METAFIELD_TYPE_META, keyFromName, type MetafieldType } from "@/lib/metafields/types";
import { mapMetafieldColumns, metafieldCsvCells, metafieldEntriesFromRow, parseMetafieldColumn } from "@/lib/metafields/csv";

const v = (type: MetafieldType, raw: unknown, validations = {}, currency = "XOF") => validateMetafieldValue({ type, validations }, raw, { currency });

describe("metafields : validation par type", () => {
  it("chaque type de la liste fermée a ses métadonnées", () => {
    expect(METAFIELD_TYPES).toHaveLength(17);
    for (const t of METAFIELD_TYPES) expect(METAFIELD_TYPE_META[t].label).toBeTruthy();
  });

  it("textes", () => {
    expect(v("single_line_text", "  Coton  ")).toEqual({ ok: true, value: "Coton" });
    expect(v("single_line_text", "a\nb").ok).toBe(false);
    expect(v("single_line_text", "x".repeat(256)).ok).toBe(false);
    expect(v("single_line_text", "ab", { min: 3 }).ok).toBe(false);
    expect(v("single_line_text", "Lin", { choices: ["Coton", "Wax"] }).ok).toBe(false);
    expect(v("single_line_text", "Wax", { choices: ["Coton", "Wax"] }).ok).toBe(true);
    expect(v("single_line_text", "AB-1234", { regex: "[A-Z]{2}-[0-9]{4}" }).ok).toBe(true);
    expect(v("single_line_text", "xAB-1234", { regex: "[A-Z]{2}-[0-9]{4}" }).ok).toBe(false); // expression ancrée
    expect(v("multi_line_text", "l1\r\nl2")).toEqual({ ok: true, value: "l1\nl2" });
    expect(v("rich_text", "**gras** [lien](https://axi.africa)").ok).toBe(true);
    expect(v("rich_text", "<script>alert(1)</script>").ok).toBe(false);
    expect(v("rich_text", "[x](javascript:alert(1))").ok).toBe(false);
    expect(v("single_line_text", 42).ok).toBe(false);
  });

  it("listes", () => {
    expect(v("list_single_line_text", ["a", " a ", "b", ""])).toEqual({ ok: true, value: ["a", "b"] });
    expect(v("list_single_line_text", "un\ndeux")).toEqual({ ok: true, value: ["un", "deux"] });
    expect(v("list_single_line_text", ["a", "b", "c"], { max: 2 }).ok).toBe(false);
    expect(v("list_single_line_text", ["a", "z"], { choices: ["a", "b"] }).ok).toBe(false);
    expect(v("list_single_line_text", [1]).ok).toBe(false);
  });

  it("nombres, note, mesures, montant", () => {
    expect(v("integer", "12")).toEqual({ ok: true, value: 12 });
    expect(v("integer", 1.5).ok).toBe(false);
    expect(v("integer", 11, { min: 0, max: 10 }).ok).toBe(false);
    expect(v("decimal", "12,5")).toEqual({ ok: true, value: 12.5 });
    expect(v("decimal", "abc").ok).toBe(false);
    expect(v("rating", 4.5, { min: 0, max: 5 })).toEqual({ ok: true, value: 4.5 });
    expect(v("rating", 6, { min: 0, max: 5 }).ok).toBe(false);
    expect(v("dimension", { value: "12,5", unit: "cm" })).toEqual({ ok: true, value: { value: 12.5, unit: "cm" } });
    expect(v("dimension", { value: 1, unit: "kg" }).ok).toBe(false);
    expect(v("weight", { value: 2, unit: "kg" }).ok).toBe(true);
    expect(v("weight", { value: -1, unit: "kg" }).ok).toBe(false);
    expect(v("money", { amount: "5000" })).toEqual({ ok: true, value: { amount: 5000, currency: "XOF" } });
    expect(v("money", { amount: 10.5 }).ok).toBe(false);
    expect(v("money", { amount: 100, currency: "EUR" }).ok).toBe(false); // devise de la boutique imposée
  });

  it("booléen, date, couleur, lien, image, références", () => {
    expect(v("boolean", "oui")).toEqual({ ok: true, value: true });
    expect(v("boolean", false)).toEqual({ ok: true, value: false });
    expect(v("boolean", "peut-être").ok).toBe(false);
    expect(v("date", "2026-02-29").ok).toBe(false);
    expect(v("date", "2028-02-29").ok).toBe(true);
    expect(v("color", "#0D3B2E")).toEqual({ ok: true, value: "#0d3b2e" });
    expect(v("color", "red").ok).toBe(false);
    expect(v("url", "/catalogue").ok).toBe(true);
    expect(v("url", "http://x.com").ok).toBe(false);
    expect(v("url", "javascript:alert(1)").ok).toBe(false);
    expect(v("image", { url: "https://images.unsplash.com/x", alt: "Robe" }).ok).toBe(true);
    expect(v("image", { url: "data:image/png;base64,AAAA" }).ok).toBe(false);
    expect(v("image", { url: "/media/stores/abcdefgh12/2026/10/" + "a".repeat(64) + ".png" }).ok).toBe(true);
    expect(v("product_reference", "cprod12345678").ok).toBe(true);
    expect(v("collection_reference", { id: "x" }).ok).toBe(false);
  });

  it("texte lisible", () => {
    expect(metafieldText("boolean", true)).toBe("Oui");
    expect(metafieldText("date", "2026-10-11")).toBe("11 octobre 2026");
    expect(metafieldText("dimension", { value: 12.5, unit: "cm" })).toBe("12,5 cm");
    expect(metafieldText("list_single_line_text", ["a", "b"])).toBe("a, b");
    expect(metafieldText("rating", 4, { validations: { max: 5 } })).toBe("4 / 5");
    expect(metafieldText("product_reference", "cid", { refTitle: "Robe wax" })).toBe("Robe wax");
  });

  it("valeur vide = suppression", () => {
    expect(isEmptyInput(null)).toBe(true);
    expect(isEmptyInput("  ")).toBe(true);
    expect(isEmptyInput([])).toBe(true);
    expect(isEmptyInput(false)).toBe(false);
    expect(isEmptyInput(0)).toBe(false);
  });
});

describe("metafields : validations des définitions", () => {
  it("expressions régulières limitées (anti-ReDoS)", () => {
    expect(regexIssue("[A-Z]{2}-[0-9]{4}")).toBeNull();
    expect(regexIssue("(?:ab)?c")).toBeNull();
    expect(regexIssue("(a+)+")).not.toBeNull();
    expect(regexIssue("(a|aa)+")).not.toBeNull();
    expect(regexIssue("((a*))*")).not.toBeNull();
    expect(regexIssue("(\\d{2}){3,}")).not.toBeNull();
    expect(regexIssue("(a)\\1")).not.toBeNull();
    expect(regexIssue("(?=a)")).not.toBeNull();
    expect(regexIssue("[")).not.toBeNull();
    expect(regexIssue("a".repeat(101))).not.toBeNull();
  });

  it("normalisation : clés autorisées par type, bornes cohérentes, choix nettoyés", () => {
    expect(normalizeValidations("boolean", { min: 1, regex: "a" })).toEqual({ ok: true, value: {} });
    expect(normalizeValidations("integer", { min: "5", max: "1" }).ok).toBe(false);
    expect(normalizeValidations("rating", {})).toEqual({ ok: true, value: { min: 0, max: 5 } });
    expect(normalizeValidations("single_line_text", { choices: "Coton\nWax\nCoton\n" })).toEqual({ ok: true, value: { choices: ["Coton", "Wax"] } });
    expect(normalizeValidations("single_line_text", { min: -1 }).ok).toBe(false);
    expect(normalizeValidations("single_line_text", { regex: "(a+)+" }).ok).toBe(false);
    expect(normalizeValidations("integer", { unknown: 1 }).ok).toBe(false);
  });

  it("clients et commandes jamais visibles en boutique", () => {
    expect(effectiveStorefrontVisible("CUSTOMER", true)).toBe(false);
    expect(effectiveStorefrontVisible("ORDER", true)).toBe(false);
    expect(effectiveStorefrontVisible("PRODUCT", true)).toBe(true);
    expect(effectiveStorefrontVisible("PRODUCT", false)).toBe(false);
  });

  it("clé suggérée depuis le nom", () => {
    expect(keyFromName("Matière principale")).toBe("matiere_principale");
  });
});

describe("metafields : CSV produit", () => {
  const defs = [
    { id: "def_matiere", namespace: "custom", key: "matiere", type: "single_line_text" as const },
    { id: "def_occasions", namespace: "custom", key: "occasions", type: "list_single_line_text" as const },
    { id: "def_assorti", namespace: "custom", key: "assorti", type: "product_reference" as const },
    { id: "def_poids", namespace: "custom", key: "poids", type: "weight" as const },
  ];

  it("colonnes metafield:namespace.key", () => {
    expect(parseMetafieldColumn("metafield:custom.matiere")).toEqual({ namespace: "custom", key: "matiere" });
    expect(parseMetafieldColumn("metafield:Custom.Matiere")).toEqual({ namespace: "custom", key: "matiere" });
    expect(parseMetafieldColumn("metafield:custom")).toBeNull();
    const m = mapMetafieldColumns(["name", "metafield:custom.matiere", "metafield:custom.inconnu", "metafield:custom.poids"], defs);
    expect(m.columns.map((c) => c.definition.id)).toEqual(["def_matiere", "def_poids"]);
    expect(m.unknown).toEqual(["metafield:custom.inconnu"]);
  });

  it("export puis import (aller-retour)", () => {
    const cells = metafieldCsvCells(defs, { def_matiere: "Wax", def_occasions: ["Mariage", "Baptême"], def_assorti: "cprod0000001", def_poids: { value: 0.4, unit: "kg" } }, { product: { cprod0000001: "sac-wax" } });
    expect(cells).toEqual({ "metafield:custom.matiere": "Wax", "metafield:custom.occasions": "Mariage|Baptême", "metafield:custom.assorti": "sac-wax", "metafield:custom.poids": "0.4 kg" });
    const mapping = mapMetafieldColumns(Object.keys(cells), defs);
    const entries = metafieldEntriesFromRow({ ...cells, "metafield:custom.matiere": "" }, mapping, { product: { "sac-wax": "cprod0000001" } });
    expect(entries).toEqual([
      { definitionId: "def_occasions", value: ["Mariage", "Baptême"] },
      { definitionId: "def_assorti", value: "cprod0000001" },
      { definitionId: "def_poids", value: { value: "0.4", unit: "kg" } },
    ]); // cellule vide = aucun changement
    for (const e of entries) {
      const d = defs.find((x) => x.id === e.definitionId)!;
      expect(validateMetafieldValue({ type: d.type }, e.value, { currency: "XOF" }).ok).toBe(true);
    }
  });
});

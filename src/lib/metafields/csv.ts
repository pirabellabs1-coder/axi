/**
 * Import / export CSV des champs personnalisés produit (lot 4 §5) : colonnes `metafield:{namespace}.{key}`.
 * Module PUR (testé). Le module CSV du catalogue l'intègre (voir docs/vague2/D-donnees.md) ; l'écriture passe
 * ensuite par `writeOwnerMetafields` (validation complète, références, appartenance).
 *
 * Conventions de cellule :
 *  - vide = aucun changement (pour effacer une valeur, utiliser l'éditeur) ;
 *  - liste de textes : éléments séparés par « | » ;
 *  - oui / non : `true`/`false` (ou oui/non, 1/0) ;
 *  - date : AAAA-MM-JJ ; couleur : #rrggbb ; image et lien : adresse ;
 *  - dimension / poids : « 12,5 cm », « 2 kg » ;
 *  - montant : entier dans la devise de la boutique (5000 = 5 000 FCFA) ;
 *  - produit / collection liés : slug (identifiant accepté aussi).
 */
import { fullKey, KEY_RE, NAMESPACE_RE, type MetafieldDefinitionDTO, type MetafieldType } from "./types";
import { metafieldRawText, parseMeasureText } from "./validate";

export const METAFIELD_COLUMN_PREFIX = "metafield:";
const COLUMN_RE = /^metafield:([a-z0-9_]{1,32})\.([a-z0-9_]{1,64})$/;
export const LIST_SEPARATOR = "|";

type Def = Pick<MetafieldDefinitionDTO, "id" | "namespace" | "key" | "type">;

export function metafieldColumn(def: { namespace: string; key: string }): string {
  return `${METAFIELD_COLUMN_PREFIX}${fullKey(def)}`;
}

/** `metafield:custom.matiere` → { namespace, key }, ou null. */
export function parseMetafieldColumn(header: string): { namespace: string; key: string } | null {
  const m = COLUMN_RE.exec(header.trim().toLowerCase());
  if (!m || !NAMESPACE_RE.test(m[1]) || !KEY_RE.test(m[2])) return null;
  return { namespace: m[1], key: m[2] };
}

/** En-têtes d'export, dans l'ordre des définitions fournies. */
export function metafieldCsvHeaders(defs: Def[]): string[] {
  return defs.map(metafieldColumn);
}

export type RefSlugs = { product?: Record<string, string>; collection?: Record<string, string> };

/** Cellule d'export pour une valeur (références : slug si fourni). */
export function metafieldCsvCell(type: MetafieldType, value: unknown, slugById: RefSlugs = {}): string {
  if (value === null || value === undefined) return "";
  if (type === "list_single_line_text") return Array.isArray(value) ? value.filter((x) => typeof x === "string").join(LIST_SEPARATOR) : "";
  if (type === "product_reference" && typeof value === "string") return slugById.product?.[value] ?? value;
  if (type === "collection_reference" && typeof value === "string") return slugById.collection?.[value] ?? value;
  return metafieldRawText(type, value);
}

/** Cellules d'export d'un produit : { [en-tête]: texte }. `values` : { [definitionId]: valeur }. */
export function metafieldCsvCells(defs: Def[], values: Record<string, unknown>, slugById: RefSlugs = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of defs) out[metafieldColumn(d)] = metafieldCsvCell(d.type, values[d.id], slugById);
  return out;
}

export type MetafieldColumns = {
  columns: { header: string; definition: Def }[];
  /** Colonnes `metafield:` sans définition correspondante (signalées, ignorées). */
  unknown: string[];
};

/** Associe les en-têtes du fichier aux définitions produit. Les colonnes hors `metafield:` sont ignorées. */
export function mapMetafieldColumns(headers: string[], defs: Def[]): MetafieldColumns {
  const byKey = new Map(defs.map((d) => [fullKey(d), d]));
  const out: MetafieldColumns = { columns: [], unknown: [] };
  for (const h of headers) {
    if (!h.trim().toLowerCase().startsWith(METAFIELD_COLUMN_PREFIX)) continue;
    const parsed = parseMetafieldColumn(h);
    const def = parsed ? byKey.get(fullKey(parsed)) : undefined;
    if (def) out.columns.push({ header: h, definition: def });
    else out.unknown.push(h);
  }
  return out;
}

export type RefIds = { product?: Record<string, string>; collection?: Record<string, string> };

/** Texte de cellule → valeur brute à valider (`validateMetafieldValue`). `undefined` = cellule vide (aucun changement). */
export function metafieldValueFromCell(type: MetafieldType, cell: string, idBySlug: RefIds = {}): unknown {
  const s = cell.trim();
  if (s === "") return undefined;
  switch (type) {
    case "list_single_line_text":
      return s.split(LIST_SEPARATOR).map((x) => x.trim()).filter(Boolean);
    case "image":
      return { url: s };
    case "dimension":
    case "weight":
      return parseMeasureText(type, s) ?? { value: s, unit: "" };
    case "money":
      return { amount: s.replace(/[\s  ]/g, "") };
    case "product_reference":
      return idBySlug.product?.[s.toLowerCase()] ?? s;
    case "collection_reference":
      return idBySlug.collection?.[s.toLowerCase()] ?? s;
    default:
      return s;
  }
}

/** Entrées à écrire pour une ligne du fichier : { definitionId, value } (cellules vides omises). */
export function metafieldEntriesFromRow(row: Record<string, string | undefined>, mapping: MetafieldColumns, idBySlug: RefIds = {}): { definitionId: string; value: unknown }[] {
  const out: { definitionId: string; value: unknown }[] = [];
  for (const { header, definition } of mapping.columns) {
    const v = metafieldValueFromCell(definition.type, row[header] ?? "", idBySlug);
    if (v !== undefined) out.push({ definitionId: definition.id, value: v });
  }
  return out;
}

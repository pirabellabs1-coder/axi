/**
 * Champs personnalisés (metafields), lot 4 §5 : liste FERMÉE des types, propriétaires, validations autorisées.
 * Module pur (aucune dépendance serveur), importable par l'éditeur client, le rendu boutique et les tests.
 *
 * Forme JSON des valeurs (colonne `MetafieldValue.value`) :
 *  - single_line_text, multi_line_text, rich_text (Markdown limité) : string
 *  - integer : number entier ; decimal : number ; rating : number (échelle validations.min..max, défaut 0..5)
 *  - boolean : boolean ; date : "AAAA-MM-JJ" ; color : "#rrggbb" ; url : https ou chemin interne « /… »
 *  - image : { url, alt? } (https ou média téléversé par la boutique)
 *  - product_reference, collection_reference : identifiant (vérifié : même boutique, existant)
 *  - list_single_line_text : string[]
 *  - dimension : { value, unit: mm|cm|m|in|ft } ; weight : { value, unit: g|kg|lb|oz }
 *  - money : { amount (unités entières de la devise de la boutique), currency }
 */
import type { MetafieldOwner } from "@prisma/client";

export const METAFIELD_TYPES = [
  "single_line_text",
  "multi_line_text",
  "rich_text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "color",
  "url",
  "image",
  "product_reference",
  "collection_reference",
  "list_single_line_text",
  "rating",
  "dimension",
  "weight",
  "money",
] as const;
export type MetafieldType = (typeof METAFIELD_TYPES)[number];

export function isMetafieldType(v: unknown): v is MetafieldType {
  return typeof v === "string" && (METAFIELD_TYPES as readonly string[]).includes(v);
}

export const METAFIELD_OWNERS = ["PRODUCT", "VARIANT", "COLLECTION", "CUSTOMER", "ORDER", "STORE", "PAGE", "BLOG_POST"] as const satisfies readonly MetafieldOwner[];
export type MetafieldOwnerType = (typeof METAFIELD_OWNERS)[number];

export function isMetafieldOwner(v: unknown): v is MetafieldOwnerType {
  return typeof v === "string" && (METAFIELD_OWNERS as readonly string[]).includes(v);
}

export const OWNER_LABELS: Record<MetafieldOwnerType, string> = {
  PRODUCT: "Produits",
  VARIANT: "Variantes",
  COLLECTION: "Collections",
  CUSTOMER: "Clients",
  ORDER: "Commandes",
  STORE: "Boutique",
  PAGE: "Pages",
  BLOG_POST: "Articles de blog",
};

/**
 * Propriétaires dont les champs peuvent être affichés en boutique. Sécurité (§23) : un champ de client ou de
 * commande n'est JAMAIS exposé à la vitrine, quel que soit `storefrontVisible`.
 */
export const STOREFRONT_OWNERS: readonly MetafieldOwnerType[] = ["PRODUCT", "VARIANT", "COLLECTION", "STORE", "PAGE", "BLOG_POST"];

export function ownerCanBePublic(owner: MetafieldOwnerType): boolean {
  return STOREFRONT_OWNERS.includes(owner);
}

export const NAMESPACE_RE = /^[a-z0-9_]{1,32}$/;
export const KEY_RE = /^[a-z0-9_]{1,64}$/;
export const DEFAULT_NAMESPACE = "custom";

export type MetafieldValidationKey = "min" | "max" | "regex" | "choices";
export type MetafieldValidations = { min?: number; max?: number; regex?: string; choices?: string[] };

type TypeMeta = {
  label: string;
  group: "Texte" | "Nombre" | "Référence" | "Autre";
  /** Validations configurables pour ce type ; `min`/`max` portent sur ce que décrit `range`. */
  validations: MetafieldValidationKey[];
  range?: "length" | "value" | "items";
  hint: string;
};

export const METAFIELD_TYPE_META: Record<MetafieldType, TypeMeta> = {
  single_line_text: { label: "Texte sur une ligne", group: "Texte", validations: ["min", "max", "regex", "choices"], range: "length", hint: "Ex. matière, origine, conseil d'entretien court." },
  multi_line_text: { label: "Texte sur plusieurs lignes", group: "Texte", validations: ["min", "max"], range: "length", hint: "Paragraphes simples, sans mise en forme." },
  rich_text: { label: "Texte mis en forme", group: "Texte", validations: ["max"], range: "length", hint: "Gras, italique, listes et liens (Markdown limité)." },
  list_single_line_text: { label: "Liste de textes", group: "Texte", validations: ["max", "choices"], range: "items", hint: "Ex. occasions, ingrédients, tailles disponibles." },
  integer: { label: "Nombre entier", group: "Nombre", validations: ["min", "max"], range: "value", hint: "Ex. nombre de pièces, garantie en mois." },
  decimal: { label: "Nombre décimal", group: "Nombre", validations: ["min", "max"], range: "value", hint: "Ex. teneur, pourcentage." },
  rating: { label: "Note", group: "Nombre", validations: ["min", "max"], range: "value", hint: "Note sur une échelle (0 à 5 par défaut)." },
  dimension: { label: "Dimension", group: "Nombre", validations: ["min", "max"], range: "value", hint: "Valeur et unité (mm, cm, m, in, ft)." },
  weight: { label: "Poids", group: "Nombre", validations: ["min", "max"], range: "value", hint: "Valeur et unité (g, kg, lb, oz)." },
  money: { label: "Montant", group: "Nombre", validations: ["min", "max"], range: "value", hint: "Montant dans la devise de la boutique." },
  boolean: { label: "Oui / non", group: "Autre", validations: [], hint: "Ex. fait main, produit local." },
  date: { label: "Date", group: "Autre", validations: [], hint: "Ex. date de récolte, de fabrication." },
  color: { label: "Couleur", group: "Autre", validations: [], hint: "Couleur au format #RRGGBB." },
  url: { label: "Lien", group: "Autre", validations: [], hint: "Adresse https ou page de la boutique (/catalogue)." },
  image: { label: "Image", group: "Autre", validations: [], hint: "Photo téléversée ou adresse https." },
  product_reference: { label: "Produit lié", group: "Référence", validations: [], hint: "Un produit de votre boutique (ex. produit assorti)." },
  collection_reference: { label: "Collection liée", group: "Référence", validations: [], hint: "Une collection de votre boutique." },
};

export const DIMENSION_UNITS = ["mm", "cm", "m", "in", "ft"] as const;
export const WEIGHT_UNITS = ["g", "kg", "lb", "oz"] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/** Plafonds de forme (indépendants des validations du commerçant). */
export const LIMITS = {
  singleLine: 255,
  multiLine: 5_000,
  richText: 10_000,
  listItems: 50,
  choices: 50,
  choiceLength: 100,
  regexLength: 100,
  name: 80,
  description: 300,
  number: 1e12,
} as const;

export type MetafieldValue =
  | string
  | number
  | boolean
  | string[]
  | { url: string; alt?: string }
  | { value: number; unit: string }
  | { amount: number; currency: string };

/** Définition telle qu'exposée au client (éditeur, écran de gestion). */
export type MetafieldDefinitionDTO = {
  id: string;
  ownerType: MetafieldOwnerType;
  namespace: string;
  key: string;
  name: string;
  description: string | null;
  type: MetafieldType;
  validations: MetafieldValidations;
  storefrontVisible: boolean;
  pinnedPosition: number | null;
};

export function fullKey(d: { namespace: string; key: string }): string {
  return `${d.namespace}.${d.key}`;
}

/** Suggestion de clé à partir du nom (« Matière » → « matiere »). */
export function keyFromName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

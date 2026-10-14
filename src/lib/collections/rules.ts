import { z } from "zod";

/**
 * Collections (modèle `Category`) — règles et tri, fonctions pures testées (tests/catalog-collections.test.ts).
 *
 * `Category.rules` :
 *  - `null` ou `{ type: "manual", productIds: string[] }` → collection MANUELLE. Membres = `productIds` (ordre manuel)
 *    ∪ produits dont `categoryId` = la collection (catégorie principale, rétrocompatibilité).
 *  - `{ type: "auto", match: "all" | "any", conditions: [...] }` → collection AUTOMATIQUE, recalculée à la lecture.
 */

export const CONDITION_FIELDS = ["tag", "price", "title", "promo", "type", "vendor"] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];
export type ConditionOp = "eq" | "neq" | "lt" | "gt" | "contains" | "is";

export type Condition = { field: ConditionField; op: ConditionOp; value: string };
export type AutoRules = { type: "auto"; match: "all" | "any"; conditions: Condition[] };
export type ManualRules = { type: "manual"; productIds: string[] };
export type CollectionRules = AutoRules | ManualRules;

export const SORT_ORDERS = ["manual", "newest", "price_asc", "price_desc", "best_selling", "alpha"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];
export const SORT_LABELS: Record<SortOrder, string> = {
  manual: "Manuel",
  newest: "Nouveautés",
  price_asc: "Prix croissant",
  price_desc: "Prix décroissant",
  best_selling: "Meilleures ventes",
  alpha: "Alphabétique (A à Z)",
};

export const FIELD_LABELS: Record<ConditionField, string> = {
  tag: "Étiquette",
  price: "Prix",
  title: "Titre",
  promo: "En promotion",
  type: "Type de produit",
  vendor: "Marque",
};

/** Opérateurs autorisés par champ. */
export const FIELD_OPS: Record<ConditionField, { op: ConditionOp; label: string }[]> = {
  tag: [{ op: "eq", label: "est égale à" }, { op: "neq", label: "n'est pas" }],
  price: [{ op: "lt", label: "est inférieur à" }, { op: "gt", label: "est supérieur à" }],
  title: [{ op: "contains", label: "contient" }, { op: "eq", label: "est égal à" }],
  promo: [{ op: "is", label: "est" }],
  type: [{ op: "eq", label: "est égal à" }],
  vendor: [{ op: "eq", label: "est égale à" }],
};

export const conditionSchema = z
  .object({
    field: z.enum(CONDITION_FIELDS),
    op: z.enum(["eq", "neq", "lt", "gt", "contains", "is"]),
    value: z.string().trim().max(80).default(""),
  })
  .superRefine((c, ctx) => {
    if (!FIELD_OPS[c.field].some((o) => o.op === c.op)) ctx.addIssue({ code: "custom", message: `Opérateur invalide pour « ${FIELD_LABELS[c.field]} »` });
    if (c.field === "price" && !/^\d{1,10}$/.test(c.value)) ctx.addIssue({ code: "custom", message: "Indiquez un prix entier" });
    if (c.field === "promo" && c.value !== "true" && c.value !== "false") ctx.addIssue({ code: "custom", message: "Valeur oui/non attendue" });
    if (c.field !== "promo" && c.field !== "price" && c.value.length === 0) ctx.addIssue({ code: "custom", message: `Valeur requise pour « ${FIELD_LABELS[c.field]} »` });
  });

export const rulesSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auto"), match: z.enum(["all", "any"]).default("all"), conditions: z.array(conditionSchema).min(1, "Ajoutez au moins une condition").max(20) }),
  z.object({ type: z.literal("manual"), productIds: z.array(z.string().max(64)).max(5000).default([]) }),
]);

/**
 * Alias acceptés à la lecture (format du rendu boutique `src/lib/storefront/catalog.ts`) :
 * `productType` → `type`, `compareAt` → `promo`, opérateurs `equals`/`not_equals`/`less_than`/`greater_than`, valeurs non textuelles.
 * L'éditeur écrit toujours le format canonique (`field` ∈ tag|price|title|promo|type|vendor, `op` ∈ eq|neq|lt|gt|contains|is),
 * que `parseRules` / `matchesCondition` du rendu comprennent tel quel.
 */
function normalizeCondition(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const c = raw as Record<string, unknown>;
  const field = c.field === "productType" ? "type" : c.field === "compareAt" ? "promo" : c.field;
  const opAlias: Record<string, string> = { equals: "eq", not_equals: "neq", less_than: "lt", greater_than: "gt" };
  let op = typeof c.op === "string" ? (opAlias[c.op] ?? c.op) : c.op;
  if (field === "promo") op = "is";
  const value = typeof c.value === "number" ? String(Math.round(c.value)) : typeof c.value === "boolean" ? String(c.value) : c.value;
  return { field, op, value };
}

/** Lecture tolérante de `Category.rules`. */
export function readRules(raw: unknown): CollectionRules {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.conditions) && r.conditions.length > 0) {
      const conditions = (r.conditions as unknown[])
        .map((c) => conditionSchema.safeParse(normalizeCondition(c)))
        .filter((p) => p.success)
        .map((p) => p.data as Condition);
      if (conditions.length) return { type: "auto", match: r.match === "any" ? "any" : "all", conditions };
    }
    if (Array.isArray(r.productIds)) return { type: "manual", productIds: (r.productIds as unknown[]).filter((x): x is string => typeof x === "string") };
  }
  return { type: "manual", productIds: [] };
}

/**
 * Liste manuelle à enregistrer : liste envoyée (dédoublonnée, dans l'ordre) + membres ARCHIVÉS déjà présents.
 * L'éditeur ne montre que les produits non archivés : sans cette fusion, enregistrer retirerait les archivés.
 */
export function mergeArchivedMembers(incoming: string[], previous: string[], archived: Set<string>): string[] {
  const list = [...new Set(incoming)];
  const seen = new Set(list);
  for (const id of previous) {
    if (archived.has(id) && !seen.has(id)) {
      list.push(id);
      seen.add(id);
    }
  }
  return list;
}

export function readSortOrder(raw: unknown): SortOrder {
  return SORT_ORDERS.includes(raw as SortOrder) ? (raw as SortOrder) : "manual";
}

export type RuleProduct = {
  id: string;
  name: string;
  price: number;
  promoPrice?: number | null;
  promoStart?: Date | null;
  promoEnd?: Date | null;
  compareAtPrice?: number | null;
  tags: string[];
  productType?: string | null;
  vendor?: string | null;
  categoryId?: string | null;
  createdAt?: Date;
  position?: number;
  /** Variantes (prix propre ou hérité, prix barré) : prises en compte par les conditions Prix et En promotion. */
  variants?: { price: number | null; compareAtPrice: number | null }[];
};

/** Prix affiché (promo datée comprise), aligné sur `effectivePrice`. */
export function displayPrice(p: Pick<RuleProduct, "price" | "promoPrice" | "promoStart" | "promoEnd">, now = new Date()): number {
  if (p.promoPrice != null && p.promoPrice < p.price && (!p.promoStart || p.promoStart <= now) && (!p.promoEnd || p.promoEnd >= now)) return p.promoPrice;
  return p.price;
}

/**
 * Prix « à partir de » : minimum des prix effectifs des variantes (prix propre, sinon prix produit promo comprise),
 * sinon prix produit effectif. Même sémantique que la carte produit de la boutique (`toCardProduct`).
 */
export function minEffectivePrice(p: Pick<RuleProduct, "price" | "promoPrice" | "promoStart" | "promoEnd" | "variants">, now = new Date()): number {
  const base = displayPrice(p, now);
  if (!p.variants?.length) return base;
  return Math.min(...p.variants.map((v) => v.price ?? base));
}

/**
 * En promotion : promo datée active, prix barré produit supérieur au prix effectif, ou prix barré d'une variante
 * supérieur à son prix. Même sémantique que la boutique (`CardProduct.onSale`).
 */
export function isOnSale(p: Pick<RuleProduct, "price" | "promoPrice" | "promoStart" | "promoEnd" | "compareAtPrice" | "variants">, now = new Date()): boolean {
  const base = displayPrice(p, now);
  if (base < p.price) return true;
  if (p.compareAtPrice != null && p.compareAtPrice > base) return true;
  return (p.variants ?? []).some((v) => v.compareAtPrice != null && v.compareAtPrice > (v.price ?? base));
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase("fr");

export function matchesCondition(p: RuleProduct, c: Condition, now = new Date()): boolean {
  switch (c.field) {
    case "tag": {
      const has = p.tags.some((t) => norm(t) === norm(c.value));
      return c.op === "neq" ? !has : has;
    }
    case "price": {
      const v = Number(c.value);
      const price = minEffectivePrice(p, now);
      return c.op === "lt" ? price < v : price > v;
    }
    case "title":
      return c.op === "eq" ? norm(p.name) === norm(c.value) : norm(p.name).includes(norm(c.value));
    case "promo":
      return isOnSale(p, now) === (c.value === "true");
    case "type":
      return norm(p.productType) === norm(c.value);
    case "vendor":
      return norm(p.vendor) === norm(c.value);
  }
}

export function matchesRules(p: RuleProduct, rules: AutoRules, now = new Date()): boolean {
  if (rules.conditions.length === 0) return false;
  return rules.match === "any" ? rules.conditions.some((c) => matchesCondition(p, c, now)) : rules.conditions.every((c) => matchesCondition(p, c, now));
}

/**
 * Membres d'une collection, dans l'ordre demandé.
 * `sales` : quantités vendues par produit (pour « meilleures ventes »).
 */
export function resolveCollection<P extends RuleProduct>(
  collectionId: string,
  rules: CollectionRules,
  sortOrder: SortOrder,
  products: P[],
  opts: { sales?: Map<string, number>; now?: Date } = {},
): P[] {
  const now = opts.now ?? new Date();
  let members: P[];
  let manualIndex = new Map<string, number>();
  if (rules.type === "auto") {
    members = products.filter((p) => matchesRules(p, rules, now));
  } else {
    manualIndex = new Map(rules.productIds.map((id, i) => [id, i]));
    members = products.filter((p) => manualIndex.has(p.id) || p.categoryId === collectionId);
  }
  return sortProducts(members, sortOrder, { manualIndex, sales: opts.sales, now });
}

export function sortProducts<P extends RuleProduct>(list: P[], sortOrder: SortOrder, opts: { manualIndex?: Map<string, number>; sales?: Map<string, number>; now?: Date } = {}): P[] {
  const now = opts.now ?? new Date();
  const byPos = (a: P, b: P) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, "fr");
  const arr = [...list];
  switch (sortOrder) {
    case "newest":
      return arr.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    case "price_asc":
      return arr.sort((a, b) => minEffectivePrice(a, now) - minEffectivePrice(b, now) || byPos(a, b));
    case "price_desc":
      return arr.sort((a, b) => minEffectivePrice(b, now) - minEffectivePrice(a, now) || byPos(a, b));
    case "best_selling":
      return arr.sort((a, b) => (opts.sales?.get(b.id) ?? 0) - (opts.sales?.get(a.id) ?? 0) || byPos(a, b));
    case "alpha":
      return arr.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    case "manual":
    default: {
      const idx = opts.manualIndex ?? new Map<string, number>();
      return arr.sort((a, b) => (idx.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b.id) ?? Number.MAX_SAFE_INTEGER) || byPos(a, b));
    }
  }
}

/** Résumé lisible des règles (« Étiquette est égale à wax et Prix est inférieur à 10000 »). */
export function describeRules(rules: CollectionRules): string {
  if (rules.type === "manual") return "Manuelle";
  const parts = rules.conditions.map((c) => {
    const op = FIELD_OPS[c.field].find((o) => o.op === c.op)?.label ?? c.op;
    const val = c.field === "promo" ? (c.value === "true" ? "oui" : "non") : c.value;
    return `${FIELD_LABELS[c.field]} ${op} ${val}`;
  });
  return parts.join(rules.match === "any" ? " ou " : " et ");
}

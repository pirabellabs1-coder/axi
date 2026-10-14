import { z } from "zod";
import { COUNTRIES } from "@/config/site";
import { categoryBySlug } from "./categories";

/** Paramètres de recherche de la marketplace (partagé serveur et client). */
export const SORTS = [
  { id: "pertinence", label: "Pertinence" },
  { id: "nouveautes", label: "Nouveautés" },
  { id: "prix-croissant", label: "Prix croissant" },
  { id: "prix-decroissant", label: "Prix décroissant" },
] as const;

export type SortId = (typeof SORTS)[number]["id"];
export type ResultTab = "produits" | "boutiques";

export type MarketplaceQuery = {
  q?: string;
  cat?: string;
  pays?: string;
  ville?: string;
  tri: SortId;
  min?: number;
  max?: number;
  page: number;
  onglet: ResultTab;
};

export const PAGE_SIZE = 24;
const MAX_PRICE = 100_000_000;

const str = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max))
    .optional()
    .catch(undefined);

const intParam = (lo: number, hi: number) =>
  z.coerce
    .number()
    .int()
    .min(lo)
    .max(hi)
    .optional()
    .catch(undefined);

const schema = z.object({
  q: str(80),
  cat: str(40),
  pays: str(4),
  ville: str(60),
  tri: z.enum(SORTS.map((s) => s.id) as [SortId, ...SortId[]]).catch("pertinence"),
  min: intParam(0, MAX_PRICE),
  max: intParam(0, MAX_PRICE),
  page: z.coerce.number().int().min(1).max(500).catch(1),
  onglet: z.enum(["produits", "boutiques"]).catch("produits"),
});

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export function parseMarketplaceQuery(raw: RawParams): MarketplaceQuery {
  const parsed = schema.parse({
    q: first(raw.q),
    cat: first(raw.cat),
    pays: first(raw.pays),
    ville: first(raw.ville),
    tri: first(raw.tri) ?? "pertinence",
    min: first(raw.min) || undefined,
    max: first(raw.max) || undefined,
    page: first(raw.page) ?? 1,
    onglet: first(raw.onglet) ?? "produits",
  });
  let { min, max } = parsed;
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return {
    q: parsed.q || undefined,
    cat: categoryBySlug(parsed.cat) ? parsed.cat : undefined,
    pays: COUNTRIES.some((c) => c.code === parsed.pays?.toUpperCase()) ? parsed.pays!.toUpperCase() : undefined,
    ville: parsed.ville || undefined,
    // Le tri par prix n'a pas de sens pour les boutiques.
    tri: parsed.onglet === "boutiques" && parsed.tri.startsWith("prix") ? "pertinence" : parsed.tri,
    min,
    max,
    page: parsed.page,
    onglet: parsed.onglet,
  };
}

/** Construit l'URL de recherche (les valeurs par défaut sont omises). */
export function searchHref(q: Partial<MarketplaceQuery>): string {
  const sp = new URLSearchParams();
  if (q.q) sp.set("q", q.q);
  if (q.cat) sp.set("cat", q.cat);
  if (q.pays) sp.set("pays", q.pays);
  if (q.ville) sp.set("ville", q.ville);
  if (q.tri && q.tri !== "pertinence") sp.set("tri", q.tri);
  if (q.min != null) sp.set("min", String(q.min));
  if (q.max != null) sp.set("max", String(q.max));
  if (q.onglet && q.onglet !== "produits") sp.set("onglet", q.onglet);
  if (q.page && q.page > 1) sp.set("page", String(q.page));
  const qs = sp.toString();
  return qs ? `/marketplace/recherche?${qs}` : "/marketplace/recherche";
}

export function hasActiveFilters(q: MarketplaceQuery): boolean {
  return !!(q.cat || q.pays || q.ville || q.min != null || q.max != null);
}

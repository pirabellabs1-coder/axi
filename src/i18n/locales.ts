/**
 * Langues de la plateforme (lot 2 §1.1). Module PUR : importable côté client, côté serveur et par `src/proxy.ts`
 * (le proxy tourne dans le runtime Edge et ne doit importer ni Prisma ni `server-only`).
 *
 *  - `Store.locale` = langue principale (URL sans préfixe) ;
 *  - `Store.enabledLocales` = langues secondaires (URL `/{locale}/…`) ;
 *  - le nombre total de langues est plafonné par `PLANS[…].limits.languages`.
 */

export type LocaleDir = "ltr" | "rtl";

export type PlatformLocale = {
  code: string;
  /** Nom de la langue dans la langue elle-même (affiché au visiteur). */
  endonym: string;
  /** Nom en français (interface marchande). */
  label: string;
  dir: LocaleDir;
  /** Étiquette `lang` HTML et `hreflang` (identique au code pour toutes nos langues). */
  htmlLang: string;
};

export const PLATFORM_LOCALES: readonly PlatformLocale[] = [
  { code: "fr", endonym: "Français", label: "Français", dir: "ltr", htmlLang: "fr" },
  { code: "en", endonym: "English", label: "Anglais", dir: "ltr", htmlLang: "en" },
  { code: "pt", endonym: "Português", label: "Portugais", dir: "ltr", htmlLang: "pt" },
  { code: "es", endonym: "Español", label: "Espagnol", dir: "ltr", htmlLang: "es" },
  { code: "ar", endonym: "العربية", label: "Arabe", dir: "rtl", htmlLang: "ar" },
  { code: "wo", endonym: "Wolof", label: "Wolof", dir: "ltr", htmlLang: "wo" },
  { code: "fon", endonym: "Fɔngbè", label: "Fon", dir: "ltr", htmlLang: "fon" },
  { code: "yo", endonym: "Yorùbá", label: "Yoruba", dir: "ltr", htmlLang: "yo" },
  { code: "ha", endonym: "Hausa", label: "Haoussa", dir: "ltr", htmlLang: "ha" },
  { code: "sw", endonym: "Kiswahili", label: "Swahili", dir: "ltr", htmlLang: "sw" },
  { code: "ln", endonym: "Lingála", label: "Lingala", dir: "ltr", htmlLang: "ln" },
  { code: "bm", endonym: "Bamanankan", label: "Bambara", dir: "ltr", htmlLang: "bm" },
] as const;

export const LOCALE_CODES: readonly string[] = PLATFORM_LOCALES.map((l) => l.code);

/** Langue de repli de la plateforme : aucun champ n'est jamais vide grâce à elle. */
export const DEFAULT_LOCALE = "fr";

const BY_CODE = new Map(PLATFORM_LOCALES.map((l) => [l.code, l]));

export function isPlatformLocale(v: unknown): v is string {
  return typeof v === "string" && BY_CODE.has(v);
}

export function localeMeta(code: string): PlatformLocale {
  return BY_CODE.get(code) ?? BY_CODE.get(DEFAULT_LOCALE)!;
}

export function localeDir(code: string): LocaleDir {
  return localeMeta(code).dir;
}

/** « English » (endonyme) — utilisé par le bandeau de suggestion et le sélecteur de langue. */
export function localeEndonym(code: string): string {
  return localeMeta(code).endonym;
}

/** « Anglais » — interface marchande, toujours en français. */
export function localeLabel(code: string): string {
  return localeMeta(code).label;
}

/* ───────────────────────── Langues d'une boutique ───────────────────────── */

export type StoreLocalesInput = { locale?: string | null; enabledLocales?: readonly string[] | null };

export type StoreLocales = {
  /** Langue principale (URL sans préfixe). */
  primary: string;
  /** Langues secondaires effectivement actives (hors principale, dédoublonnées, dans l'ordre choisi). */
  secondary: string[];
  /** Principale + secondaires, dans l'ordre d'affichage. */
  all: string[];
  /** Langues conservées en base mais désactivées par le quota du plan (baisse de plan). */
  overQuota: string[];
};

/**
 * Langues réellement servies par une boutique, plafonnées par le quota du plan (`limits.languages`,
 * `null` = illimité). La langue principale compte dans le quota ; les langues en trop après une baisse
 * de plan sont désactivées (contenus et traductions conservés, cas limite §1.1).
 */
export function storeLocales(store: StoreLocalesInput, limit: number | null | undefined = null): StoreLocales {
  const primary = isPlatformLocale(store.locale) ? store.locale : DEFAULT_LOCALE;
  const seen = new Set<string>([primary]);
  const requested: string[] = [];
  for (const code of store.enabledLocales ?? []) {
    if (!isPlatformLocale(code) || seen.has(code)) continue;
    seen.add(code);
    requested.push(code);
  }
  const room = limit == null ? requested.length : Math.max(0, limit - 1);
  const secondary = requested.slice(0, room);
  return { primary, secondary, all: [primary, ...secondary], overQuota: requested.slice(room) };
}

/** La langue est-elle servie par cette boutique (principale ou secondaire active) ? */
export function isLocaleServed(locales: StoreLocales, code: string): boolean {
  return locales.all.includes(code);
}

/* ───────────────────────── Segment de langue dans l'URL ───────────────────────── */

const SLUG_RE = /^[a-z0-9-]{3,48}$/;

export type LocaleSplit = {
  /** Langue détectée dans l'URL, ou null. */
  locale: string | null;
  /** Chemin sans le segment de langue (forme donnée en entrée). */
  path: string;
  /** Adresse de la boutique quand le chemin est de la forme `/s/{slug}/…`. */
  slug: string | null;
};

/**
 * Détecte le segment de langue d'un chemin de boutique et le retire.
 *
 *  - domaine principal : `/s/{slug}/en/p/robe` → `{ locale: "en", path: "/s/{slug}/p/robe" }` ;
 *  - domaine ou sous-domaine de boutique (`storeHost`) : `/en/p/robe` → `{ locale: "en", path: "/p/robe" }`.
 *
 * Pur et total : un segment inconnu, une URL d'API ou un chemin d'espace marchand ressortent inchangés.
 * `storeHost` est faux sur le domaine de l'application : `/en/connexion` n'y est jamais une langue.
 */
export function splitLocalePath(pathname: string, opts: { storeHost?: boolean } = {}): LocaleSplit {
  const segments = pathname.split("/").filter((s) => s !== "");
  const isStorePath = segments[0] === "s" && !!segments[1] && SLUG_RE.test(segments[1]);
  const slug = isStorePath ? segments[1]! : null;
  const at = isStorePath ? 2 : opts.storeHost ? 0 : -1;
  if (at < 0 || !isPlatformLocale(segments[at])) return { locale: null, path: pathname, slug };
  const rest = [...segments.slice(0, at), ...segments.slice(at + 1)];
  const trailing = pathname.endsWith("/") && rest.length > 0 ? "/" : "";
  return { locale: segments[at]!, path: rest.length ? `/${rest.join("/")}${trailing}` : "/", slug };
}

/**
 * Insère le segment de langue dans un chemin PUBLIC de boutique (`/s/x/p/y` + `en` → `/s/x/en/p/y`,
 * `/p/y` + `en` → `/en/p/y` sur le domaine d'une boutique). `locale` nul retire le segment existant.
 * À n'utiliser que sur des chemins de vitrine (construction de liens et d'alternatives hreflang).
 */
export function withLocalePath(pathname: string, locale: string | null): string {
  const bare = splitLocalePath(pathname, { storeHost: true });
  if (!locale || !isPlatformLocale(locale)) return bare.path;
  const segments = bare.path.split("/").filter((s) => s !== "");
  const at = segments[0] === "s" && !!segments[1] && SLUG_RE.test(segments[1]) ? 2 : 0;
  const next = [...segments.slice(0, at), locale, ...segments.slice(at)];
  return `/${next.join("/")}`;
}

/** Préfixe de base des liens d'une boutique : `/s/{slug}` en langue principale, `/s/{slug}/{locale}` sinon. */
export function storeBasePath(slug: string, locale: string, primary: string): string {
  return locale === primary || !isPlatformLocale(locale) ? `/s/${slug}` : `/s/${slug}/${locale}`;
}

/**
 * Vue de langue passée au rendu (`RenderData.locale`) : sérialisable, utilisable par un composant client
 * (sélecteur de langue, bandeau de suggestion).
 */
export type LocaleView = {
  locale: string;
  primary: string;
  dir: LocaleDir;
  /** "" en langue principale, "/en" sinon. */
  prefix: string;
  /** Langues proposées au visiteur : code, nom dans la langue, URL de la page courante. */
  options: { code: string; label: string; href: string; current: boolean }[];
  /** Langue suggérée (cookie ou navigateur) : bandeau uniquement, jamais de redirection. */
  suggestion: { locale: string; label: string; href: string } | null;
};

/* ───────────────────────── Suggestion de langue (bandeau) ───────────────────────── */

/** Cookie de préférence : bandeau de suggestion UNIQUEMENT, jamais de redirection automatique (SEO §1.1). */
export const LOCALE_COOKIE = "axi_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** En-tête posé par le proxy à chaque requête ; une valeur envoyée par le client n'est jamais reprise. */
export const LOCALE_HEADER = "x-axi-locale";
/** Chemin public sans segment de langue, transmis par le proxy (construction des alternatives hreflang). */
export const LOCALE_PATH_HEADER = "x-axi-locale-path";

/** Première langue acceptée par le navigateur qui soit servie par la boutique (pur, insensible à la casse). */
export function pickFromAcceptLanguage(header: string | null | undefined, served: readonly string[]): string | null {
  if (!header) return null;
  const parsed = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: (tag ?? "").trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((p) => p.tag && Number.isFinite(p.q) && p.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of parsed) {
    const base = tag.split("-")[0]!;
    const hit = served.find((code) => code === tag || code === base);
    if (hit) return hit;
  }
  return null;
}

/**
 * Langue à proposer dans le bandeau : préférence explicite (cookie) sinon `Accept-Language`, à condition
 * qu'elle soit servie par la boutique et différente de la langue affichée. Jamais de redirection.
 */
export function suggestLocale(p: { current: string; cookie?: string | null; acceptLanguage?: string | null; served: readonly string[] }): string | null {
  const wanted = isPlatformLocale(p.cookie) && p.served.includes(p.cookie) ? p.cookie : pickFromAcceptLanguage(p.acceptLanguage, p.served);
  return wanted && wanted !== p.current ? wanted : null;
}

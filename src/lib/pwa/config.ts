/**
 * Boutique installable (lot 4 §14) : réglages par boutique (`Store.pwaConfig`), portée et manifeste.
 * Fonctions PURES (aucun accès base, aucun `next/headers`) : utilisables côté serveur, dans les tests
 * et dans l'aperçu. La portée dépend de l'hôte servi :
 *  - sous-domaine `{slug}.axi.africa` ou domaine propre → `start_url` et `scope` = `/` ;
 *  - domaine de l'application (`axi.africa`, `localhost:3000`) → `/s/{slug}/`.
 */

export type PwaIcon = { url: string; size: 192 | 512 };

export type PwaConfig = {
  /** Boutique installable proposée aux visiteurs (plan `pwa` requis, contrôlé côté serveur). */
  enabled: boolean;
  /** Invitation discrète à l'installation (après 2 visites ou un ajout au panier). */
  prompt: boolean;
  /** Nom affiché à l'installation (défaut : nom de la boutique) et nom court (icône, 12 caractères). */
  name: string | null;
  shortName: string | null;
  /** Icônes PNG carrées générées côté client au téléversement (canvas), stockées comme les autres médias. */
  icon192: string | null;
  icon512: string | null;
  /** Message de la page hors ligne (défaut : texte générique). */
  offlineText: string | null;
};

export const DEFAULT_PWA_CONFIG: PwaConfig = { enabled: false, prompt: true, name: null, shortName: null, icon192: null, icon512: null, offlineText: null };

const MAX_URL = 500;

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);
  return s || null;
}

/** URL d'image acceptée : média stocké (`/media/…`) ou https. Jamais de data-URL (poids du manifeste). */
function cleanImageUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length > MAX_URL) return null;
  if (s.startsWith("/media/") || s.startsWith("/")) return /^\/[\w\-./]+$/.test(s) ? s : null;
  return /^https:\/\/[^\s<>"']+$/.test(s) ? s : null;
}

/** Lecture défensive de `Store.pwaConfig` (JSON libre en base) : liste blanche, valeurs par défaut. */
export function readPwaConfig(raw: unknown): PwaConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_PWA_CONFIG };
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    prompt: o.prompt !== false,
    name: cleanText(o.name, 60),
    shortName: cleanText(o.shortName, 12),
    icon192: cleanImageUrl(o.icon192),
    icon512: cleanImageUrl(o.icon512),
    offlineText: cleanText(o.offlineText, 200),
  };
}

export type ScopeInput = { slug: string; host: string | null; appDomain: string };

/** `true` si l'hôte servi est propre à la boutique (sous-domaine ou domaine personnalisé). */
export function isStoreHost({ host, appDomain }: Pick<ScopeInput, "host" | "appDomain">): boolean {
  const h = (host ?? "").toLowerCase().trim();
  const app = appDomain.toLowerCase().trim();
  if (!h) return false;
  if (h === app || h === `www.${app}`) return false;
  const bare = h.split(":")[0];
  if (bare === "localhost" || bare === "127.0.0.1" || bare === "[::1]") return false;
  if (h.endsWith(`.${app}`)) return h.slice(0, -(app.length + 1)) !== "www";
  return true;
}

/** Portée du service worker et du manifeste : toujours terminée par `/`. */
export function pwaScope(input: ScopeInput): string {
  return isStoreHost(input) ? "/" : `/s/${input.slug}/`;
}

export type ManifestStore = {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
};

export type WebManifest = {
  id: string;
  name: string;
  short_name: string;
  description?: string;
  start_url: string;
  scope: string;
  display: "standalone";
  display_override: string[];
  orientation: "portrait";
  dir: "ltr";
  lang: string;
  theme_color: string;
  background_color: string;
  categories: string[];
  icons: { src: string; sizes: string; type: string; purpose: string }[];
  shortcuts: { name: string; url: string }[];
};

/** Couleur hexadécimale valide, sinon repli. */
export function safeColor(v: string | null | undefined, fallback: string): string {
  return typeof v === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback;
}

/** Nom court par défaut : premier mot (ou troncature) du nom de la boutique, 12 caractères maximum. */
export function defaultShortName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length <= 12) return clean || "Boutique";
  const first = clean.split(" ")[0];
  return (first.length <= 12 ? first : clean.slice(0, 12)).trim() || "Boutique";
}

/**
 * Manifeste de la boutique. `theme_color` = couleur primaire du thème, `background_color` = fond du thème.
 * Les icônes générées à l'envoi (192 et 512) sont déclarées en `any maskable` ; sans icône, le logo est utilisé
 * si et seulement si c'est un PNG (le manifeste exige un type sûr) ; sinon aucune icône n'est déclarée.
 */
export function buildManifest(store: ManifestStore, cfg: PwaConfig, opts: { scope: string; primary: string; background: string }): WebManifest {
  const name = cfg.name ?? store.name;
  const icons: WebManifest["icons"] = [];
  if (cfg.icon192) icons.push({ src: cfg.icon192, sizes: "192x192", type: "image/png", purpose: "any" });
  if (cfg.icon512) icons.push({ src: cfg.icon512, sizes: "512x512", type: "image/png", purpose: "any" });
  if (cfg.icon512) icons.push({ src: cfg.icon512, sizes: "512x512", type: "image/png", purpose: "maskable" });
  if (!icons.length && store.logoUrl && /\.png(\?|$)/i.test(store.logoUrl)) {
    icons.push({ src: store.logoUrl, sizes: "512x512", type: "image/png", purpose: "any" });
  }
  const description = (cfg.name ? null : store.tagline) ?? store.tagline ?? store.description?.slice(0, 180) ?? undefined;
  return {
    id: opts.scope,
    name,
    short_name: cfg.shortName ?? defaultShortName(name),
    description: description ?? undefined,
    start_url: opts.scope,
    scope: opts.scope,
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    orientation: "portrait",
    dir: "ltr",
    lang: "fr",
    theme_color: safeColor(opts.primary, "#111412"),
    background_color: safeColor(opts.background, "#ffffff"),
    categories: ["shopping"],
    icons,
    shortcuts: [
      { name: "Catalogue", url: `${opts.scope}catalogue` },
      { name: "Mon compte", url: `${opts.scope}compte` },
    ],
  };
}

/** Critères d'installabilité contrôlés côté serveur avant de proposer l'installation. */
export function installabilityIssues(cfg: PwaConfig, manifest: WebManifest): string[] {
  const issues: string[] = [];
  if (!cfg.enabled) issues.push("La boutique installable n'est pas activée.");
  if (!manifest.icons.some((i) => i.sizes === "192x192")) issues.push("Icône 192 × 192 manquante.");
  if (!manifest.icons.some((i) => i.sizes === "512x512")) issues.push("Icône 512 × 512 manquante.");
  if (!manifest.name) issues.push("Nom manquant.");
  return issues;
}

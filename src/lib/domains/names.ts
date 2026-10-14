/**
 * Noms de domaine achetables via Axi (module PUR côté serveur — `node:url` —, testé : tests/domains-registration.test.ts).
 *
 * - Saisie libre (« Ma Boutique.com », « https://exemple.shop/ », IDN « café.fr ») → nom ASCII normalisé
 *   (punycode via `domainToASCII`, minuscules), un seul label + une extension (pas de sous-domaine à l'achat).
 * - Extensions vendables : liste blanche `SELLABLE_TLDS` (sous-ensemble de ce que Route 53 Domains enregistre,
 *   surchargeable par `DOMAINS_ALLOWED_TLDS`). Les ccTLD africains (ex. `.bj`) ne sont pas vendables par API :
 *   le marchand les achète chez le registre local puis les connecte (« J'ai déjà un domaine »).
 */
import { domainToASCII, domainToUnicode } from "node:url";
import { z } from "zod";

/** Extensions proposées par défaut (toutes vendues par Amazon Route 53 Domains). */
export const DEFAULT_SELLABLE_TLDS = ["com", "net", "org", "shop", "store", "online", "site", "co", "io", "info", "biz", "me", "app", "fr", "be", "ch", "ca"] as const;

/** Extensions fréquemment demandées mais NON vendables par API (registres nationaux sans revendeur Route 53). */
export const NON_API_TLDS = ["bj", "ci", "sn", "tg", "bf", "ml", "ne", "cm", "ga", "cg", "cd", "gn", "mg", "td", "bi", "rw", "dj", "km", "mr", "ma", "tn", "dz", "ng", "gh", "ke"] as const;

/** Extensions vendables (variable `DOMAINS_ALLOWED_TLDS="com,net,shop"` côté serveur, sinon la liste par défaut). */
export function sellableTlds(env: string | undefined = typeof process !== "undefined" ? process.env.DOMAINS_ALLOWED_TLDS : undefined): string[] {
  const list = (env ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/^\./, ""))
    .filter((t) => /^[a-z]{2,24}$/.test(t));
  return list.length ? [...new Set(list)] : [...DEFAULT_SELLABLE_TLDS];
}

const LABEL_RE = /^(?!-)(?!..--)[a-z0-9-]{1,63}(?<!-)$/;
const PUNY_LABEL_RE = /^xn--[a-z0-9-]{1,59}(?<!-)$/;

export type ParsedDomain = { ascii: string; unicode: string; label: string; tld: string };
export type DomainParseError = { error: "empty" | "invalid" | "too_long" | "subdomain" | "no_tld" | "tld_not_api" | "tld_not_allowed" | "script"; tld?: string };

/**
 * Anti-homographe : un label IDN ne peut contenir que l'écriture latine (accents compris), des chiffres et des tirets.
 * Refuse les mélanges (ex. « а » cyrillique dans « аpple ») et les autres écritures.
 */
const LATIN_LABEL_RE = /^[\p{Script=Latin}\p{Nd}-]+$/u;
export function latinOnlyLabel(unicodeLabel: string): boolean {
  return LATIN_LABEL_RE.test(unicodeLabel.normalize("NFC"));
}

/** Nettoie une saisie : schéma, chemin, port, espaces, point final. */
export function cleanDomainInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "")
    .replace(/\s+/g, "");
}

/** Analyse un nom complet « label.tld » achetable. */
export function parseDomain(raw: string, allowed: readonly string[] = sellableTlds()): ParsedDomain | DomainParseError {
  const input = cleanDomainInput(raw);
  if (!input) return { error: "empty" };
  if (input.length > 253) return { error: "too_long" };
  const ascii = domainToASCII(input);
  if (!ascii) return { error: "invalid" };
  const parts = ascii.split(".");
  if (parts.length < 2) return { error: "no_tld" };
  const tld = parts[parts.length - 1];
  if ((NON_API_TLDS as readonly string[]).includes(tld)) return { error: "tld_not_api", tld };
  if (parts.length > 2) return { error: "subdomain" };
  const label = parts[0];
  if (!/^[a-z]{2,24}$/.test(tld)) return { error: "invalid" };
  if (!(LABEL_RE.test(label) || PUNY_LABEL_RE.test(label))) return { error: "invalid" };
  if (!allowed.includes(tld)) return { error: "tld_not_allowed", tld };
  const unicode = domainToUnicode(ascii) || ascii;
  if (label.startsWith("xn--") && !latinOnlyLabel(unicode.split(".")[0])) return { error: "script" };
  return { ascii, unicode, label, tld };
}

/** Message français d'une erreur d'analyse. */
export function domainErrorMessage(e: DomainParseError, allowed: readonly string[] = sellableTlds()): string {
  switch (e.error) {
    case "empty":
      return "Saisissez un nom de domaine.";
    case "too_long":
      return "Nom de domaine trop long.";
    case "subdomain":
      return "Saisissez un nom de domaine sans sous-domaine (ex. maboutique.com).";
    case "no_tld":
      return "Ajoutez l'extension (ex. maboutique.com).";
    case "tld_not_api":
      return `Les domaines en .${e.tld} ne peuvent pas être achetés via Axi : réservez-le auprès du registre national ou d'un revendeur local, puis connectez-le ci-dessous avec « J'ai déjà un domaine ».`;
    case "script":
      return "Seuls les caractères latins (accents compris), les chiffres et les traits d'union sont acceptés.";
    case "tld_not_allowed":
      return `L'extension .${e.tld} n'est pas proposée. Extensions disponibles : ${allowed.map((t) => `.${t}`).join(", ")}.`;
    default:
      return "Nom de domaine invalide : lettres, chiffres et traits d'union (1 à 63 caractères), sans tiret au début ni à la fin.";
  }
}

/** Variantes de la recherche dans les autres extensions vendables (suggestions de repli, sans appel registrar). */
export function extensionVariants(parsed: ParsedDomain, allowed: readonly string[] = sellableTlds(), max = 5): string[] {
  return allowed.filter((t) => t !== parsed.tld).slice(0, max).map((t) => `${parsed.label}.${t}`);
}

/** Titulaire du domaine (le marchand). Validation serveur commune à l'action d'achat et aux tests. */
export const contactSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis").max(60),
  lastName: z.string().trim().min(1, "Nom requis").max(60),
  organization: z.string().trim().max(100).optional().transform((v) => v || undefined),
  email: z.email("E-mail invalide").max(200),
  // E.164 : « +22997000000 » ; envoyé au registrar au format « +229.97000000 »
  phone: z.string().trim().regex(/^\+?[1-9]\d{6,14}$/, "Téléphone au format international (ex. +22997000000)"),
  address1: z.string().trim().min(3, "Adresse requise").max(255),
  city: z.string().trim().min(1, "Ville requise").max(100),
  state: z.string().trim().max(100).optional().transform((v) => v || undefined),
  zip: z.string().trim().max(20).optional().transform((v) => v || undefined),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Pays (code ISO à 2 lettres)"),
});
type ContactOut = z.infer<typeof contactSchema>;
export type DomainContact = Omit<ContactOut, "organization" | "state" | "zip"> & Partial<Pick<ContactOut, "organization" | "state" | "zip">>;

/** Indicatif téléphonique : `+229.97000000` attendu par Route 53 (indicatif pays deviné sur 1 à 3 chiffres). */
export function registrarPhone(e164: string, country: string): string {
  const digits = e164.replace(/[^\d]/g, "");
  const cc = COUNTRY_CALLING_CODES[country] ?? (digits.length > 10 ? digits.slice(0, 3) : digits.slice(0, 1));
  const rest = digits.startsWith(cc) ? digits.slice(cc.length) : digits;
  return `+${cc}.${rest}`;
}

const COUNTRY_CALLING_CODES: Record<string, string> = {
  BJ: "229", CI: "225", SN: "221", TG: "228", BF: "226", ML: "223", NE: "227", CM: "237", GA: "241", CG: "242", CD: "243", GN: "224",
  MA: "212", TN: "216", DZ: "213", NG: "234", GH: "233", KE: "254", FR: "33", BE: "32", CH: "41", CA: "1", US: "1", GB: "44", DE: "49",
};

/** Titulaire anonymisé (après enregistrement, ou boutique supprimée) : seules les données utiles à l'audit restent. */
export function anonymizedContact(c: { country?: unknown } | null | undefined) {
  return { anonymized: true, country: typeof c?.country === "string" ? c.country : null };
}

/**
 * Message d'un registrar avant journalisation ou affichage : sans e-mail, sans numéro (téléphone, adresse), ni
 * jeton long ; une ligne, 200 caractères maximum.
 */
export function sanitizeRegistrarMessage(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .replace(/[^\s@]+@[^\s@]+/g, "[e-mail]")
    .replace(/\+?\d[\d .()-]{5,}\d/g, "[numéro]")
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, "[…]")
    .trim()
    .slice(0, 200);
}

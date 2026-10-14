/**
 * Validation des champs personnalisés (module pur, partagé client / serveur, testé) :
 *  - définitions : clé `namespace.key`, type de la liste fermée, validations (min, max, regex limitée, choix) ;
 *  - valeurs : JSON validé par type puis par les validations de la définition ;
 *  - texte lisible d'une valeur (rendu boutique, export CSV, aperçu).
 * La vérification d'appartenance (propriétaire et références dans la même boutique) est faite côté serveur
 * (`./server.ts`), jamais ici.
 */
import { z } from "zod";
import { safeLink } from "@/lib/storefront/safe-link";
import {
  DIMENSION_UNITS,
  KEY_RE,
  LIMITS,
  METAFIELD_OWNERS,
  METAFIELD_TYPE_META,
  METAFIELD_TYPES,
  NAMESPACE_RE,
  WEIGHT_UNITS,
  ownerCanBePublic,
  type MetafieldOwnerType,
  type MetafieldType,
  type MetafieldValidations,
  type MetafieldValue,
} from "./types";

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Check<T> => ({ ok: true, value });
const err = <T = never>(error: string): Check<T> => ({ ok: false, error });

/* ───────────── Expressions régulières « limitées » ───────────── */

/**
 * Expression du commerçant : 100 caractères, compilable, sans référence arrière, sans assertion (lookaround) ni
 * quantificateur imbriqué (`(a+)+`, `(\d*){2,}`), cause classique de retour arrière catastrophique (ReDoS).
 * Les valeurs testées sont en plus bornées à 255 caractères (texte sur une ligne).
 */
export function regexIssue(source: string): string | null {
  if (!source) return "Expression vide.";
  if (source.length > LIMITS.regexLength) return `Expression : ${LIMITS.regexLength} caractères maximum.`;
  if (/\\[1-9]|\\k</.test(source)) return "Expression : références arrière interdites.";
  if (/\(\?[=!<]/.test(source)) return "Expression : assertions (?=, ?!, ?<) interdites.";
  if (hasNestedQuantifier(source)) return "Expression : quantificateurs imbriqués interdits.";
  try {
    new RegExp(source, "u");
  } catch {
    return "Expression invalide.";
  }
  return null;
}

/**
 * Vrai si un groupe quantifié (`(…)+`, `(…)*`, `(…){n,}`, `(…)?` exclu) contient lui-même un quantificateur ou une
 * alternative (`(a+)+`, `(a|aa)+`, `((\d*))+`). Analyse linéaire : échappements et classes `[…]` ignorés.
 */
function hasNestedQuantifier(src: string): boolean {
  const stack: boolean[] = []; // par groupe ouvert : contient un quantificateur ou une alternative
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c === "(") {
      stack.push(false);
      continue;
    }
    if (c === ")") {
      const risky = stack.pop() ?? false;
      const next = src[i + 1];
      const quantified = next === "+" || next === "*" || next === "{";
      if (risky && quantified) return true;
      if (stack.length && (risky || quantified)) stack[stack.length - 1] = true;
      continue;
    }
    if ((c === "+" || c === "*" || c === "{" || c === "|") && stack.length) stack[stack.length - 1] = true;
  }
  return false;
}

/** Ancre l'expression pour tester la valeur entière (le commerçant écrit `[A-Z]{3}`, pas `^[A-Z]{3}$`). */
export function compileRegex(source: string): RegExp | null {
  if (regexIssue(source)) return null;
  return new RegExp(`^(?:${source})$`, "u");
}

/* ───────────── Définitions ───────────── */

const zNumberOpt = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v.replace(",", ".")) : v), z.number({ error: "Nombre attendu." }).finite().optional());

export const validationsInputSchema = z
  .object({
    min: zNumberOpt,
    max: zNumberOpt,
    regex: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().max(LIMITS.regexLength).optional()),
    choices: z.preprocess(
      (v) => (typeof v === "string" ? v.split(/\r?\n|,/) : v ?? undefined),
      z.array(z.string()).max(200).optional(),
    ),
  })
  .strict();

/**
 * Normalise les validations pour un type : clés non autorisées pour ce type retirées, bornes cohérentes,
 * choix nettoyés (uniques, non vides). `rating` : échelle par défaut 0..5.
 */
export function normalizeValidations(type: MetafieldType, raw: unknown): Check<MetafieldValidations> {
  const parsed = validationsInputSchema.safeParse(raw ?? {});
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Validations invalides.");
  const allowed = new Set(METAFIELD_TYPE_META[type].validations);
  const v = parsed.data;
  const out: MetafieldValidations = {};
  const range = METAFIELD_TYPE_META[type].range;
  for (const k of ["min", "max"] as const) {
    const n = v[k];
    if (n === undefined || !allowed.has(k)) continue;
    if (Math.abs(n) > LIMITS.number) return err("Borne trop grande.");
    if ((range === "length" || range === "items") && (!Number.isInteger(n) || n < 0)) return err("Longueur : nombre entier positif attendu.");
    out[k] = n;
  }
  if (type === "rating") {
    out.min ??= 0;
    out.max ??= 5;
  }
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) return err("Le minimum dépasse le maximum.");
  if (type === "rating" && (out.max! - out.min!) > 100) return err("Échelle de note : 100 points maximum.");
  if (v.regex && allowed.has("regex")) {
    const issue = regexIssue(v.regex);
    if (issue) return err(issue);
    out.regex = v.regex;
  }
  if (v.choices && allowed.has("choices")) {
    const choices = [...new Set(v.choices.map((c) => c.trim()).filter(Boolean))];
    if (choices.length > LIMITS.choices) return err(`${LIMITS.choices} choix maximum.`);
    if (choices.some((c) => c.length > LIMITS.choiceLength)) return err(`Choix : ${LIMITS.choiceLength} caractères maximum chacun.`);
    if (choices.length) out.choices = choices;
  }
  return ok(out);
}

/** Lecture tolérante de la colonne JSON `validations` (données en base). */
export function readValidations(type: MetafieldType, raw: unknown): MetafieldValidations {
  const r = normalizeValidations(type, raw && typeof raw === "object" && !Array.isArray(raw) ? pickValidationKeys(raw as Record<string, unknown>) : {});
  return r.ok ? r.value : type === "rating" ? { min: 0, max: 5 } : {};
}

function pickValidationKeys(o: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ["min", "max", "regex", "choices"]) if (k in o) out[k] = o[k];
  return out;
}

export const definitionInputSchema = z.object({
  ownerType: z.enum(METAFIELD_OWNERS, { error: "Type d'élément inconnu." }),
  namespace: z.string().trim().toLowerCase().regex(NAMESPACE_RE, "Espace de noms : minuscules, chiffres et _ (32 caractères maximum)."),
  key: z.string().trim().toLowerCase().regex(KEY_RE, "Clé : minuscules, chiffres et _ (64 caractères maximum)."),
  name: z.string().trim().min(1, "Nom requis.").max(LIMITS.name, `Nom : ${LIMITS.name} caractères maximum.`),
  description: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().trim().max(LIMITS.description, `Description : ${LIMITS.description} caractères maximum.`).optional()),
  type: z.enum(METAFIELD_TYPES, { error: "Type de champ inconnu." }),
  validations: z.unknown().optional(),
  storefrontVisible: z.boolean().default(true),
  pinned: z.boolean().default(true),
});
export type DefinitionInput = z.input<typeof definitionInputSchema>;

export const definitionUpdateSchema = definitionInputSchema.pick({ name: true, description: true, validations: true, storefrontVisible: true });

/** Un champ de client ou de commande n'est jamais visible en boutique, quel que soit le choix. */
export function effectiveStorefrontVisible(owner: MetafieldOwnerType, requested: boolean): boolean {
  return requested && ownerCanBePublic(owner);
}

/* ───────────── Valeurs ───────────── */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const HTML_TAG_RE = /<\/?[a-z!][^>]*>/i;
const MD_LINK_RE = /\]\(([^)\s]*)[^)]*\)/g;

/** Valeur « vide » = suppression de la valeur. */
export function isEmptyInput(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "") || (Array.isArray(raw) && raw.length === 0);
}

function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1900 && y <= 2200 && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function safeMarkdown(s: string): boolean {
  if (HTML_TAG_RE.test(s)) return false;
  for (const m of s.matchAll(MD_LINK_RE)) if (!safeLink(m[1])) return false;
  return true;
}

/** Image : https, ou média stocké (`/media/stores/…`). Data-URL refusées. Appartenance vérifiée côté serveur. */
function safeImageUrl(u: string): boolean {
  if (u.length > 2000) return false;
  if (u.startsWith("/media/stores/")) return /^\/media\/stores\/[a-z0-9]{8,40}\/\d{4}\/(0[1-9]|1[0-2])\/[a-f0-9]{64}\.(jpg|png|webp|avif|gif)$/.test(u);
  return /^https:\/\/[^\s<>"']+$/i.test(u);
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim().replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function checkRange(n: number, v: MetafieldValidations, what: string): string | null {
  if (v.min !== undefined && n < v.min) return `${what} : minimum ${v.min}.`;
  if (v.max !== undefined && n > v.max) return `${what} : maximum ${v.max}.`;
  return null;
}

function checkText(s: string, v: MetafieldValidations, hardMax: number): string | null {
  if (s.length > hardMax) return `${hardMax} caractères maximum.`;
  if (v.min !== undefined && s.length < v.min) return `${v.min} caractères minimum.`;
  if (v.max !== undefined && s.length > v.max) return `${v.max} caractères maximum.`;
  if (v.choices?.length && !v.choices.includes(s)) return "Valeur hors de la liste de choix.";
  if (v.regex) {
    const re = compileRegex(v.regex);
    if (re && !re.test(s)) return "Format non respecté.";
  }
  return null;
}

/**
 * Valide et normalise une valeur pour une définition. `raw` peut venir d'un formulaire (chaîne) ou d'un JSON
 * (API, MCP, CSV après conversion). Appeler `isEmptyInput` avant : une valeur vide signifie « supprimer ».
 */
export function validateMetafieldValue(def: { type: MetafieldType; validations?: MetafieldValidations | null }, raw: unknown, opts: { currency?: string } = {}): Check<MetafieldValue> {
  const v = def.validations ?? {};
  switch (def.type) {
    case "single_line_text": {
      if (typeof raw !== "string") return err("Texte attendu.");
      const s = raw.trim();
      if (/[\r\n]/.test(s)) return err("Une seule ligne attendue.");
      const issue = checkText(s, v, LIMITS.singleLine);
      return issue ? err(issue) : ok(s);
    }
    case "multi_line_text": {
      if (typeof raw !== "string") return err("Texte attendu.");
      const s = raw.replace(/\r\n?/g, "\n").trim();
      const issue = checkText(s, { min: v.min, max: v.max }, LIMITS.multiLine);
      return issue ? err(issue) : ok(s);
    }
    case "rich_text": {
      if (typeof raw !== "string") return err("Texte attendu.");
      const s = raw.replace(/\r\n?/g, "\n").trim();
      if (!safeMarkdown(s)) return err("HTML interdit ; liens https ou internes uniquement.");
      const issue = checkText(s, { max: v.max }, LIMITS.richText);
      return issue ? err(issue) : ok(s);
    }
    case "list_single_line_text": {
      const list = typeof raw === "string" ? raw.split(/\r?\n/) : raw;
      if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) return err("Liste de textes attendue.");
      const items = [...new Set((list as string[]).map((x) => x.trim()).filter(Boolean))];
      if (items.length > LIMITS.listItems) return err(`${LIMITS.listItems} éléments maximum.`);
      if (v.max !== undefined && items.length > v.max) return err(`${v.max} éléments maximum.`);
      if (items.some((x) => x.length > LIMITS.singleLine)) return err(`${LIMITS.singleLine} caractères maximum par élément.`);
      if (v.choices?.length && items.some((x) => !v.choices!.includes(x))) return err("Un élément est hors de la liste de choix.");
      return ok(items);
    }
    case "integer": {
      const n = toNumber(raw);
      if (n === null || !Number.isSafeInteger(n)) return err("Nombre entier attendu.");
      const issue = checkRange(n, v, "Valeur");
      return issue ? err(issue) : ok(n);
    }
    case "decimal": {
      const n = toNumber(raw);
      if (n === null || Math.abs(n) > LIMITS.number) return err("Nombre attendu.");
      const issue = checkRange(n, v, "Valeur");
      return issue ? err(issue) : ok(Math.round(n * 1e6) / 1e6);
    }
    case "rating": {
      const n = toNumber(raw);
      if (n === null) return err("Note attendue.");
      const scale = { min: v.min ?? 0, max: v.max ?? 5 };
      const issue = checkRange(n, scale, "Note");
      return issue ? err(issue) : ok(Math.round(n * 10) / 10);
    }
    case "boolean": {
      if (typeof raw === "boolean") return ok(raw);
      if (typeof raw === "string") {
        const s = raw.trim().toLowerCase();
        if (["true", "oui", "1", "on", "yes"].includes(s)) return ok(true);
        if (["false", "non", "0", "off", "no"].includes(s)) return ok(false);
      }
      return err("Oui ou non attendu.");
    }
    case "date": {
      if (typeof raw !== "string" || !isValidDate(raw.trim())) return err("Date attendue (AAAA-MM-JJ).");
      return ok(raw.trim());
    }
    case "color": {
      if (typeof raw !== "string" || !HEX_RE.test(raw.trim())) return err("Couleur attendue au format #RRGGBB.");
      return ok(raw.trim().toLowerCase());
    }
    case "url": {
      if (typeof raw !== "string") return err("Lien attendu.");
      const s = raw.trim();
      if (s.length > 2000 || !(/^https:\/\/[^\s<>"']+$/i.test(s) || /^\/(?!\/)[A-Za-z0-9\-._~/%?=&#+]*$/.test(s))) return err("Lien : adresse https ou chemin de la boutique (/catalogue).");
      return ok(s);
    }
    case "image": {
      const o = typeof raw === "string" ? { url: raw } : raw;
      if (!o || typeof o !== "object" || Array.isArray(o)) return err("Image attendue.");
      const { url, alt } = o as { url?: unknown; alt?: unknown };
      if (typeof url !== "string" || !safeImageUrl(url.trim())) return err("Image : fichier téléversé ou adresse https.");
      if (alt !== undefined && typeof alt !== "string") return err("Texte alternatif invalide.");
      const a = typeof alt === "string" ? alt.trim().slice(0, 200) : "";
      return ok(a ? { url: url.trim(), alt: a } : { url: url.trim() });
    }
    case "product_reference":
    case "collection_reference": {
      if (typeof raw !== "string" || !ID_RE.test(raw.trim())) return err("Identifiant invalide.");
      return ok(raw.trim());
    }
    case "dimension":
    case "weight": {
      const units: readonly string[] = def.type === "dimension" ? DIMENSION_UNITS : WEIGHT_UNITS;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return err("Valeur et unité attendues.");
      const { value, unit } = raw as { value?: unknown; unit?: unknown };
      const n = toNumber(value);
      if (n === null || n < 0 || n > LIMITS.number) return err("Valeur positive attendue.");
      if (typeof unit !== "string" || !units.includes(unit)) return err(`Unité attendue : ${units.join(", ")}.`);
      const issue = checkRange(n, v, "Valeur");
      return issue ? err(issue) : ok({ value: Math.round(n * 1e4) / 1e4, unit });
    }
    case "money": {
      const o = typeof raw === "number" || typeof raw === "string" ? { amount: raw } : raw;
      if (!o || typeof o !== "object" || Array.isArray(o)) return err("Montant attendu.");
      const { amount, currency } = o as { amount?: unknown; currency?: unknown };
      const n = toNumber(amount);
      if (n === null || !Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000_000) return err("Montant entier positif attendu.");
      const cur = typeof currency === "string" && currency ? currency.toUpperCase() : opts.currency;
      if (!cur || !/^[A-Z]{3}$/.test(cur)) return err("Devise invalide.");
      if (opts.currency && cur !== opts.currency) return err(`Montant attendu dans la devise de la boutique (${opts.currency}).`);
      const issue = checkRange(n, v, "Montant");
      return issue ? err(issue) : ok({ amount: n, currency: cur });
    }
  }
}

/** Identifiant référencé par une valeur (à vérifier dans la boutique), ou null. */
export function referencedId(type: MetafieldType, value: unknown): { kind: "product" | "collection"; id: string } | null {
  if (typeof value !== "string") return null;
  if (type === "product_reference") return { kind: "product", id: value };
  if (type === "collection_reference") return { kind: "collection", id: value };
  return null;
}

/* ───────────── Texte lisible ───────────── */

const UNIT_LABEL: Record<string, string> = { mm: "mm", cm: "cm", m: "m", in: "po", ft: "pi", g: "g", kg: "kg", lb: "lb", oz: "oz" };

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(n);
}

/**
 * Texte d'une valeur (réglage `text` d'une source dynamique, tableau de caractéristiques, CSV en mode lisible).
 * `refTitle` : titre du produit / de la collection référencé, résolu par l'appelant.
 */
export function metafieldText(type: MetafieldType, value: unknown, opts: { formatMoney?: (amount: number, currency: string) => string; refTitle?: string | null; validations?: MetafieldValidations } = {}): string {
  if (value === null || value === undefined) return "";
  switch (type) {
    case "boolean":
      return value === true ? "Oui" : value === false ? "Non" : "";
    case "date": {
      if (typeof value !== "string" || !isValidDate(value)) return "";
      const [y, m, d] = value.split("-").map(Number);
      return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
    }
    case "integer":
    case "decimal":
      return typeof value === "number" ? fmtNumber(value) : "";
    case "rating":
      return typeof value === "number" ? `${fmtNumber(value)} / ${fmtNumber(opts.validations?.max ?? 5)}` : "";
    case "list_single_line_text":
      return Array.isArray(value) ? value.filter((x) => typeof x === "string").join(", ") : "";
    case "dimension":
    case "weight": {
      const o = value as { value?: unknown; unit?: unknown };
      return typeof o?.value === "number" && typeof o.unit === "string" ? `${fmtNumber(o.value)} ${UNIT_LABEL[o.unit] ?? o.unit}` : "";
    }
    case "money": {
      const o = value as { amount?: unknown; currency?: unknown };
      if (typeof o?.amount !== "number" || typeof o.currency !== "string") return "";
      return opts.formatMoney ? opts.formatMoney(o.amount, o.currency) : `${o.amount} ${o.currency}`;
    }
    case "image": {
      const o = value as { url?: unknown; alt?: unknown };
      return typeof o?.alt === "string" ? o.alt : "";
    }
    case "product_reference":
    case "collection_reference":
      return opts.refTitle ?? "";
    default:
      return typeof value === "string" ? value : "";
  }
}

/** Forme brute d'une valeur pour un champ de saisie texte (CSV, champ simple). Inverse approximatif de la saisie. */
export function metafieldRawText(type: MetafieldType, value: unknown): string {
  if (value === null || value === undefined) return "";
  switch (type) {
    case "boolean":
      return value === true ? "true" : value === false ? "false" : "";
    case "list_single_line_text":
      return Array.isArray(value) ? value.join("\n") : "";
    case "image":
      return typeof (value as { url?: unknown }).url === "string" ? (value as { url: string }).url : "";
    case "dimension":
    case "weight": {
      const o = value as { value?: unknown; unit?: unknown };
      return typeof o?.value === "number" ? `${o.value} ${String(o.unit ?? "")}`.trim() : "";
    }
    case "money": {
      const o = value as { amount?: unknown };
      return typeof o?.amount === "number" ? String(o.amount) : "";
    }
    default:
      return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }
}

/** Analyse « 12,5 cm » / « 2 kg » (CSV, saisie libre). */
export function parseMeasureText(type: "dimension" | "weight", s: string): { value: string; unit: string } | null {
  const m = /^\s*([0-9]+(?:[.,][0-9]+)?)\s*([a-zA-Z]{1,3})\s*$/.exec(s);
  return m ? { value: m[1], unit: m[2].toLowerCase() } : null;
}

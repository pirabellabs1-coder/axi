import { extractJson, stripForbidden, tidy } from "@/lib/ai/parse";
import { isSafeMarkdown } from "@/lib/theme-engine/validate";
import { MAX_VALUE_LENGTH, type SourceField } from "./resources";

/**
 * Traduction par l'IA (lot 2 §1.1) — parties PURES et testables : coût en crédits, découpage en lots,
 * construction du message et garde-fous de la réponse. L'appel réseau et les crédits sont dans `actions.ts`.
 *
 * Garde-fous (hérités de `src/lib/ai/parse.ts`) :
 *  - aucun prix, stock, délai, garantie ni promotion ajouté : une phrase interdite ABSENTE du texte source
 *    fait rejeter le champ (le texte source, lui, est conservé) ;
 *  - Markdown préservé et revalidé (`isSafeMarkdown`) : jamais de HTML ;
 *  - glossaire de la boutique : un terme à ne pas traduire doit rester présent à l'identique ;
 *  - le contenu à traduire est placé dans des balises de données, jamais mélangé aux instructions.
 */

/** 1 crédit IA par tranche de 1 500 caractères source (minimum 1). */
export const CHARS_PER_CREDIT = 1_500;
/** Un lot d'appel ne dépasse jamais 20 000 caractères source. */
export const MAX_BATCH_CHARS = 20_000;

export function translationCost(chars: number): number {
  return Math.max(1, Math.ceil(Math.max(0, chars) / CHARS_PER_CREDIT));
}

export type TranslationItem = {
  /** Clé opaque envoyée au modèle et renvoyée par lui (`{resourceId}#{field}`). */
  key: string;
  field: SourceField;
};

export function countChars(items: TranslationItem[]): number {
  return items.reduce((n, i) => n + i.field.value.length, 0);
}

/**
 * Découpe en lots de 20 000 caractères maximum. Un champ plus long que la limite part seul dans son lot :
 * il sera refusé par la validation plutôt que tronqué silencieusement.
 */
export function batchItems(items: TranslationItem[], maxChars = MAX_BATCH_CHARS): TranslationItem[][] {
  const batches: TranslationItem[][] = [];
  let current: TranslationItem[] = [];
  let size = 0;
  for (const item of items) {
    const len = item.field.value.length;
    if (current.length && size + len > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += len;
  }
  if (current.length) batches.push(current);
  return batches;
}

/* ───────────────────────── Message ───────────────────────── */

export const TRANSLATE_SYSTEM = [
  "Tu es traducteur professionnel pour des boutiques en ligne d'Afrique de l'Ouest.",
  "Tu traduis UNIQUEMENT le texte fourni, sans rien ajouter, retirer ni commenter.",
  "Interdits absolus : inventer un prix, une remise, un délai, un stock, une garantie ou une promesse commerciale ;",
  "ajouter des emoji ; ajouter du HTML. Conserve la mise en forme Markdown, les sauts de ligne et la ponctuation.",
  "Conserve tel quel : noms propres, marques, références, unités, nombres, URL et termes du glossaire.",
  "Réponds STRICTEMENT par un objet JSON { \"clé\": \"traduction\" } reprenant exactement les clés fournies.",
].join(" ");

export const TRANSLATE_JSON_SCHEMA = { type: "object", additionalProperties: { type: "string" } };

export function buildTranslatePrompt(p: { items: TranslationItem[]; targetLanguage: string; sourceLanguage: string; storeName: string; glossary: string[] }): string {
  const lines = [
    `Boutique : ${p.storeName}.`,
    `Traduis du ${p.sourceLanguage} vers le ${p.targetLanguage}.`,
    p.glossary.length ? `Termes à NE PAS traduire (à reproduire à l'identique) : ${p.glossary.slice(0, 50).join(", ")}.` : "",
    "Chaque entrée ci-dessous est un texte à traduire, identifié par sa clé. Renvoie un JSON avec les mêmes clés.",
    "<donnees>",
    ...p.items.map((i) => `<texte cle="${i.key}" nature="${i.field.kind}">\n${i.field.value}\n</texte>`),
    "</donnees>",
  ];
  return lines.filter(Boolean).join("\n");
}

/* ───────────────────────── Garde-fous de la réponse ───────────────────────── */

export type TranslateOutcome = {
  /** Traductions acceptées, par clé. */
  accepted: Record<string, string>;
  /** Champs refusés et motif (affiché au commerçant). */
  rejected: { key: string; reason: string }[];
};

const REASONS = {
  missing: "aucune traduction renvoyée",
  empty: "traduction vide",
  tooLong: "traduction trop longue",
  html: "balises HTML ou lien non autorisé",
  invented: "information non vérifiable ajoutée (prix, stock, délai, garantie ou promotion)",
  glossary: "terme du glossaire modifié",
} as const;

/** Un terme du glossaire présent dans la source doit rester présent, à l'identique, dans la traduction. */
function glossaryKept(source: string, output: string, glossary: string[]): boolean {
  for (const term of glossary) {
    const t = term.trim();
    if (!t) continue;
    if (source.toLowerCase().includes(t.toLowerCase()) && !output.toLowerCase().includes(t.toLowerCase())) return false;
  }
  return true;
}

/**
 * Valide la réponse du modèle champ par champ. Un champ refusé n'écrase JAMAIS la source : il reste
 * non traduit (repli sur la langue principale).
 */
export function parseTranslateResponse(text: string, items: TranslationItem[], opts: { glossary?: string[] } = {}): { ok: true; data: TranslateOutcome } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch {
    return { ok: false, error: "Réponse de l'assistant illisible. Réessayez." };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, error: "Réponse de l'assistant inattendue. Réessayez." };
  const raw = json as Record<string, unknown>;
  const glossary = opts.glossary ?? [];
  const out: TranslateOutcome = { accepted: {}, rejected: [] };

  for (const item of items) {
    const value = raw[item.key];
    if (typeof value !== "string") {
      out.rejected.push({ key: item.key, reason: REASONS.missing });
      continue;
    }
    // `tidy` applique la typographie maison (pas de tiret cadratin, pas d'emoji) sans toucher au sens.
    const cleaned = item.field.kind === "markdown" ? value.trim() : tidy(value);
    if (!cleaned) {
      out.rejected.push({ key: item.key, reason: REASONS.empty });
      continue;
    }
    if (cleaned.length > MAX_VALUE_LENGTH[item.field.kind]) {
      out.rejected.push({ key: item.key, reason: REASONS.tooLong });
      continue;
    }
    if (!isSafeMarkdown(cleaned)) {
      out.rejected.push({ key: item.key, reason: REASONS.html });
      continue;
    }
    // Anti-invention : une phrase interdite dans la traduction est tolérée UNIQUEMENT si le texte source en
    // contenait déjà une (le commerçant a écrit son prix lui-même, la traduction peut le reprendre).
    const sourceHasClaims = stripForbidden(item.field.value).removed.length > 0;
    if (!sourceHasClaims && stripForbidden(cleaned).removed.length > 0) {
      out.rejected.push({ key: item.key, reason: REASONS.invented });
      continue;
    }
    if (!glossaryKept(item.field.value, cleaned, glossary)) {
      out.rejected.push({ key: item.key, reason: REASONS.glossary });
      continue;
    }
    out.accepted[item.key] = cleaned;
  }
  return { ok: true, data: out };
}

/* ───────────────────────── Glossaire de la boutique ───────────────────────── */

/** `Store.i18nConfig.glossary` : `[{ term }]` — termes à ne pas traduire (marques, références). */
export function parseGlossary(raw: unknown): string[] {
  const list = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { glossary?: unknown }).glossary : undefined;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list.slice(0, 100)) {
    const term = typeof entry === "string" ? entry : entry && typeof entry === "object" ? (entry as { term?: unknown }).term : null;
    if (typeof term === "string" && term.trim()) out.push(term.trim().slice(0, 60));
  }
  return [...new Set(out)];
}

/** Clé opaque d'un champ dans l'échange avec le modèle (`{resourceId}#{field}`). */
export function itemKey(resourceId: string, field: string): string {
  return `${resourceId}#${field}`;
}

export function parseItemKey(key: string): { resourceId: string; field: string } | null {
  const at = key.indexOf("#");
  if (at <= 0 || at === key.length - 1) return null;
  return { resourceId: key.slice(0, at), field: key.slice(at + 1) };
}

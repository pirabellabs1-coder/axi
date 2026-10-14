import { z } from "zod";

/**
 * Analyse et garde-fous de la réponse de l'assistant de rédaction (fonctions pures, testées).
 * Le modèle doit renvoyer un JSON strict ; on tolère un bloc ```json``` ou du texte autour.
 * Garde-fous : aucune phrase qui annonce un prix, un stock, un délai, une garantie ou une promotion
 * n'est conservée (ces informations viennent du catalogue, jamais de l'IA).
 */

export const AI_MODEL = "claude-haiku-5-5";

export const describeOutputSchema = z.object({
  description: z.string().trim().min(40).max(1200),
  description_en: z.string().trim().max(1200).nullable().optional(),
  highlights: z.array(z.string().trim().min(2).max(80)).max(4).default([]),
});

export type DescribeOutput = { description: string; descriptionEn: string | null; highlights: string[]; removed: string[] };

/** Extrait le premier objet JSON d'un texte (bloc de code, texte autour). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Réponse sans JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

// Montants, devises, stock, délais, garanties, promotions : interdits dans un texte généré.
const FORBIDDEN: RegExp[] = [
  /\d[\d\s.,]*\s*(?:f\s?cfa|fcfa|cfa|xof|xaf|€|eur(?:os?)?\b|\$|usd|dollars?|francs?)/i,
  /(?:€|\$)\s*\d/,
  /\bprix\b|\btarif\b|\bco[uû]te?\b|\bprice\b|\bcosts?\b/i,
  /\ben stock\b|\bstock\b|\bin stock\b|\bquantit[ée]s? limit[ée]es?\b|\blimited (?:stock|quantity)\b|\bderniers? exemplaires?\b/i,
  /\blivraison (?:gratuite|offerte|express|en \d+|sous \d+)|\bfree (?:delivery|shipping)\b|\b\d+\s*(?:h|heures?|jours?|days?|hours?)\b/i,
  /\bgaranti(?:e|t)?\b|\bwarrant(?:y|ied)\b|\bguarantee/i,
  /\bpromo(?:tion)?s?\b|\bsoldes?\b|(?:^|\s)-\d+\s?%|\d+\s?%\s*(?:de r[ée]duction|de remise|off\b)|\bremise\b|\br[ée]duction\b|\bdiscount\b|\bon sale\b/i,
];

function sentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]*(?:\s+|$)|\n+/g) ?? [text];
}

/** Retire les phrases qui contiennent une affirmation interdite. Renvoie le texte nettoyé et les phrases retirées. */
export function stripForbidden(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = sentences(text).filter((s) => {
    if (FORBIDDEN.some((re) => re.test(s))) {
      if (s.trim()) removed.push(s.trim());
      return false;
    }
    return true;
  });
  return { text: kept.join("").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/** Typographie maison : pas de tiret cadratin ni demi-cadratin, pas d'emoji. */
export function tidy(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/ ,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function parseDescribeResponse(text: string, opts: { translate: boolean }): { ok: true; data: DescribeOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch {
    return { ok: false, error: "Réponse de l'assistant illisible. Réessayez." };
  }
  const parsed = describeOutputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "Réponse de l'assistant incomplète. Réessayez." };
  const fr = stripForbidden(tidy(parsed.data.description));
  const en = opts.translate && parsed.data.description_en ? stripForbidden(tidy(parsed.data.description_en)) : null;
  const highlights = parsed.data.highlights.map(tidy).filter((h) => !FORBIDDEN.some((re) => re.test(h)));
  if (fr.text.length < 30) return { ok: false, error: "Le texte proposé contenait surtout des informations non vérifiables (prix, stock, délais). Ajoutez des mots-clés sur le produit et réessayez." };
  return { ok: true, data: { description: fr.text, descriptionEn: en && en.text.length >= 30 ? en.text : null, highlights, removed: [...fr.removed, ...(en?.removed ?? [])] } };
}

/** Crédits IA consommés par génération. */
export function aiCost(translate: boolean): number {
  return translate ? 2 : 1;
}

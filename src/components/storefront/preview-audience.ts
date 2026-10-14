import { AUDIENCE_CUSTOMER_SEGMENTS, AUDIENCE_DEVICES, AUDIENCE_SOURCES } from "@/lib/theme-engine/types";
import { defaultAudience, type AudienceContext } from "@/lib/theme-engine/audience";
import { parsePreviewOptions, PREVIEW_MESSAGES } from "@/lib/theme-engine/preview-messages";

/**
 * Lot 4 §12 (T3) : audience simulée dans l'aperçu de l'éditeur.
 * Message éditeur → aperçu : `{ type: "axi:preview-audience", audience: { city?, customer?, source?, device?, locale? } | null }`
 * (`null` = visiteur par défaut). Lecture défensive : toute valeur inconnue est ignorée. L'horloge reste celle du rendu.
 * Option d'aperçu : `{ type: "axi:preview-options", reduceMotion: true }` coupe les animations (« Réduire les animations »).
 */
export const PREVIEW_AUDIENCE_MESSAGE = PREVIEW_MESSAGES.audience;

const pickList = <T extends string>(v: unknown, list: readonly T[]): T[] => (Array.isArray(v) ? v.filter((x): x is T => typeof x === "string" && (list as readonly string[]).includes(x)) : typeof v === "string" && (list as readonly string[]).includes(v) ? [v as T] : []);
const pickOne = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);

/** Audience simulée à partir du message, ou `undefined` si le message n'en est pas un. */
export function parsePreviewAudience(data: unknown, base: { now: Date; timeZone?: string }): AudienceContext | undefined {
  if (!data || typeof data !== "object") return undefined;
  const m = data as { type?: unknown; audience?: unknown };
  if (m.type !== PREVIEW_AUDIENCE_MESSAGE) return undefined;
  const fallback = defaultAudience(base);
  if (!m.audience || typeof m.audience !== "object" || Array.isArray(m.audience)) return fallback;
  const a = m.audience as Record<string, unknown>;
  const customer = pickList(a.customer, AUDIENCE_CUSTOMER_SEGMENTS);
  const city = typeof a.city === "string" && a.city.trim() && a.city.length <= 80 ? a.city.trim() : null;
  const locale = typeof a.locale === "string" && /^[a-z]{2,3}$/.test(a.locale) ? a.locale : null;
  return {
    ...fallback,
    city,
    customer: customer.length ? customer : ["anonymous"],
    source: pickOne(a.source, AUDIENCE_SOURCES) ?? "direct",
    device: pickOne(a.device, AUDIENCE_DEVICES),
    locale,
  };
}

/** Option « Réduire les animations » d'un `axi:preview-options` ; `undefined` si absente. */
export function parseReduceMotion(data: unknown): boolean | undefined {
  return parsePreviewOptions(data)?.reduceMotion;
}

/**
 * Document envoyé à l'aperçu (module pur, testé) : la vue de la cible d'édition, transformée pour l'aperçu seulement
 * (jamais enregistrée) :
 *  - « Réduire les animations » : `motion.preset = none`, animations de section à `none` ;
 *  - audience simulée : chaque section dont la visibilité exclut l'audience est rendue masquée (`disabled`), puis
 *    `visibility` est retirée pour que l'aperçu n'évalue pas une seconde fois avec la véritable audience du marchand.
 * Le message `axi:preview-audience` (`PREVIEW_MESSAGES.audience`) est aussi envoyé ; voir docs/CONSTRUCTEUR-BOUTIQUE.md.
 */
import { customerSegments, evaluateVisibility, type AudienceContext } from "@/lib/theme-engine/audience";
import { PREVIEW_MESSAGES } from "@/lib/theme-engine/preview-messages";
import {
  AUDIENCE_CUSTOMER_SEGMENTS,
  AUDIENCE_SOURCES,
  type SectionInstance,
  type SectionVisibility,
  type Template,
  type ThemeDocument,
} from "@/lib/theme-engine/types";

export type SimulatedAudience = {
  customer: (typeof AUDIENCE_CUSTOMER_SEGMENTS)[number];
  source: (typeof AUDIENCE_SOURCES)[number];
  city: string;
  device: "mobile" | "desktop";
  locale: string;
  /** Jour (0 = dimanche) et heure HH:MM simulés, fuseau de la boutique. */
  day: number;
  time: string;
};

export const PREVIEW_AUDIENCE_MESSAGE = PREVIEW_MESSAGES.audience;

export const CUSTOMER_LABELS: Record<SimulatedAudience["customer"], string> = {
  anonymous: "Visiteur non connecté",
  new: "Nouveau client (aucune commande)",
  returning: "Client ayant déjà commandé",
  loyal: "Client fidèle (3 commandes ou plus)",
  has_points: "Client avec des points de fidélité",
};

export const SOURCE_LABELS: Record<SimulatedAudience["source"], string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  google: "Google",
  direct: "Accès direct",
  campaign: "Campagne",
};

export const DAY_LABELS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"] as const;

/** Base fixe : dimanche 4 janvier 2026 (UTC) ; le jour et l'heure simulés sont évalués en UTC (fuseau neutre). */
const SUNDAY_UTC = Date.UTC(2026, 0, 4);

/** Audience simulée → contexte du moteur (`evaluateVisibility`, audience.ts). */
export function toAudienceContext(a: SimulatedAudience): AudienceContext {
  const [h, m] = a.time.split(":").map(Number);
  const loggedIn = a.customer !== "anonymous";
  const orderCount = a.customer === "loyal" ? 3 : a.customer === "returning" || a.customer === "has_points" ? 1 : 0;
  return {
    city: a.city.trim() || null,
    customer: customerSegments({ loggedIn, orderCount, points: a.customer === "has_points" ? 10 : 0 }),
    source: a.source,
    locale: a.locale,
    device: a.device,
    now: new Date(SUNDAY_UTC + a.day * 86_400_000 + ((h || 0) * 60 + (m || 0)) * 60_000),
    timeZone: "UTC",
  };
}

/** Section visible pour l'audience simulée ? (aucune règle = visible). */
export function simulateVisibility(v: SectionVisibility | undefined, a: SimulatedAudience): boolean {
  return evaluateVisibility(v, toAudienceContext(a));
}

function mapTemplate(t: Template, fn: (s: SectionInstance) => SectionInstance): Template {
  return { ...t, sections: Object.fromEntries(Object.entries(t.sections).map(([k, s]) => [k, fn(s)])) };
}

export function previewDocument(view: ThemeDocument, opts: { reduceMotion: boolean; audience: SimulatedAudience | null }): ThemeDocument {
  const evaluate = simulateVisibility;
  const touchesSections = opts.reduceMotion || Object.values(view.templates).some((t) => Object.values(t.sections).some((s) => s.visibility));
  if (!touchesSections) return view;
  const fix = (s: SectionInstance): SectionInstance => {
    if (!opts.reduceMotion && !s.visibility) return s;
    const next = { ...s };
    if (opts.reduceMotion) next.animation = "none";
    if (s.visibility) {
      if (opts.audience && !evaluate(s.visibility, opts.audience)) next.disabled = true;
      delete next.visibility;
    }
    return next;
  };
  const templates = Object.fromEntries(Object.entries(view.templates).map(([k, t]) => [k, mapTemplate(t, fix)])) as ThemeDocument["templates"];
  const settings = opts.reduceMotion ? { ...view.settings, motion: { preset: "none" as const, reveal: false, parallax: false, hoverZoom: false } } : view.settings;
  return { ...view, settings, templates };
}

/** Message d'aperçu `axi:preview-audience` (null = règles ignorées, toutes les sections visibles). */
export function previewAudienceMessage(a: SimulatedAudience | null) {
  return { type: PREVIEW_AUDIENCE_MESSAGE, audience: a };
}

export function initialAudience(device: "mobile" | "desktop", now = new Date()): SimulatedAudience {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return { customer: "anonymous", source: "direct", city: "", device, locale: "fr", day: now.getDay(), time: `${hh}:${mm}` };
}

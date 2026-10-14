/**
 * Lot 4 §12 : personnalisation par audience — évaluation PURE (aucun accès base, aucune horloge implicite).
 *
 * `evaluateVisibility(visibility, ctx)` : la section est-elle visible pour ce visiteur ?
 *  - pas de visibilité (ou aucune règle) → visible ;
 *  - règles combinées par `match` (« all » / « any ») ; si elles correspondent : `mode` show → visible, hide → masquée ;
 *    si elles ne correspondent pas : l'inverse ;
 *  - signal inconnu (ville absente, appareil inconnu…) → la règle ne correspond pas ;
 *  - robots d'indexation (`ctx.isBot`) → AUDIENCE PAR DÉFAUT (anonyme, accès direct, sans ville ni langue ni appareil)
 *    pour éviter le « cloaking ». L'horaire (`schedule`) reste évalué : il ne dépend pas du visiteur.
 * Les signaux sont collectés côté serveur (cookies `axi_city`, `axi_src`, session acheteur, en-têtes) par le rendu ;
 * aucune donnée personnelle n'est conservée ici. Jamais utilisé pour masquer ou modifier un prix.
 */
import {
  AUDIENCE_CUSTOMER_SEGMENTS,
  AUDIENCE_DEVICES,
  AUDIENCE_SOURCES,
  type AudienceRule,
  type SectionInstance,
  type SectionVisibility,
  type Template,
} from "./types";

export type CustomerSegment = (typeof AUDIENCE_CUSTOMER_SEGMENTS)[number];
export type AudienceSource = (typeof AUDIENCE_SOURCES)[number];
export type AudienceDevice = (typeof AUDIENCE_DEVICES)[number];

export type AudienceContext = {
  /** Ville du visiteur (adresse par défaut, cookie `axi_city`, en-tête géographique). */
  city?: string | null;
  /** Segments (voir `customerSegments`) ; vide ou absent = `["anonymous"]`. */
  customer?: readonly CustomerSegment[];
  source?: AudienceSource | null;
  /** Code de langue `fr`, `en`… */
  locale?: string | null;
  device?: AudienceDevice | null;
  /** Instant d'évaluation (obligatoire pour les règles d'horaire ; sans lui, elles ne correspondent pas). */
  now?: Date;
  /** Fuseau IANA de la boutique (défaut Africa/Porto-Novo). */
  timeZone?: string;
  /** Robot d'indexation : audience par défaut. */
  isBot?: boolean;
};

export const DEFAULT_TIME_ZONE = "Africa/Porto-Novo";

/** Audience par défaut (robots, aperçu « Visiteur par défaut »). */
export function defaultAudience(base: Pick<AudienceContext, "now" | "timeZone"> = {}): AudienceContext {
  return { city: null, customer: ["anonymous"], source: "direct", locale: null, device: null, now: base.now, timeZone: base.timeZone, isBot: false };
}

/** Comparaison de villes insensible à la casse, aux accents et aux espaces superflus. */
export function normalizeCity(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s'’-]+/g, " ").trim();
}

function zonedParts(now: Date, timeZone: string): { day: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    const minutes = Number(get("hour")) * 60 + Number(get("minute"));
    return day < 0 || !Number.isFinite(minutes) ? null : { day, minutes };
  } catch {
    return null; // fuseau inconnu
  }
}

function hhmm(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Horaire : jours (0 = dimanche) et plage [from, to[ dans le fuseau de la boutique.
 * `from > to` = plage qui passe minuit (le jour coché est celui du début) ; `from === to` = toute la journée.
 */
export function matchesSchedule(rule: Extract<AudienceRule, { type: "schedule" }>, now: Date | undefined, timeZone = DEFAULT_TIME_ZONE): boolean {
  if (!now) return false;
  const z = zonedParts(now, timeZone);
  if (!z) return false;
  const from = hhmm(rule.from);
  const to = hhmm(rule.to);
  if (from === to) return rule.days.includes(z.day);
  if (from < to) return rule.days.includes(z.day) && z.minutes >= from && z.minutes < to;
  const prev = (z.day + 6) % 7;
  return (rule.days.includes(z.day) && z.minutes >= from) || (rule.days.includes(prev) && z.minutes < to);
}

/** Une règle correspond-elle au contexte ? */
export function evaluateRule(rule: AudienceRule, ctx: AudienceContext): boolean {
  switch (rule.type) {
    case "city": {
      if (!ctx.city) return false;
      const c = normalizeCity(ctx.city);
      return rule.values.some((v) => normalizeCity(v) === c);
    }
    case "customer": {
      const segs = ctx.customer?.length ? ctx.customer : (["anonymous"] as const);
      return rule.values.some((v) => segs.includes(v));
    }
    case "source":
      return !!ctx.source && rule.values.includes(ctx.source);
    case "locale":
      return !!ctx.locale && rule.values.includes(ctx.locale.toLowerCase().slice(0, 3).split(/[-_]/)[0]);
    case "device":
      return !!ctx.device && rule.values.includes(ctx.device);
    case "schedule":
      return matchesSchedule(rule, ctx.now, ctx.timeZone ?? DEFAULT_TIME_ZONE);
    default:
      return false;
  }
}

/** La section est-elle visible pour ce contexte ? (voir l'en-tête du module) */
export function evaluateVisibility(visibility: SectionVisibility | null | undefined, ctx: AudienceContext): boolean {
  if (!visibility || !Array.isArray(visibility.rules) || visibility.rules.length === 0) return true;
  const c = ctx.isBot ? defaultAudience({ now: ctx.now, timeZone: ctx.timeZone }) : ctx;
  const matched = visibility.match === "any" ? visibility.rules.some((r) => evaluateRule(r, c)) : visibility.rules.every((r) => evaluateRule(r, c));
  return visibility.mode === "hide" ? !matched : matched;
}

/** Sections visibles d'un modèle, dans l'ordre (masquées `disabled` exclues, audience évaluée). */
export function visibleSectionIds(template: Template, ctx: AudienceContext): string[] {
  return template.order.filter((id) => {
    const s: SectionInstance | undefined = template.sections[id];
    return !!s && !s.disabled && evaluateVisibility(s.visibility, ctx);
  });
}

/* ───────────── Signaux (fonctions pures utilisables par le rendu et le proxy) ───────────── */

const BOT_RE = /bot\/|bot;|\+https?:\/\/|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|pinterest|vkshare|w3c_validator|google-inspectiontool|mediapartners|apis-google|^WhatsApp\//i;

/** Robot d'indexation ou d'aperçu de lien (dont le robot d'aperçu WhatsApp, `WhatsApp/x.y`) → audience par défaut. Agent vide = robot. */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  return !ua || BOT_RE.test(ua);
}

/** Appareil : `Sec-CH-UA-Mobile` (`?1` / `?0`) prioritaire, sinon agent utilisateur ; `null` si inconnu. */
export function deviceFromHints(input: { chUaMobile?: string | null; userAgent?: string | null }): AudienceDevice | null {
  const ch = input.chUaMobile?.trim();
  if (ch === "?1") return "mobile";
  if (ch === "?0") return "desktop";
  const ua = input.userAgent ?? "";
  if (!ua) return null;
  return /Mobi|Android|iPhone|iPod|Opera Mini|IEMobile|KaiOS/i.test(ua) ? "mobile" : "desktop";
}

/** Segments client : anonyme, nouveau (0 commande), récurrent (≥ 1), fidèle (≥ 3), avec points de fidélité. */
export function customerSegments(input: { loggedIn: boolean; orderCount?: number; points?: number }): CustomerSegment[] {
  if (!input.loggedIn) return ["anonymous"];
  const n = Math.max(0, Math.trunc(input.orderCount ?? 0));
  const out: CustomerSegment[] = [n === 0 ? "new" : "returning"];
  if (n >= 3) out.push("loyal");
  if ((input.points ?? 0) > 0) out.push("has_points");
  return out;
}

const SOURCE_HOSTS: [RegExp, AudienceSource][] = [
  [/(^|\.)(whatsapp\.com|wa\.me)$/i, "whatsapp"],
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)tiktok\.com$/i, "tiktok"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/i, "facebook"],
  [/(^|\.)google\.[a-z.]+$/i, "google"],
];

/**
 * Source de premier contact (cookie `axi_src`) : `utm_source` / `ref` reconnus, sinon hôte du référent,
 * sinon `campaign` si un `utm_campaign` est présent, sinon `direct`.
 */
export function sourceFromSignals(input: { utmSource?: string | null; ref?: string | null; utmCampaign?: string | null; referrer?: string | null; selfHost?: string | null }): AudienceSource {
  const tag = (input.utmSource || input.ref || "").trim().toLowerCase();
  if (tag) {
    if ((AUDIENCE_SOURCES as readonly string[]).includes(tag)) return tag as AudienceSource;
    if (tag === "wa" || tag === "wa.me") return "whatsapp";
    if (tag === "ig") return "instagram";
    if (tag === "fb" || tag === "meta") return "facebook";
    if (tag === "tt") return "tiktok";
    return "campaign";
  }
  if (input.referrer) {
    try {
      const host = new URL(input.referrer).hostname;
      if (!input.selfHost || host !== input.selfHost) for (const [re, s] of SOURCE_HOSTS) if (re.test(host)) return s;
    } catch {
      /* référent illisible : ignoré */
    }
  }
  return input.utmCampaign ? "campaign" : "direct";
}

/** Valeur de cookie `axi_src` → source connue, ou `null`. */
export function parseSourceCookie(v: string | null | undefined): AudienceSource | null {
  return v && (AUDIENCE_SOURCES as readonly string[]).includes(v) ? (v as AudienceSource) : null;
}

/** Types de règle hors offre (Business : `customer` seulement ; Scale et plus : tous) : à refuser côté serveur. */
export function disallowedRuleTypes(visibility: SectionVisibility | null | undefined, allowed: readonly AudienceRule["type"][]): AudienceRule["type"][] {
  if (!visibility) return [];
  return [...new Set(visibility.rules.map((r) => r.type).filter((t) => !allowed.includes(t)))];
}

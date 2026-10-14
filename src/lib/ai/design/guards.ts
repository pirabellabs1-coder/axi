/**
 * Lot 4 §9 garde-fous (module PUR, testé : tests/design-guards.test.ts).
 *
 * Rien de ce que l'IA écrit n'arrive tel quel dans la boutique :
 *  - les textes passent par `tidy` (typographie) puis `stripForbidden` (aucun prix, promesse, délai,
 *    garantie ni promotion : ces informations viennent du catalogue, jamais du modèle) ;
 *  - les sections hors liste blanche sont retirées ;
 *  - `testimonials` et `reviews` sont INTERDITES sans avis réels (jamais de faux témoignage) ;
 *  - les couleurs sont corrigées pour respecter AA avant toute écriture.
 */
import { contrastRatio, readableOn } from "@/lib/storefront/theme-doc";
import type { GlobalSettings } from "@/lib/theme-engine/types";
import { adjustLuminance, usableButtonColor, AA_LARGE, AA_TEXT } from "@/lib/brand-kit/palette";
import { stripForbidden, tidy } from "../parse";
import { ALLOWED_HOME_SECTIONS, REVIEW_SECTIONS, type BriefHomeSection } from "./schema";

/**
 * Texte proposé par l'IA, nettoyé. Renvoie "" si le nettoyage a tout retiré (le compilateur garde alors
 * la valeur par défaut du préréglage : jamais de texte interdit, jamais de trou dans la page).
 */
export function cleanCopy(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const stripped = stripForbidden(tidy(raw));
  const text = stripped.text.replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max).replace(/[\s,;:.]+\S*$/, "").trim() : text;
}

/** Vrai si le texte contient une affirmation interdite (prix, promesse, délai, garantie, promotion). */
export function hasForbiddenClaim(raw: string): boolean {
  return stripForbidden(tidy(raw)).removed.length > 0;
}

export type SectionFilterResult = { sections: BriefHomeSection[]; removed: { type: string; reason: string }[] };

/**
 * Liste blanche des sections + interdiction des faux avis. `hasReviews` : des avis APPROUVÉS existent
 * réellement en base (le contenu de la section vient alors de la base, pas du modèle).
 */
export function filterSections(home: unknown[], opts: { hasReviews: boolean; maxSections?: number }): SectionFilterResult {
  const removed: { type: string; reason: string }[] = [];
  const sections: BriefHomeSection[] = [];
  const seenUnique = new Set<string>();
  for (const raw of home) {
    const s = raw as BriefHomeSection;
    const type = String((s as { type?: unknown })?.type ?? "");
    if (!(ALLOWED_HOME_SECTIONS as readonly string[]).includes(type)) {
      removed.push({ type, reason: "section non autorisée" });
      continue;
    }
    if ((REVIEW_SECTIONS as readonly string[]).includes(type)) {
      if (!opts.hasReviews) {
        removed.push({ type, reason: "aucun avis réel : section refusée" });
        continue;
      }
      if (seenUnique.has(type)) {
        removed.push({ type, reason: "doublon" });
        continue;
      }
      seenUnique.add(type);
    }
    sections.push(s);
  }
  return { sections: sections.slice(0, opts.maxSections ?? 9), removed };
}

/**
 * Corrige les couleurs d'un document pour garantir AA : 4,5:1 pour le texte, 3:1 pour les boutons et
 * les composants, schémas de section compris. Idempotente.
 */
export function ensureAccessibleColors(settings: GlobalSettings): GlobalSettings {
  const c = settings.colors;
  const background = c.background;
  const text = adjustLuminance(c.text, background, AA_TEXT);
  const muted = adjustLuminance(c.muted, background, AA_TEXT);
  const primary = usableButtonColor(c.primary, background);
  const accent = adjustLuminance(c.accent, background, AA_LARGE);
  const surface = contrastRatio(text, c.surface) >= AA_TEXT ? c.surface : background;
  return {
    ...settings,
    colors: {
      ...c,
      background,
      surface,
      text,
      muted,
      primary,
      primaryText: readableOn(primary, c.primaryText),
      accent,
      border: c.border,
      schemes: c.schemes.map((s) => {
        const schemePrimary = usableButtonColor(s.primary, s.background);
        return {
          ...s,
          text: adjustLuminance(s.text, s.background, AA_TEXT),
          primary: schemePrimary,
          primaryText: readableOn(schemePrimary, s.primaryText),
        };
      }),
    },
  };
}

/** Toutes les paires de couleurs d'un document respectent-elles AA ? (contrôle des tests et du rapport) */
export function colorsAreAccessible(settings: GlobalSettings): boolean {
  const c = settings.colors;
  return (
    contrastRatio(c.text, c.background) >= AA_TEXT &&
    contrastRatio(c.muted, c.background) >= AA_TEXT &&
    contrastRatio(c.text, c.surface) >= AA_TEXT &&
    contrastRatio(c.primaryText, c.primary) >= AA_TEXT &&
    contrastRatio(c.primary, c.background) >= AA_LARGE &&
    contrastRatio(c.accent, c.background) >= AA_LARGE &&
    c.schemes.every((s) => contrastRatio(s.text, s.background) >= AA_TEXT && contrastRatio(s.primaryText, s.primary) >= AA_TEXT)
  );
}

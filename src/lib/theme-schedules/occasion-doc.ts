/**
 * Lot 4 §11 : application d'un préréglage d'occasion à une COPIE du thème (module PUR).
 *
 * Quatre opérations seulement, toutes passées par `operations.ts` (liste blanche, schémas de sections) :
 *  1. annonce d'en-tête (`header.announcement`) ;
 *  2. couleur d'accent (`colors.accent`) ;
 *  3. bannière : section « Texte enrichi » insérée en tête de la page d'accueil ;
 *  4. compte à rebours (facultatif) : section « Compte à rebours » juste après la bannière, qui s'arrête à la fin
 *     de la programmation.
 *
 * Le document produit reste un `ThemeDocument` valide : il est revalidé par l'action avant enregistrement.
 * Le thème principal de la boutique n'est jamais modifié.
 */
import type { OccasionPreset } from "@/config/occasions";
import { addBlock, addSection, updateBlockSetting, updateGlobalSetting, updateSectionSetting } from "@/lib/theme-engine/operations";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { timeZoneOffsetMinutes } from "./rules";

/** « AAAA-MM-JJ HH:MM » dans le fuseau de la boutique (format attendu par la section « Compte à rebours »). */
export function countdownValue(endsAt: Date, timeZone: string): string {
  const shifted = new Date(endsAt.getTime() + timeZoneOffsetMinutes(endsAt, timeZone) * 60_000);
  return `${shifted.toISOString().slice(0, 10)} ${shifted.toISOString().slice(11, 16)}`;
}

export type OccasionOptions = {
  /** Fin de la programmation (compte à rebours). */
  endsAt: Date;
  timeZone: string;
  /** Ajouter la bannière en haut de l'accueil (défaut : oui). */
  banner?: boolean;
  /** Ajouter le compte à rebours quand le préréglage le prévoit (défaut : oui). */
  countdown?: boolean;
};

export function applyOccasion(doc: ThemeDocument, occasion: OccasionPreset, opts: OccasionOptions): ThemeDocument {
  let next = doc;

  // 1. Annonce d'en-tête
  next = updateGlobalSetting(next, "header.announcement.enabled", true);
  next = updateGlobalSetting(next, "header.announcement.text", occasion.announcement.slice(0, 200));

  // 2. Accent
  next = updateGlobalSetting(next, "colors.accent", occasion.accent);

  // 3. Bannière (texte enrichi en tête de l'accueil)
  if (opts.banner !== false) {
    try {
      const added = addSection(next, "home", "rich-text", { index: 0 });
      next = added.doc;
      next = updateSectionSetting(next, "home", added.id, "scheme", "brand");
      next = updateSectionSetting(next, "home", added.id, "align", "center");
      const section = next.templates.home.sections[added.id];
      const heading = section.blocks.find((b) => b.type === "heading");
      const text = section.blocks.find((b) => b.type === "text");
      if (heading) next = updateBlockSetting(next, "home", added.id, heading.id, "text", occasion.banner.heading);
      if (text) next = updateBlockSetting(next, "home", added.id, text.id, "text", occasion.banner.text);
      const button = addBlock(next, "home", added.id, "button");
      next = updateBlockSetting(button.doc, "home", added.id, button.id, "button_label", occasion.banner.cta);
    } catch {
      // Plafond de sections atteint ou modèle absent : l'habillage se limite à l'annonce et à l'accent.
    }
  }

  // 4. Compte à rebours
  if (occasion.countdown && opts.countdown !== false) {
    try {
      const added = addSection(next, "home", "countdown", { index: opts.banner === false ? 0 : 1 });
      next = added.doc;
      next = updateSectionSetting(next, "home", added.id, "heading", `${occasion.name} : plus que`);
      next = updateSectionSetting(next, "home", added.id, "ends_at", countdownValue(opts.endsAt, opts.timeZone));
      next = updateSectionSetting(next, "home", added.id, "scheme", "brand");
    } catch {
      // idem : le compte à rebours est optionnel.
    }
  }

  return next;
}

import type { GlobalSettings, SectionInstance, TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import type { RenderData } from "@/lib/storefront/render-types";
import type { EffectiveMotion } from "@/lib/theme-engine/motion";

/** Contexte passé à chaque section : document, réglages globaux, données sérialisables. */
export type RenderCtx = {
  doc: ThemeDocument;
  settings: GlobalSettings;
  data: RenderData;
  template: TemplateId;
  /** Préfixe des liens de la boutique (/s/{slug}). */
  base: string;
  preview: boolean;
  /** Première section visible du modèle (image prioritaire pour le LCP). */
  first: boolean;
  /** Lot 4 §2 : animations effectives (absentes = aucune animation, ex. cadre seul). */
  motion?: EffectiveMotion;
};

export type SectionProps = { section: SectionInstance; ctx: RenderCtx };

/** Lien de réglage → URL de la boutique. « /catalogue » devient « /s/slug/catalogue » ; https inchangé. */
export function href(ctx: Pick<RenderCtx, "base">, link: string | null | undefined, fallback?: string): string | null {
  const l = link ?? fallback;
  if (!l) return null;
  if (/^https:\/\//i.test(l) || /^(tel|mailto):/i.test(l) || l.startsWith("#")) return l;
  if (!l.startsWith("/") || l.startsWith("//")) return null;
  if (l === "/") return ctx.base;
  if (l.startsWith("/s/")) return l;
  return `${ctx.base}${l}`;
}

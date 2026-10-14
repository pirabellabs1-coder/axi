/**
 * Lot 4 (T3) : types sérialisables ajoutés aux données de rendu (`RenderData.metafields`).
 * Module de types uniquement : importable côté serveur et dans l'aperçu client.
 */
import type { SourceOwner } from "@/lib/theme-engine/dynamic-sources";

/**
 * Champ personnalisé PUBLIC d'un élément du contexte (définition `storefrontVisible`, propriétaire public).
 * Compatible avec `PublicMetafield` (dynamic-sources.ts) : `type`, `value`, `storefrontVisible`.
 */
export type RenderMetafield = {
  namespace: string;
  key: string;
  name: string;
  type: string;
  value: unknown;
  storefrontVisible: true;
  /** Texte lisible (date en français, montant formaté, « Oui » / « Non », titre de la référence…). */
  text: string;
  /** Lien de la boutique déjà préfixé (`/s/{slug}/p/…`) ou https ; null sinon. */
  url: string | null;
  image: { url: string; alt?: string } | null;
};

/** Par propriétaire du contexte, puis par `namespace.key`, dans l'ordre d'affichage (nom du champ). */
export type RenderMetafields = Partial<Record<SourceOwner, Record<string, RenderMetafield>>>;

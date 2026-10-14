import type { SectionSchema } from "../types";
import { HEADING, PADDING, SCHEME } from "./_shared";

/**
 * Lot 4 §5 (T3) : tableau des caractéristiques d'un produit. Mode automatique : tous les champs personnalisés du produit
 * visibles sur la boutique ; lignes manuelles : libellé + valeur (texte fixe ou « Connecter une donnée »).
 * Une ligne vide est simplement omise ; la section disparaît de la boutique s'il ne reste rien (note dans l'aperçu).
 */
export const schema: SectionSchema = {
  type: "product-specs",
  name: "Caractéristiques du produit",
  category: "Produits",
  templates: ["product"],
  settings: [
    ...HEADING("Caractéristiques"),
    { type: "checkbox", id: "auto", label: "Afficher tous les champs personnalisés du produit", default: true, info: "Champs visibles sur la boutique, dans l'ordre de leurs définitions. Les lignes ajoutées ci-dessous suivent." },
    { type: "checkbox", id: "hide_if_empty", label: "Masquer la section si une donnée connectée est vide", default: false, info: "Sinon, la ligne vide est simplement omise." },
    { type: "segmented", id: "layout", label: "Présentation", default: "table", options: [{ value: "table", label: "Tableau" }, { value: "grid", label: "Grille" }] },
    SCHEME,
    ...PADDING,
  ],
  blocks: [
    {
      type: "row",
      name: "Caractéristique",
      settings: [
        { type: "text", id: "label", label: "Libellé", default: "", maxLength: 60 },
        { type: "textarea", id: "value", label: "Valeur", default: "", maxLength: 500, info: "Texte fixe, ou « Connecter une donnée » pour un champ personnalisé du produit. Ligne omise si vide." },
      ],
    },
  ],
  maxBlocks: 20,
  presets: [{ name: "Caractéristiques du produit", settings: { auto: true } }],
};

import type { SectionSchema } from "../types";
import { SCHEME, PADDING } from "./_shared";

export const schema: SectionSchema = {
  type: "cart-progress",
  name: "Barre d'offres",
  category: "Mise en avant",
  templates: ["cart", "home"],
  settings: [
    { type: "text", id: "heading", label: "Titre", default: "", maxLength: 80, placeholder: "Profitez de nos offres" },
    { type: "text", id: "empty_text", label: "Texte panier vide", default: "Remises automatiques selon le montant de votre panier.", maxLength: 140 },
    { type: "checkbox", id: "hide_when_empty", label: "Masquer quand le panier est vide", default: false },
    { type: "paragraph", content: "Affiche la progression vers vos paliers de remise (Promotions, « Remises automatiques », type palier). Masquée s'il n'y a aucun palier actif." },
    SCHEME,
    ...PADDING,
  ],
  presets: [{ name: "Barre d'offres", settings: { scheme: "surface", padding_top: 24, padding_bottom: 24 } }],
};

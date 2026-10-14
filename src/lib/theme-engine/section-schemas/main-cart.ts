import type { SectionSchema } from "../types";

export const schema: SectionSchema = {
  type: "main-cart",
  name: "Panier",
  category: "Modèle",
  templates: ["cart"],
  required: true,
  settings: [
    { type: "checkbox", id: "show_note", label: "Note de commande", default: true },
    { type: "header", content: "Offres (s'appliquent aussi au tiroir)" },
    { type: "checkbox", id: "show_offers", label: "Produits proposés (offres au panier)", default: true },
    { type: "checkbox", id: "show_tier_progress", label: "Progression des paliers de remise", default: true },
    { type: "checkbox", id: "show_gift_card_field", label: "Champ « carte cadeau »", default: false, info: "La carte saisie est reprise à la commande." },
  ],
  presets: [{ name: "Panier" }],
};

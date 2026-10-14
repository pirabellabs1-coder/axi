import type { SectionSchema } from "../types";
import { PADDING, SCHEME } from "./_shared";

/**
 * Lot 4 §4 (T3, bibliothèque premium) : bandeau défilant (messages courts). Un seul par page conseillé ; immobile si le
 * visiteur réduit les animations, en mode économie de données, et en pause au survol ou au focus.
 */
export const schema: SectionSchema = {
  type: "marquee",
  name: "Bandeau défilant",
  category: "Texte",
  settings: [
    { type: "segmented", id: "speed", label: "Vitesse", default: "normal", options: [{ value: "slow", label: "Lente" }, { value: "normal", label: "Normale" }, { value: "fast", label: "Rapide" }] },
    { type: "segmented", id: "size", label: "Taille du texte", default: "md", options: [{ value: "md", label: "Moyenne" }, { value: "lg", label: "Grande" }] },
    { type: "segmented", id: "direction", label: "Sens", default: "left", options: [{ value: "left", label: "Vers la gauche" }, { value: "right", label: "Vers la droite" }] },
    SCHEME,
    ...PADDING,
  ],
  blocks: [{ type: "item", name: "Message", settings: [{ type: "text", id: "text", label: "Texte", default: "Livraison rapide", maxLength: 60 }, { type: "url", id: "link", label: "Lien (facultatif)" }] }],
  maxBlocks: 12,
  presets: [
    {
      name: "Bandeau défilant",
      settings: { scheme: "brand", padding_top: 16, padding_bottom: 16 },
      blocks: [
        { type: "item", settings: { text: "Commande sur WhatsApp" } },
        { type: "item", settings: { text: "Paiement Mobile Money" } },
        { type: "item", settings: { text: "Livraison suivie" } },
        { type: "item", settings: { text: "Retrait en boutique" } },
      ],
    },
  ],
};

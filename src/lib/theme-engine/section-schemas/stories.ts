import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

/** Lot 4 §17 (équipe CAN) : stories achetables (cercles + visionneuse plein écran). */
export const schema: SectionSchema = {
  type: "stories",
  name: "Stories",
  category: "Médias",
  settings: [
    ...HEADING("Nos stories"),
    { type: "segmented", id: "size", label: "Taille des cercles", default: "md", options: [{ value: "sm", label: "Petits" }, { value: "md", label: "Moyens" }, { value: "lg", label: "Grands" }] },
    { type: "checkbox", id: "show_labels", label: "Afficher le titre sous chaque cercle", default: true },
    SCHEME,
    ...PADDING,
  ],
  blocks: [
    {
      type: "story",
      name: "Story",
      limit: 12,
      settings: [
        { type: "text", id: "title", label: "Titre", default: "", maxLength: 24 },
        { type: "image", id: "image", label: "Image (cercle et plein écran)" },
        { type: "video", id: "video", label: "Vidéo (facultatif)", info: "Fichier MP4 ou WebM en https ; l'image reste la couverture." },
        { type: "text", id: "text", label: "Texte affiché", default: "", maxLength: 120 },
        { type: "product", id: "product", label: "Produit mis en avant" },
        { type: "range", id: "duration", label: "Durée", default: 5, min: 3, max: 15, step: 1, unit: "s" },
      ],
    },
  ],
  maxBlocks: 12,
  presets: [{ name: "Stories", blocks: [{ type: "story" }, { type: "story" }, { type: "story" }] }],
};

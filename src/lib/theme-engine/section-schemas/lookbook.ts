import type { SectionSchema } from "../types";
import { HEADING, PADDING, SCHEME, SECTION_WIDTH } from "./_shared";

/** Lot 4 §4 (T3, bibliothèque premium) : photo de mise en situation avec repères cliquables vers les produits du look. */
export const schema: SectionSchema = {
  type: "lookbook",
  name: "Look à acheter",
  category: "Produits",
  settings: [
    ...HEADING("Le look du moment"),
    { type: "textarea", id: "text", label: "Texte", default: "", maxLength: 400 },
    { type: "image", id: "image", label: "Photo du look" },
    { type: "segmented", id: "image_position", label: "Photo", default: "left", options: [{ value: "left", label: "À gauche" }, { value: "right", label: "À droite" }] },
    SCHEME,
    ...PADDING,
    ...SECTION_WIDTH,
  ],
  blocks: [
    {
      type: "hotspot",
      name: "Produit du look",
      settings: [
        { type: "product", id: "product", label: "Produit" },
        { type: "range", id: "x", label: "Position horizontale du repère", default: 50, min: 0, max: 100, step: 1, unit: "%" },
        { type: "range", id: "y", label: "Position verticale du repère", default: 50, min: 0, max: 100, step: 1, unit: "%" },
      ],
    },
  ],
  maxBlocks: 6,
  presets: [{ name: "Look à acheter", blocks: [{ type: "hotspot", settings: { x: 38, y: 32 } }, { type: "hotspot", settings: { x: 60, y: 68 } }] }],
};

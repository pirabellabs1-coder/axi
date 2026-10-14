import type { SectionSchema } from "../types";
import { SCHEME, PADDING, BACKGROUND, SECTION_WIDTH, textBlock, headingBlock, buttonBlock } from "./_shared";

export const schema: SectionSchema = {
  type: "image-with-text",
  name: "Image avec texte",
  category: "Mise en avant",
  settings: [{ type: "image", id: "image", label: "Image" }, { type: "segmented", id: "image_position", label: "Image", default: "left", options: [{ value: "left", label: "À gauche" }, { value: "right", label: "À droite" }] }, { type: "segmented", id: "image_ratio", label: "Format", default: "portrait", options: [{ value: "square", label: "Carré" }, { value: "portrait", label: "Portrait" }, { value: "landscape", label: "Paysage" }] }, SCHEME, ...PADDING, ...SECTION_WIDTH, ...BACKGROUND],
  blocks: [headingBlock, textBlock, buttonBlock],
  maxBlocks: 6,
  presets: [{ name: "Image avec texte", blocks: [{ type: "heading", settings: { text: "Notre histoire" } }, { type: "text", settings: { text: "Racontez ce qui rend votre boutique unique." } }] }],
};

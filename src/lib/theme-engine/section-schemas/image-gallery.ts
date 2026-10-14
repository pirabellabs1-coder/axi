import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING, SECTION_WIDTH } from "./_shared";

export const schema: SectionSchema = {
  type: "image-gallery",
  name: "Galerie d'images",
  category: "Médias",
  settings: [...HEADING(""), { type: "segmented", id: "layout", label: "Disposition", default: "grid", options: [{ value: "grid", label: "Grille" }, { value: "masonry", label: "Mosaïque" }, { value: "carousel", label: "Carrousel" }] }, SCHEME, ...PADDING, ...SECTION_WIDTH],
  blocks: [{ type: "image", name: "Image", settings: [{ type: "image", id: "image", label: "Image" }, { type: "text", id: "caption", label: "Légende" }, { type: "url", id: "link", label: "Lien" }] }],
  maxBlocks: 12,
  presets: [{ name: "Galerie d'images", blocks: [{ type: "image" }, { type: "image" }, { type: "image" }] }],
};

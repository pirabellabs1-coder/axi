import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

export const schema: SectionSchema = {
  type: "collection-list",
  name: "Liste de collections",
  category: "Produits",
  settings: [...HEADING("Nos catégories"), { type: "segmented", id: "style", label: "Style", default: "tiles", options: [{ value: "tiles", label: "Tuiles photo" }, { value: "chips", label: "Pastilles" }, { value: "circles", label: "Cercles" }] }, SCHEME, ...PADDING],
  blocks: [{ type: "collection", name: "Collection", settings: [{ type: "collection", id: "collection", label: "Collection" }, { type: "image", id: "image", label: "Image (sinon celle de la collection)" }] }],
  maxBlocks: 12,
  presets: [{ name: "Liste de collections", blocks: [{ type: "collection" }, { type: "collection" }, { type: "collection" }] }],
};

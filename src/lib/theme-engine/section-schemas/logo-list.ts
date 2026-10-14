import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

export const schema: SectionSchema = {
  type: "logo-list",
  name: "Logos (marques, partenaires)",
  category: "Confiance",
  settings: [...HEADING("Les marques que nous distribuons"), SCHEME, ...PADDING],
  blocks: [{ type: "logo", name: "Logo", settings: [{ type: "image", id: "image", label: "Logo" }, { type: "url", id: "link", label: "Lien" }] }],
  maxBlocks: 16,
  presets: [{ name: "Logos", blocks: [{ type: "logo" }, { type: "logo" }, { type: "logo" }, { type: "logo" }] }],
};

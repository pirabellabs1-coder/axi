import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING, BACKGROUND, SECTION_WIDTH } from "./_shared";

export const schema: SectionSchema = {
  type: "testimonials",
  name: "Témoignages",
  category: "Confiance",
  settings: [...HEADING("Ils nous font confiance"), { type: "segmented", id: "layout", label: "Affichage", default: "carousel", options: [{ value: "grid", label: "Grille" }, { value: "carousel", label: "Carrousel" }] }, SCHEME, ...PADDING, ...SECTION_WIDTH, ...BACKGROUND],
  blocks: [{ type: "testimonial", name: "Témoignage", settings: [{ type: "textarea", id: "quote", label: "Citation", default: "", maxLength: 280 }, { type: "text", id: "author", label: "Nom", default: "" }, { type: "text", id: "role", label: "Ville ou précision", default: "" }, { type: "image", id: "avatar", label: "Photo" }, { type: "range", id: "rating", label: "Note", default: 5, min: 1, max: 5 }] }],
  maxBlocks: 12,
  presets: [{ name: "Témoignages", blocks: [{ type: "testimonial" }, { type: "testimonial" }, { type: "testimonial" }] }],
};

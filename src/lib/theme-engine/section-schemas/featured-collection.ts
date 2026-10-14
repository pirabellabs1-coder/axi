import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING, BACKGROUND, SECTION_WIDTH } from "./_shared";

export const schema: SectionSchema = {
  type: "featured-collection",
  name: "Collection en vedette",
  category: "Produits",
  settings: [...HEADING("Nos coups de cœur"), { type: "collection", id: "collection", label: "Collection" }, { type: "range", id: "limit", label: "Produits affichés", default: 8, min: 2, max: 24 }, { type: "segmented", id: "columns", label: "Colonnes (ordinateur)", default: "4", options: [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }, { value: "5", label: "5" }] }, { type: "segmented", id: "layout", label: "Affichage", default: "grid", options: [{ value: "grid", label: "Grille" }, { value: "carousel", label: "Carrousel" }] }, { type: "checkbox", id: "show_view_all", label: "Bouton « Tout voir »", default: true }, SCHEME, ...PADDING, ...SECTION_WIDTH, ...BACKGROUND],
  presets: [{ name: "Collection en vedette" }],
};

import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

export const schema: SectionSchema = {
  type: "product-grid",
  name: "Tous les produits",
  category: "Produits",
  settings: [...HEADING("Tous nos produits"), { type: "checkbox", id: "show_filters", label: "Filtres et tri", default: true }, { type: "checkbox", id: "show_search", label: "Recherche", default: true }, { type: "range", id: "per_page", label: "Produits par page", default: 24, min: 8, max: 60, step: 4 }, { type: "segmented", id: "columns", label: "Colonnes", default: "4", options: [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }] }, { type: "segmented", id: "layout", label: "Affichage", default: "grid", options: [{ value: "grid", label: "Grille" }, { value: "list", label: "Liste (menu)" }] }, SCHEME, ...PADDING],
  presets: [{ name: "Tous les produits" }],
};

import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

export const schema: SectionSchema = {
  type: "reviews",
  name: "Avis clients vérifiés",
  category: "Confiance",
  settings: [...HEADING("Avis de nos clients"), { type: "range", id: "limit", label: "Avis affichés", default: 6, min: 3, max: 24 }, { type: "checkbox", id: "show_summary", label: "Note moyenne et répartition", default: true }, { type: "checkbox", id: "show_product", label: "Afficher le produit concerné", default: true }, { type: "segmented", id: "layout", label: "Affichage", default: "carousel", options: [{ value: "grid", label: "Grille" }, { value: "carousel", label: "Carrousel" }, { value: "list", label: "Liste" }] }, SCHEME, ...PADDING],
  presets: [{ name: "Avis clients vérifiés" }],
};

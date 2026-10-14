import type { SectionSchema } from "../types";
import { SCHEME, PADDING } from "./_shared";

export const schema: SectionSchema = {
  type: "featured-product",
  name: "Produit en vedette",
  category: "Produits",
  settings: [{ type: "product", id: "product", label: "Produit" }, { type: "checkbox", id: "show_description", label: "Afficher la description", default: true }, SCHEME, ...PADDING],
  presets: [{ name: "Produit en vedette" }],
};

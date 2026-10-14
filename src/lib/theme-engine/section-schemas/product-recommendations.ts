import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

export const schema: SectionSchema = { type: "product-recommendations", name: "Produits similaires", category: "Produits", templates: ["product", "cart"], settings: [...HEADING("Vous aimerez aussi"), { type: "range", id: "limit", label: "Produits affichés", default: 4, min: 2, max: 12 }, SCHEME, ...PADDING], presets: [{ name: "Produits similaires" }] };

import type { SectionSchema } from "../types";

export const schema: SectionSchema = { type: "main-page", name: "Contenu de la page", category: "Modèle", templates: ["page"], required: true, settings: [{ type: "segmented", id: "width", label: "Largeur", default: "narrow", options: [{ value: "narrow", label: "Étroite" }, { value: "wide", label: "Large" }] }], presets: [{ name: "Contenu de la page" }] };

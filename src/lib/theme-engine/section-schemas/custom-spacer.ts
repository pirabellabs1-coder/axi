import type { SectionSchema } from "../types";

export const schema: SectionSchema = { type: "custom-spacer", name: "Espacement", category: "Structure", settings: [{ type: "range", id: "height", label: "Hauteur", default: 48, min: 8, max: 200, step: 8, unit: "px" }, { type: "checkbox", id: "divider", label: "Ligne de séparation", default: false }], presets: [{ name: "Espacement" }] };

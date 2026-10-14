import type { SectionSchema } from "../types";
import { HEADING, PADDING, SCHEME } from "./_shared";

/** Lot 4 §4 (T3, bibliothèque premium) : comparaison avant / après avec curseur accessible (clavier, lecteur d'écran). */
export const schema: SectionSchema = {
  type: "before-after",
  name: "Avant, après",
  category: "Médias",
  settings: [
    ...HEADING("Avant, après"),
    { type: "image", id: "before", label: "Image « avant »" },
    { type: "image", id: "after", label: "Image « après »", info: "Même cadrage et mêmes proportions que l'image « avant »." },
    { type: "text", id: "before_label", label: "Libellé avant", default: "Avant", maxLength: 24 },
    { type: "text", id: "after_label", label: "Libellé après", default: "Après", maxLength: 24 },
    { type: "range", id: "start", label: "Position de départ du curseur", default: 50, min: 5, max: 95, step: 5, unit: "%" },
    { type: "segmented", id: "ratio", label: "Format", default: "landscape", options: [{ value: "square", label: "Carré" }, { value: "portrait", label: "Portrait" }, { value: "landscape", label: "Paysage" }] },
    { type: "textarea", id: "caption", label: "Légende", default: "", maxLength: 300 },
    SCHEME,
    ...PADDING,
  ],
  presets: [{ name: "Avant, après" }],
};

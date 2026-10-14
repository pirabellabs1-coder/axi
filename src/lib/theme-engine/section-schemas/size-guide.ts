import type { SectionSchema } from "../types";
import { HEADING, PADDING, SCHEME } from "./_shared";

/** Lot 4 §4 (T3, bibliothèque premium) : guide des tailles en tableau (jusqu'à 4 mesures), repliable. */
export const schema: SectionSchema = {
  type: "size-guide",
  name: "Guide des tailles",
  category: "Produits",
  settings: [
    ...HEADING("Guide des tailles"),
    { type: "textarea", id: "intro", label: "Introduction", default: "Mesures du corps. Entre deux tailles, choisissez la plus grande ou demandez-nous conseil sur WhatsApp.", maxLength: 400 },
    { type: "text", id: "col_1", label: "Mesure 1", default: "Poitrine", maxLength: 30 },
    { type: "text", id: "col_2", label: "Mesure 2", default: "Taille", maxLength: 30 },
    { type: "text", id: "col_3", label: "Mesure 3", default: "Hanches", maxLength: 30 },
    { type: "text", id: "col_4", label: "Mesure 4", default: "", maxLength: 30 },
    { type: "segmented", id: "unit", label: "Unité", default: "cm", options: [{ value: "cm", label: "cm" }, { value: "in", label: "pouces" }] },
    { type: "checkbox", id: "collapsible", label: "Replié par défaut (le visiteur l'ouvre)", default: false },
    SCHEME,
    ...PADDING,
  ],
  blocks: [
    {
      type: "size",
      name: "Taille",
      settings: [
        { type: "text", id: "size", label: "Taille", default: "M", maxLength: 16 },
        { type: "text", id: "v1", label: "Mesure 1", default: "", maxLength: 20 },
        { type: "text", id: "v2", label: "Mesure 2", default: "", maxLength: 20 },
        { type: "text", id: "v3", label: "Mesure 3", default: "", maxLength: 20 },
        { type: "text", id: "v4", label: "Mesure 4", default: "", maxLength: 20 },
      ],
    },
  ],
  maxBlocks: 12,
  presets: [
    {
      name: "Guide des tailles",
      blocks: [
        { type: "size", settings: { size: "S", v1: "84-88", v2: "66-70", v3: "90-94" } },
        { type: "size", settings: { size: "M", v1: "89-94", v2: "71-76", v3: "95-100" } },
        { type: "size", settings: { size: "L", v1: "95-100", v2: "77-82", v3: "101-106" } },
        { type: "size", settings: { size: "XL", v1: "101-107", v2: "83-89", v3: "107-113" } },
      ],
    },
  ],
};

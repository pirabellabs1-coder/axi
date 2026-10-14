import type { SectionSchema } from "../types";
import { HEADING, PADDING, SCHEME } from "./_shared";

/** Lot 4 §4 (T3, bibliothèque premium) : tableau comparatif (2 ou 3 colonnes), « oui » / « non » affichés en coche / croix. */
export const schema: SectionSchema = {
  type: "comparison-table",
  name: "Tableau comparatif",
  category: "Confiance",
  settings: [
    ...HEADING("Ce qui nous distingue"),
    { type: "text", id: "col_1", label: "Colonne 1", default: "Chez nous", maxLength: 30 },
    { type: "text", id: "col_2", label: "Colonne 2", default: "Ailleurs", maxLength: 30 },
    { type: "text", id: "col_3", label: "Colonne 3 (facultative)", default: "", maxLength: 30 },
    { type: "segmented", id: "highlight", label: "Colonne mise en avant", default: "1", options: [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "none", label: "Aucune" }] },
    { type: "paragraph", content: "Écrivez « oui » ou « non » dans une case pour afficher une coche ou une croix. N'affirmez que ce que vous pouvez prouver." },
    SCHEME,
    ...PADDING,
  ],
  blocks: [
    {
      type: "row",
      name: "Critère",
      settings: [
        { type: "text", id: "label", label: "Critère", default: "Critère", maxLength: 80 },
        { type: "text", id: "v1", label: "Colonne 1", default: "oui", maxLength: 40 },
        { type: "text", id: "v2", label: "Colonne 2", default: "non", maxLength: 40 },
        { type: "text", id: "v3", label: "Colonne 3", default: "", maxLength: 40 },
      ],
    },
  ],
  maxBlocks: 12,
  presets: [
    {
      name: "Tableau comparatif",
      blocks: [
        { type: "row", settings: { label: "Commande et suivi sur WhatsApp", v1: "oui", v2: "non" } },
        { type: "row", settings: { label: "Paiement Mobile Money ou à la livraison", v1: "oui", v2: "Parfois" } },
        { type: "row", settings: { label: "Prix affichés, sans surprise", v1: "oui", v2: "non" } },
      ],
    },
  ],
};

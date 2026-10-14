import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING, ALIGN, BACKGROUND, SECTION_WIDTH } from "./_shared";

export const schema: SectionSchema = {
  type: "multicolumn",
  name: "Colonnes",
  category: "Texte",
  settings: [...HEADING("Pourquoi nous choisir"), { type: "segmented", id: "columns", label: "Colonnes", default: "3", options: [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }] }, ALIGN, SCHEME, ...PADDING, ...SECTION_WIDTH, ...BACKGROUND],
  blocks: [{ type: "column", name: "Colonne", settings: [{ type: "image", id: "image", label: "Image ou icône" }, { type: "text", id: "title", label: "Titre", default: "Livraison rapide" }, { type: "richtext", id: "text", label: "Texte", default: "En 24 h à Cotonou." }, { type: "url", id: "link", label: "Lien" }] }],
  maxBlocks: 8,
  presets: [{ name: "Colonnes", blocks: [{ type: "column" }, { type: "column", settings: { title: "Paiement Mobile Money", text: "MTN, Moov, Wave…" } }, { type: "column", settings: { title: "Service sur WhatsApp", text: "Une question ? Écrivez-nous." } }] }],
};

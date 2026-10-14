import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING, BACKGROUND, SECTION_WIDTH } from "./_shared";

export const schema: SectionSchema = {
  type: "faq",
  name: "Questions fréquentes",
  category: "Texte",
  settings: [...HEADING("Questions fréquentes"), SCHEME, ...PADDING, ...SECTION_WIDTH, ...BACKGROUND],
  blocks: [{ type: "question", name: "Question", settings: [{ type: "text", id: "question", label: "Question", default: "Livrez-vous partout ?" }, { type: "richtext", id: "answer", label: "Réponse", default: "Oui, dans toute la ville. Les frais s'affichent au moment de commander." }] }],
  maxBlocks: 20,
  presets: [{ name: "Questions fréquentes", blocks: [{ type: "question" }, { type: "question", settings: { question: "Comment payer ?", answer: "Mobile Money, carte ou espèces à la livraison." } }] }],
};

import type { SectionSchema } from "../types";
import { SCHEME, PADDING, ALIGN, BACKGROUND, SECTION_WIDTH, textBlock, headingBlock, buttonBlock } from "./_shared";

export const schema: SectionSchema = {
  type: "rich-text",
  name: "Texte enrichi",
  category: "Texte",
  settings: [ALIGN, SCHEME, ...PADDING, ...SECTION_WIDTH, ...BACKGROUND],
  blocks: [headingBlock, textBlock, buttonBlock],
  presets: [{ name: "Texte enrichi", blocks: [{ type: "heading", settings: { text: "Parlez de votre marque" } }, { type: "text", settings: { text: "Partagez vos valeurs, votre savoir-faire et vos engagements." } }] }],
};

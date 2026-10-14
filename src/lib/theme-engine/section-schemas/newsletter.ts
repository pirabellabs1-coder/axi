import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING, BACKGROUND, SECTION_WIDTH } from "./_shared";

export const schema: SectionSchema = {
  type: "newsletter",
  name: "Inscription aux nouveautés",
  category: "Contact",
  settings: [...HEADING("Restez informé"), { type: "textarea", id: "text", label: "Texte", default: "Recevez nos nouveautés et promotions." }, { type: "segmented", id: "channel", label: "Canal", default: "whatsapp", options: [{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "E-mail" }] }, SCHEME, ...PADDING, ...SECTION_WIDTH, ...BACKGROUND],
  presets: [{ name: "Inscription aux nouveautés" }],
};

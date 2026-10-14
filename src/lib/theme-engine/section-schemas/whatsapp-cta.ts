import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING, BACKGROUND, SECTION_WIDTH } from "./_shared";

export const schema: SectionSchema = {
  type: "whatsapp-cta",
  name: "Appel WhatsApp",
  category: "Contact",
  settings: [...HEADING("Une question ? Écrivez-nous"), { type: "textarea", id: "text", label: "Texte", default: "Réponse rapide sur WhatsApp, du lundi au samedi." }, { type: "text", id: "prefill", label: "Message prérempli", default: "Bonjour, j'ai une question." }, SCHEME, ...PADDING, ...SECTION_WIDTH, ...BACKGROUND],
  presets: [{ name: "Appel WhatsApp", settings: { scheme: "brand" } }],
};

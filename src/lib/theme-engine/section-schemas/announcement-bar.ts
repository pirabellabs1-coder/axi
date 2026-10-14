import type { SectionSchema } from "../types";
import { SCHEME } from "./_shared";

export const schema: SectionSchema = {
  type: "announcement-bar",
  name: "Bandeau d'annonce",
  category: "Structure",
  settings: [SCHEME, { type: "checkbox", id: "autoplay", label: "Défilement automatique", default: true }],
  blocks: [{ type: "announcement", name: "Annonce", settings: [{ type: "text", id: "text", label: "Texte", default: "Bienvenue dans notre boutique", maxLength: 120 }, { type: "url", id: "link", label: "Lien" }] }],
  maxBlocks: 5,
  presets: [{ name: "Bandeau d'annonce", blocks: [{ type: "announcement" }] }],
};

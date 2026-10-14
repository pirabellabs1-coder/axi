import type { SectionSchema } from "../types";
import { SCHEME, PADDING } from "./_shared";

export const schema: SectionSchema = {
  type: "trust-badges",
  name: "Garanties",
  category: "Confiance",
  settings: [SCHEME, ...PADDING],
  blocks: [{ type: "badge", name: "Garantie", settings: [{ type: "select", id: "icon", label: "Icône", default: "truck", options: [{ value: "truck", label: "Livraison" }, { value: "shield", label: "Paiement sécurisé" }, { value: "refresh", label: "Échange" }, { value: "chat", label: "Service client" }, { value: "star", label: "Qualité" }, { value: "clock", label: "Rapidité" }] }, { type: "text", id: "title", label: "Titre", default: "Livraison en 24 h" }, { type: "text", id: "text", label: "Texte", default: "" }] }],
  maxBlocks: 6,
  presets: [{ name: "Garanties", blocks: [{ type: "badge" }, { type: "badge", settings: { icon: "shield", title: "Paiement Mobile Money" } }, { type: "badge", settings: { icon: "chat", title: "Réponse sur WhatsApp" } }] }],
};

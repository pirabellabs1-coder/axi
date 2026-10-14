import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

/**
 * Lot 4 §18 (équipe CAN) : live shopping. Le direct lui-même (titre, date, diffusion, produits épinglés)
 * est géré dans « Direct » (`/app/{storeId}/live`) : la section affiche le prochain direct de la boutique,
 * sans réglage à dupliquer.
 */
export const schema: SectionSchema = {
  type: "live-shopping",
  name: "Direct (live shopping)",
  category: "Mise en avant",
  settings: [
    ...HEADING("En direct"),
    { type: "textarea", id: "text", label: "Texte d'introduction", default: "", maxLength: 300 },
    { type: "checkbox", id: "show_reminder", label: "Proposer « Me rappeler sur WhatsApp »", default: true, info: "Le client laisse son numéro et reçoit un message au début du direct (consentement enregistré)." },
    { type: "checkbox", id: "hide_when_none", label: "Masquer la section si aucun direct n'est prévu", default: true },
    SCHEME,
    ...PADDING,
  ],
  presets: [{ name: "Direct (live shopping)" }],
};

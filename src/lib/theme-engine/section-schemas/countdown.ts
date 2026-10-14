import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING, BUTTON } from "./_shared";

export const schema: SectionSchema = { type: "countdown", name: "Compte à rebours", category: "Mise en avant", settings: [...HEADING("Fin de la promotion dans"), { type: "text", id: "ends_at", label: "Date de fin (AAAA-MM-JJ HH:MM)", default: "" }, ...BUTTON("button", "J'en profite"), SCHEME, ...PADDING], presets: [{ name: "Compte à rebours", settings: { scheme: "brand" } }] };

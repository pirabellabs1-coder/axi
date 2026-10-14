import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

export const schema: SectionSchema = { type: "opening-hours", name: "Horaires", category: "Contact", settings: [...HEADING("Horaires d'ouverture"), SCHEME, ...PADDING], presets: [{ name: "Horaires" }] };

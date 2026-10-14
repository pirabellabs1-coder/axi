import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

export const schema: SectionSchema = { type: "map", name: "Plan d'accès", category: "Contact", settings: [...HEADING("Plan d'accès"), { type: "text", id: "address", label: "Adresse ou repère", default: "" }, { type: "image", id: "image", label: "Image du plan (optionnelle)" }, SCHEME, ...PADDING], presets: [{ name: "Plan d'accès" }] };

import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

export const schema: SectionSchema = { type: "contact", name: "Contact et adresse", category: "Contact", settings: [...HEADING("Nous trouver"), { type: "checkbox", id: "show_map_link", label: "Lien itinéraire", default: true }, SCHEME, ...PADDING], presets: [{ name: "Contact et adresse" }] };

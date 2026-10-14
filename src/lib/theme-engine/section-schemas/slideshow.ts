import type { SectionSchema } from "../types";
import { BUTTON } from "./_shared";

export const schema: SectionSchema = {
  type: "slideshow",
  name: "Diaporama",
  category: "Mise en avant",
  settings: [{ type: "checkbox", id: "autoplay", label: "Défilement automatique", default: true }, { type: "range", id: "speed", label: "Durée par diapositive", default: 5, min: 3, max: 10, unit: "s" }, { type: "segmented", id: "height", label: "Hauteur", default: "large", options: [{ value: "medium", label: "Moyenne" }, { value: "large", label: "Grande" }] }],
  blocks: [{ type: "slide", name: "Diapositive", settings: [{ type: "image", id: "image", label: "Image" }, { type: "text", id: "heading", label: "Titre", default: "Nouvelle collection" }, { type: "text", id: "subheading", label: "Sous-titre", default: "" }, ...BUTTON("button", "Voir")] }],
  maxBlocks: 6,
  presets: [{ name: "Diaporama", blocks: [{ type: "slide" }, { type: "slide" }] }],
};

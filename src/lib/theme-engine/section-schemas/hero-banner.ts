import type { SectionSchema } from "../types";
import { SCHEME, textBlock, headingBlock, buttonBlock } from "./_shared";

export const schema: SectionSchema = {
  type: "hero-banner",
  name: "Bannière principale",
  category: "Mise en avant",
  settings: [
    { type: "image", id: "image", label: "Image (ordinateur)" },
    { type: "image", id: "image_mobile", label: "Image (mobile)", info: "Optionnelle : recadrage dédié au téléphone." },
    { type: "segmented", id: "height", label: "Hauteur", default: "large", options: [{ value: "small", label: "Petite" }, { value: "medium", label: "Moyenne" }, { value: "large", label: "Grande" }, { value: "full", label: "Plein écran" }] },
    { type: "select", id: "layout", label: "Disposition", default: "overlay", options: [{ value: "overlay", label: "Texte sur l'image" }, { value: "split", label: "Image et texte côte à côte" }, { value: "below", label: "Texte sous l'image" }] },
    { type: "select", id: "content_position", label: "Position du texte", default: "bottom-left", options: [{ value: "center", label: "Centre" }, { value: "bottom-left", label: "Bas gauche" }, { value: "middle-left", label: "Milieu gauche" }, { value: "bottom-center", label: "Bas centre" }] },
    { type: "range", id: "overlay_opacity", label: "Assombrir l'image", default: 30, min: 0, max: 80, step: 5, unit: "%" },
    SCHEME,
  ],
  blocks: [headingBlock, textBlock, buttonBlock],
  maxBlocks: 5,
  presets: [{ name: "Bannière principale", blocks: [{ type: "heading", settings: { text: "Bienvenue dans notre boutique", size: "xl" } }, { type: "text", settings: { text: "Commandez en ligne, payez par Mobile Money, recevez chez vous." } }, { type: "button", settings: { button_label: "Découvrir", button_link: "/catalogue", button_style: "solid" } }] }],
};

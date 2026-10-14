import type { SectionSchema } from "../types";
import { PADDING, SCHEME, buttonBlock, headingBlock, textBlock } from "./_shared";

/** Lot 4 §4 (T3, bibliothèque premium) : vidéo d'ambiance (sans son) à côté d'un texte, image de couverture indispensable. */
export const schema: SectionSchema = {
  type: "hero-split-video",
  name: "Vidéo et texte",
  category: "Mise en avant",
  settings: [
    { type: "video", id: "video", label: "Vidéo (fichier MP4 ou WebM)", info: "Lien https direct vers un fichier court, sans son (10 Mo maximum conseillé). Jamais lancée en mode économie de données ni si le visiteur réduit les animations." },
    { type: "image", id: "poster", label: "Image de couverture", info: "Affichée avant la vidéo et à sa place sur les connexions lentes : indispensable pour un chargement rapide." },
    { type: "checkbox", id: "autoplay", label: "Lecture automatique (sans son, en boucle)", default: true },
    { type: "segmented", id: "media_position", label: "Vidéo", default: "right", options: [{ value: "left", label: "À gauche" }, { value: "right", label: "À droite" }] },
    { type: "segmented", id: "media_ratio", label: "Format", default: "portrait", options: [{ value: "square", label: "Carré" }, { value: "portrait", label: "Portrait" }, { value: "landscape", label: "Paysage" }] },
    SCHEME,
    ...PADDING,
  ],
  blocks: [headingBlock, textBlock, buttonBlock],
  maxBlocks: 5,
  presets: [
    {
      name: "Vidéo et texte",
      blocks: [
        { type: "heading", settings: { text: "Fait à la main, pensé pour durer", size: "xl" } },
        { type: "text", settings: { text: "Découvrez l'atelier en quelques secondes, puis commandez en ligne ou sur WhatsApp." } },
        { type: "button", settings: { button_label: "Voir la collection", button_link: "/catalogue", button_style: "solid" } },
      ],
    },
  ],
};

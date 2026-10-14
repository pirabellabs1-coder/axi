import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

/** Lot 4 §17 (équipe CAN) : vidéo achetable, avec produits étiquetés et instant d'apparition. */
export const schema: SectionSchema = {
  type: "shoppable-video",
  name: "Vidéo achetable",
  category: "Médias",
  settings: [
    ...HEADING("Vu dans la vidéo"),
    { type: "video", id: "video", label: "Vidéo", info: "Fichier MP4 ou WebM en https (téléversé ou lien direct). YouTube n'est pas lisible ici." },
    { type: "image", id: "poster", label: "Image de couverture", info: "Indispensable : affichée avant la vidéo, et seule en mode économie de données." },
    { type: "url", id: "captions", label: "Sous-titres (fichier .vtt)", default: "" },
    { type: "checkbox", id: "autoplay", label: "Lancer la vidéo quand elle est visible (sans son)", default: true, info: "Jamais en mode économie de données, ni si le visiteur réduit les animations." },
    { type: "checkbox", id: "loop", label: "Lecture en boucle", default: true },
    { type: "segmented", id: "ratio", label: "Format", default: "portrait", options: [{ value: "portrait", label: "Portrait" }, { value: "square", label: "Carré" }, { value: "landscape", label: "Paysage" }] },
    { type: "segmented", id: "layout", label: "Produits", default: "side", options: [{ value: "side", label: "À côté" }, { value: "below", label: "En dessous" }] },
    SCHEME,
    ...PADDING,
  ],
  blocks: [
    {
      type: "tagged_product",
      name: "Produit étiqueté",
      limit: 10,
      settings: [
        { type: "product", id: "product", label: "Produit" },
        { type: "number", id: "at", label: "Apparaît à (secondes)", default: 0, min: 0, max: 3600, step: 1, unit: "s" },
        { type: "text", id: "note", label: "Précision", default: "", maxLength: 60, info: "Par exemple « taille M » ou « coloris sable »." },
      ],
    },
  ],
  maxBlocks: 10,
  presets: [{ name: "Vidéo achetable", blocks: [{ type: "tagged_product" }, { type: "tagged_product" }] }],
};

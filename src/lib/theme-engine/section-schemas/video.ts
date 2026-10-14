import type { SectionSchema } from "../types";
import { SCHEME, PADDING, HEADING } from "./_shared";

export const schema: SectionSchema = {
  type: "video",
  name: "Vidéo",
  category: "Médias",
  settings: [...HEADING(""), { type: "video", id: "url", label: "Lien de la vidéo", info: "YouTube, Vimeo ou fichier MP4 en https." }, { type: "image", id: "cover", label: "Image de couverture" }, { type: "checkbox", id: "autoplay", label: "Lecture automatique (muette)", default: false }, SCHEME, ...PADDING],
  presets: [{ name: "Vidéo" }],
};

import { MEDIA, PRODUCT_PHOTOS, unsplash } from "@/config/media";

export type SectorId = "general" | "restaurant" | "patisserie" | "mode" | "beaute" | "salon" | "clinique";

export type SectorOption = {
  id: SectorId;
  label: string;
  hint: string;
  image: string;
  alt: string;
};

const img = (id: string) => unsplash(id, 640, 480);

/** Secteurs proposés à la création. L'id est enregistré dans `Store.sector` et `Store.themeId`. */
export const SECTORS: SectorOption[] = [
  { id: "general", label: "Commerce général", hint: "Épicerie, téléphonie, articles divers", image: img(MEDIA.market.id), alt: MEDIA.market.alt },
  { id: "restaurant", label: "Restaurant", hint: "Maquis, traiteur, plats à emporter", image: img(MEDIA.jollof.id), alt: MEDIA.jollof.alt },
  { id: "patisserie", label: "Pâtisserie", hint: "Gâteaux, viennoiseries, jus", image: img(MEDIA.bakery.id), alt: MEDIA.bakery.alt },
  { id: "mode", label: "Mode", hint: "Pagnes, couture, accessoires", image: img(MEDIA.seamstresses.id), alt: MEDIA.seamstresses.alt },
  { id: "beaute", label: "Beauté", hint: "Cosmétiques, soins, parfums", image: img(PRODUCT_PHOTOS.sheaButter), alt: "Pots de beurre de karité et soins naturels" },
  { id: "salon", label: "Salon", hint: "Coiffure, tresses, onglerie", image: img(MEDIA.braids.id), alt: MEDIA.braids.alt },
  { id: "clinique", label: "Clinique", hint: "Cabinet, consultations, soins", image: img(MEDIA.laptopBraids.id), alt: MEDIA.laptopBraids.alt },
];

export function getSector(id: string | null | undefined): SectorOption | undefined {
  return SECTORS.find((s) => s.id === id);
}

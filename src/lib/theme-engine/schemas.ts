import type { SectionSchema, SectionType, TemplateId } from "./types";
import { schema as announcementBar } from "./section-schemas/announcement-bar";
import { schema as heroBanner } from "./section-schemas/hero-banner";
import { schema as slideshow } from "./section-schemas/slideshow";
import { schema as imageWithText } from "./section-schemas/image-with-text";
import { schema as richText } from "./section-schemas/rich-text";
import { schema as featuredCollection } from "./section-schemas/featured-collection";
import { schema as featuredProduct } from "./section-schemas/featured-product";
import { schema as collectionList } from "./section-schemas/collection-list";
import { schema as productGrid } from "./section-schemas/product-grid";
import { schema as multicolumn } from "./section-schemas/multicolumn";
import { schema as imageGallery } from "./section-schemas/image-gallery";
import { schema as video } from "./section-schemas/video";
import { schema as testimonials } from "./section-schemas/testimonials";
import { schema as reviews } from "./section-schemas/reviews";
import { schema as faq } from "./section-schemas/faq";
import { schema as newsletter } from "./section-schemas/newsletter";
import { schema as whatsappCta } from "./section-schemas/whatsapp-cta";
import { schema as contact } from "./section-schemas/contact";
import { schema as openingHours } from "./section-schemas/opening-hours";
import { schema as map } from "./section-schemas/map";
import { schema as logoList } from "./section-schemas/logo-list";
import { schema as countdown } from "./section-schemas/countdown";
import { schema as trustBadges } from "./section-schemas/trust-badges";
import { schema as customSpacer } from "./section-schemas/custom-spacer";
import { schema as mainProduct } from "./section-schemas/main-product";
import { schema as productRecommendations } from "./section-schemas/product-recommendations";
import { schema as mainCollection } from "./section-schemas/main-collection";
import { schema as mainPage } from "./section-schemas/main-page";
import { schema as mainCart } from "./section-schemas/main-cart";
import { schema as cartProgress } from "./section-schemas/cart-progress";
// Lot 2 (équipe Blog) : schémas des sections du blog, ajoutés après celles du cœur.
import { BLOG_SECTION_SCHEMAS } from "@/lib/blog/section-schemas";
import { T3_SECTION_SCHEMAS } from "./section-schemas/_t3-sections"; // Lot 4 (équipe T3) : caractéristiques produit et sections premium
import { CAN_SECTION_SCHEMAS } from "./section-schemas/_can-sections"; // Lot 4D (équipe CAN) : vidéo achetable, stories, direct

/**
 * Bibliothèque de sections (schémas) : AGRÉGATEUR. Chaque schéma vit dans `section-schemas/<type>.ts`
 * (`export const schema: SectionSchema`), champs partagés dans `section-schemas/_shared.ts`.
 * Ajouter une section = un fichier de schéma + une ligne d'import ici (ou dans un tableau d'équipe, comme le blog)
 * + le type dans `SectionType` + un composant de rendu (src/components/storefront/sections/<type>.tsx, render-registry.tsx).
 * L'ordre de ce tableau est l'ordre d'affichage du sélecteur « Ajouter une section ».
 */
const CORE_SECTIONS: SectionSchema[] = [
  announcementBar,
  heroBanner,
  slideshow,
  imageWithText,
  richText,
  featuredCollection,
  featuredProduct,
  collectionList,
  productGrid,
  multicolumn,
  imageGallery,
  video,
  testimonials,
  reviews,
  faq,
  newsletter,
  whatsappCta,
  contact,
  openingHours,
  map,
  logoList,
  countdown,
  trustBadges,
  customSpacer,
  mainProduct,
  productRecommendations,
  mainCollection,
  mainPage,
  mainCart,
  cartProgress,
  ...T3_SECTION_SCHEMAS,
  ...CAN_SECTION_SCHEMAS,
];

function indexSchemas(lists: SectionSchema[][]): Record<SectionType, SectionSchema> {
  const out = {} as Record<SectionType, SectionSchema>;
  for (const list of lists) {
    for (const s of list) {
      if (Object.prototype.hasOwnProperty.call(out, s.type)) throw new Error(`Schéma de section en double : « ${s.type} ».`);
      out[s.type] = s;
    }
  }
  return out;
}

export const SECTION_SCHEMAS: Record<SectionType, SectionSchema> = indexSchemas([CORE_SECTIONS, BLOG_SECTION_SCHEMAS]);

/** Sections ajoutables à un modèle donné. */
export function sectionsForTemplate(template: TemplateId): typeof SECTION_SCHEMAS[SectionType][] {
  return Object.values(SECTION_SCHEMAS).filter((s) => {
    if (s.templates) return s.templates.includes(template);
    return s.category !== "Modèle";
  });
}

export const SECTION_CATEGORIES = ["Mise en avant", "Produits", "Texte", "Médias", "Confiance", "Contact", "Structure", "Modèle"] as const;

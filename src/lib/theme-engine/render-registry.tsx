/**
 * Registre de rendu : type de section → composant de la boutique publique.
 * Ajouter une section = schéma (schemas.ts) + composant (src/components/storefront/sections/<type>.tsx) + entrée ici.
 * Les composants sont purs (aucun accès base) : rendus côté serveur, et côté client dans l'aperçu de l'éditeur.
 */
import type { ComponentType } from "react";
import type { SectionType } from "./types";
import type { SectionProps } from "@/components/storefront/render-context";
import AnnouncementBar from "@/components/storefront/sections/announcement-bar";
import HeroBanner from "@/components/storefront/sections/hero-banner";
import Slideshow from "@/components/storefront/sections/slideshow";
import ImageWithText from "@/components/storefront/sections/image-with-text";
import RichTextSection from "@/components/storefront/sections/rich-text";
import FeaturedCollection from "@/components/storefront/sections/featured-collection";
import FeaturedProduct from "@/components/storefront/sections/featured-product";
import CollectionList from "@/components/storefront/sections/collection-list";
import ProductGrid from "@/components/storefront/sections/product-grid";
import Multicolumn from "@/components/storefront/sections/multicolumn";
import ImageGallery from "@/components/storefront/sections/image-gallery";
import Video from "@/components/storefront/sections/video";
import Testimonials from "@/components/storefront/sections/testimonials";
import Reviews from "@/components/storefront/sections/reviews";
import Faq from "@/components/storefront/sections/faq";
import Newsletter from "@/components/storefront/sections/newsletter";
import WhatsappCta from "@/components/storefront/sections/whatsapp-cta";
import Contact from "@/components/storefront/sections/contact";
import OpeningHours from "@/components/storefront/sections/opening-hours";
import MapSection from "@/components/storefront/sections/map";
import LogoList from "@/components/storefront/sections/logo-list";
import Countdown from "@/components/storefront/sections/countdown";
import TrustBadges from "@/components/storefront/sections/trust-badges";
import CustomSpacer from "@/components/storefront/sections/custom-spacer";
import MainProduct from "@/components/storefront/sections/main-product";
import ProductRecommendations from "@/components/storefront/sections/product-recommendations";
import MainCollection from "@/components/storefront/sections/main-collection";
import MainPage from "@/components/storefront/sections/main-page";
import MainCart from "@/components/storefront/sections/main-cart";
import CartProgress from "@/components/storefront/sections/cart-progress";
import { BLOG_SECTION_RENDERERS } from "@/lib/blog/section-renderers"; // Lot 2 (équipe Blog)
// Lot 4 (équipe T3) : caractéristiques produit et bibliothèque premium
import ProductSpecs from "@/components/storefront/sections/product-specs";
import HeroSplitVideo from "@/components/storefront/sections/hero-split-video";
import Lookbook from "@/components/storefront/sections/lookbook";
import BeforeAfter from "@/components/storefront/sections/before-after";
import SizeGuide from "@/components/storefront/sections/size-guide";
import ComparisonTable from "@/components/storefront/sections/comparison-table";
import Marquee from "@/components/storefront/sections/marquee";
import MainSearch from "@/components/storefront/sections/main-search"; // Vague 2 : modèle « Recherche »
import { CAN_SECTION_RENDERERS } from "@/components/storefront/sections/can-renderers"; // Lot 4D (équipe CAN) : vidéo achetable, stories, direct

export const SECTION_RENDERERS: Record<SectionType, ComponentType<SectionProps>> = {
  "announcement-bar": AnnouncementBar,
  "hero-banner": HeroBanner,
  slideshow: Slideshow,
  "image-with-text": ImageWithText,
  "rich-text": RichTextSection,
  "featured-collection": FeaturedCollection,
  "featured-product": FeaturedProduct,
  "collection-list": CollectionList,
  "product-grid": ProductGrid,
  multicolumn: Multicolumn,
  "image-gallery": ImageGallery,
  video: Video,
  testimonials: Testimonials,
  reviews: Reviews,
  faq: Faq,
  newsletter: Newsletter,
  "whatsapp-cta": WhatsappCta,
  contact: Contact,
  "opening-hours": OpeningHours,
  map: MapSection,
  "logo-list": LogoList,
  countdown: Countdown,
  "trust-badges": TrustBadges,
  "custom-spacer": CustomSpacer,
  "main-product": MainProduct,
  "product-recommendations": ProductRecommendations,
  "main-collection": MainCollection,
  "main-page": MainPage,
  "main-cart": MainCart,
  "cart-progress": CartProgress,
  ...BLOG_SECTION_RENDERERS,
  "product-specs": ProductSpecs,
  "hero-split-video": HeroSplitVideo,
  lookbook: Lookbook,
  "before-after": BeforeAfter,
  "size-guide": SizeGuide,
  "comparison-table": ComparisonTable,
  marquee: Marquee,
  "main-search": MainSearch,
  ...CAN_SECTION_RENDERERS,
};

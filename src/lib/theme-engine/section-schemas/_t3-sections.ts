/**
 * Sections de l'équipe Rendu (T3, lot 4A) : caractéristiques produit et bibliothèque premium.
 * Un fichier par section (`<type>.ts`, `export const schema`) ; cette liste est la seule entrée dans l'agrégateur.
 */
import type { SectionSchema } from "../types";
import { schema as productSpecs } from "./product-specs";
import { schema as heroSplitVideo } from "./hero-split-video";
import { schema as lookbook } from "./lookbook";
import { schema as beforeAfter } from "./before-after";
import { schema as sizeGuide } from "./size-guide";
import { schema as comparisonTable } from "./comparison-table";
import { schema as marquee } from "./marquee";
import { schema as mainSearch } from "./main-search"; // Vague 2 : modèle « Recherche »

export const T3_SECTION_SCHEMAS: SectionSchema[] = [productSpecs, heroSplitVideo, lookbook, beforeAfter, sizeGuide, comparisonTable, marquee, mainSearch];

/** Types de sections de T3 (tests : sections tolérées en plus de l'instantané du cœur). */
export const T3_SECTION_TYPES = T3_SECTION_SCHEMAS.map((s) => s.type);

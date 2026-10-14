/**
 * Sections de l'équipe Canaux (CAN, lot 4D) : vidéos et stories achetables (§17), live shopping (§18).
 * Un fichier par section (`<type>.ts`, `export const schema`) ; cette liste est la seule entrée dans l'agrégateur.
 */
import type { SectionSchema } from "../types";
import { schema as shoppableVideo } from "./shoppable-video";
import { schema as stories } from "./stories";
import { schema as liveShopping } from "./live-shopping";

export const CAN_SECTION_SCHEMAS: SectionSchema[] = [shoppableVideo, stories, liveShopping];

/** Types de sections de CAN (tests : sections tolérées en plus de l'instantané du cœur). */
export const CAN_SECTION_TYPES = CAN_SECTION_SCHEMAS.map((s) => s.type);

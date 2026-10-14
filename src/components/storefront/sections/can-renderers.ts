/**
 * Sections de l'équipe Canaux (CAN, lot 4D) : une seule entrée dans `render-registry.tsx`.
 * Schémas : `src/lib/theme-engine/section-schemas/_can-sections.ts`.
 */
import type { ComponentType } from "react";
import type { SectionProps } from "../render-context";
import ShoppableVideo from "./shoppable-video";
import Stories from "./stories";
import LiveShopping from "./live-shopping";

export const CAN_SECTION_RENDERERS: Record<"shoppable-video" | "stories" | "live-shopping", ComponentType<SectionProps>> = {
  "shoppable-video": ShoppableVideo,
  stories: Stories,
  "live-shopping": LiveShopping,
};

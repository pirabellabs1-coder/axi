/**
 * Règles pures des sections enregistrées : plan, quota, forme exposée à l'éditeur (testé).
 */
import type { SavedSection } from "@prisma/client";
import { PLANS, type PlanId } from "@/config/plans";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { compatibleTemplates } from "./payload";
import type { SectionType, TemplateId } from "@/lib/theme-engine/types";

export function savedSectionsEnabled(planId: PlanId): boolean {
  return PLANS[planId].features.savedSections;
}

/** Plafond du plan (null = illimité ; 0 = fonction absente). */
export function savedSectionLimit(planId: PlanId): number | null {
  return savedSectionsEnabled(planId) ? PLANS[planId].limits.savedSections : 0;
}

/** Message d'upsell, ou null si l'enregistrement est permis. */
export function savedSectionQuotaIssue(planId: PlanId, used: number, storeId: string): string | null {
  if (!savedSectionsEnabled(planId)) return `Les sections enregistrées sont incluses à partir du plan Starter : /app/${storeId}/abonnement`;
  const max = savedSectionLimit(planId);
  if (max !== null && used >= max) return `Limite de votre plan atteinte : ${used} sections enregistrées sur ${max}. Supprimez-en une ou passez au plan Business (illimité) : /app/${storeId}/abonnement`;
  return null;
}

export type SavedSectionDTO = {
  id: string;
  name: string;
  sectionType: string;
  /** Nom du type de section (« Colonnes », « Bannière principale »…). */
  sectionName: string;
  previewUrl: string | null;
  usageCount: number;
  createdAt: string;
  /** Modèles de page où l'insertion est possible. */
  templates: TemplateId[];
};

export function toSavedSectionDTO(row: Pick<SavedSection, "id" | "name" | "sectionType" | "previewUrl" | "usageCount" | "createdAt">): SavedSectionDTO {
  const schema = SECTION_SCHEMAS[row.sectionType as SectionType];
  return {
    id: row.id,
    name: row.name,
    sectionType: row.sectionType,
    sectionName: schema?.name ?? row.sectionType,
    previewUrl: row.previewUrl,
    usageCount: row.usageCount,
    createdAt: row.createdAt.toISOString(),
    templates: schema ? compatibleTemplates(schema.type) : [],
  };
}

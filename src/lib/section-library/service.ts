import "server-only";
import type { SectionLibraryItem } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS, type PlanId } from "@/config/plans";
import { mediaKeyOf } from "@/lib/storage/write-guard";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import type { SectionType, TemplateId } from "@/lib/theme-engine/types";
import { compatibleTemplates, type SectionPayload } from "@/lib/saved-sections/payload";
import { verifyPayloadRefs } from "@/lib/saved-sections/refs";
import { effectiveMinPlan, libraryAccess, validateLibraryPayload } from "./rules";

/**
 * Bibliothèque de sections de la plateforme, côté serveur.
 *  - Lecture marchand : éléments publiés, triés par position, avec l'état d'accès du plan de la boutique.
 *  - Insertion : contrôle `libraryAccess` (publié, premium, minPlan) côté serveur, charge revalidée, références
 *    vérifiées contre la boutique (menus), puis clonage par l'éditeur avec de nouveaux identifiants.
 *  - Aperçus : image du stockage objet, sous un espace de clés propre à la plateforme (`LIBRARY_MEDIA_NAMESPACE`).
 */

/** Pseudo-boutique des médias de la bibliothèque (clé `stores/axilibrary/…`, jamais un identifiant cuid de boutique). */
export const LIBRARY_MEDIA_NAMESPACE = "axilibrary";

/** URL du stockage objet (local ou S3) : interdite dans une charge de bibliothèque. */
export function isStoreMediaUrl(url: string): boolean {
  return mediaKeyOf(url) !== null;
}

export type LibraryItemDTO = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  sectionType: string;
  sectionName: string;
  previewUrl: string | null;
  premium: boolean;
  minPlan: PlanId;
  tags: string[];
  templates: TemplateId[];
  /** Accès refusé pour le plan de la boutique (affiché avec un cadenas et le plan requis). */
  locked: boolean;
  lockReason: string | null;
  requiredPlan: PlanId;
  requiredPlanName: string;
};

export function toLibraryDTO(item: SectionLibraryItem, planId: PlanId): LibraryItemDTO {
  const schema = SECTION_SCHEMAS[item.sectionType as SectionType];
  const access = libraryAccess(item, planId);
  const required = effectiveMinPlan(item);
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    description: item.description,
    category: item.category,
    sectionType: item.sectionType,
    sectionName: schema?.name ?? item.sectionType,
    previewUrl: item.previewUrl,
    premium: item.premium,
    minPlan: item.minPlan,
    tags: item.tags,
    templates: schema ? compatibleTemplates(schema.type) : [],
    locked: !access.ok,
    lockReason: access.ok ? null : access.reason,
    requiredPlan: required,
    requiredPlanName: PLANS[required].name,
  };
}

/** Éléments publiés (bibliothèque gratuite pour tous ; premium visibles mais verrouillés selon le plan). */
export async function listPublishedLibrary(planId: PlanId): Promise<LibraryItemDTO[]> {
  const rows = await db.sectionLibraryItem.findMany({ where: { published: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 300 });
  return rows.filter((r) => r.sectionType in SECTION_SCHEMAS).map((r) => toLibraryDTO(r, planId));
}

export type LibraryInsert = { ok: true; item: LibraryItemDTO; payload: SectionPayload; removedRefs: number } | { ok: false; error: string; requiredPlan?: PlanId };

/** Charge d'un élément pour une boutique, après contrôle d'accès du plan (côté serveur). */
export async function libraryItemForStore(storeId: string, planId: PlanId, itemId: string): Promise<LibraryInsert> {
  const item = await db.sectionLibraryItem.findFirst({ where: { id: itemId, published: true } });
  if (!item) return { ok: false, error: "Élément de bibliothèque introuvable." };
  const access = libraryAccess(item, planId);
  if (!access.ok) return { ok: false, error: `${access.reason} Changez de plan : /app/${storeId}/abonnement`, requiredPlan: access.requiredPlan };
  const checked = validateLibraryPayload(item.payload, isStoreMediaUrl);
  if (!checked.ok) return { ok: false, error: "Cet élément n'est plus compatible avec le thème. L'équipe Axi a été prévenue." };
  const { payload, removed } = await verifyPayloadRefs(storeId, checked.payload);
  return { ok: true, item: toLibraryDTO(item, planId), payload, removedRefs: removed };
}

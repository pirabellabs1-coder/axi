/**
 * Règles pures de la bibliothèque de sections de la plateforme (lot 4 §4, testé) :
 *  - accès : élément publié ; `minPlan` atteint ; élément premium = fonction `premiumSections` (Business et plus) ;
 *  - charge : section valide du moteur, AUCUNE référence d'identifiant (produit, collection) ni média d'une boutique ;
 *    les emplacements (collection à choisir, image…) sont remplis par le commerçant après insertion.
 */
import { z } from "zod";
import { PLANS, planRank, PLAN_ORDER, type PlanId } from "@/config/plans";
import { idReferences, storedMediaUrls, validateSectionPayload, type SectionPayload } from "@/lib/saved-sections/payload";

export type LibraryAccess = { ok: true } | { ok: false; reason: string; requiredPlan: PlanId };

/** Plan minimal effectif : un élément premium exige au moins le premier plan qui inclut `premiumSections`. */
export function effectiveMinPlan(item: { premium: boolean; minPlan: PlanId }): PlanId {
  if (!item.premium) return item.minPlan;
  const premiumPlan = PLAN_ORDER.find((p) => PLANS[p].features.premiumSections) ?? "BUSINESS";
  return planRank(item.minPlan) >= planRank(premiumPlan) ? item.minPlan : premiumPlan;
}

/** Contrôle d'insertion, côté serveur (jamais confié au client). */
export function libraryAccess(item: { premium: boolean; minPlan: PlanId; published: boolean }, planId: PlanId): LibraryAccess {
  const required = effectiveMinPlan(item);
  if (!item.published) return { ok: false, reason: "Cet élément n'est pas disponible.", requiredPlan: required };
  if (item.premium && !PLANS[planId].features.premiumSections) return { ok: false, reason: `Section premium : incluse à partir du plan ${PLANS[required].name}.`, requiredPlan: required };
  if (planRank(planId) < planRank(required)) return { ok: false, reason: `Section incluse à partir du plan ${PLANS[required].name}.`, requiredPlan: required };
  return { ok: true };
}

export type LibraryPayloadCheck = { ok: true; payload: SectionPayload } | { ok: false; errors: string[] };

/**
 * Valide une charge de bibliothèque (JSON déjà analysé). `isStoreMedia` : détecteur serveur des URL du stockage
 * objet (pilote S3 compris) ; par défaut, seuls `/media/…` et `data:` sont détectés.
 */
export function validateLibraryPayload(raw: unknown, isStoreMedia: (url: string) => boolean = () => false): LibraryPayloadCheck {
  const checked = validateSectionPayload(raw);
  if (!checked.ok) return checked;
  const refs = idReferences(checked.payload);
  if (refs.length) return { ok: false, errors: ["Aucune référence de produit ou de collection dans la bibliothèque : laissez ces réglages vides (le commerçant les choisira)."] };
  const media = storedMediaUrls(checked.payload);
  const extra: string[] = [];
  const visit = (v: unknown) => {
    if (typeof v === "string") {
      if (isStoreMedia(v)) extra.push(v);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(checked.payload.settings);
  checked.payload.blocks.forEach((b) => visit(b.settings));
  if (media.length || extra.length) return { ok: false, errors: ["Images : adresses https publiques uniquement (pas de média téléversé dans une boutique ni d'image intégrée)."] };
  return checked;
}

/** Analyse le JSON saisi dans la console (texte). */
export function parseLibraryJson(text: string, isStoreMedia?: (url: string) => boolean): LibraryPayloadCheck {
  if (text.length > 100_000) return { ok: false, errors: ["JSON trop volumineux (100 Ko maximum)."] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["JSON illisible : vérifiez les guillemets et les virgules."] };
  }
  return validateLibraryPayload(raw, isStoreMedia);
}

export const LIBRARY_CATEGORIES = ["Mise en avant", "Confiance", "Texte", "Médias", "Produits", "Contact", "Promotion"] as const;
export const LIBRARY_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const libraryItemSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(LIBRARY_SLUG_RE, "Identifiant : minuscules, chiffres et tirets (64 caractères maximum)."),
  name: z.string().trim().min(2, "Nom requis.").max(80, "Nom : 80 caractères maximum."),
  description: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().trim().max(300, "Description : 300 caractères maximum.").optional()),
  category: z.string().trim().min(2, "Catégorie requise.").max(40, "Catégorie : 40 caractères maximum."),
  tags: z
    .array(z.string().trim().min(1).max(30))
    .max(10, "10 mots-clés maximum.")
    .default([])
    .transform((t) => [...new Set(t.map((x) => x.toLowerCase()))]),
  premium: z.boolean().default(false),
  minPlan: z.enum(PLAN_ORDER as [PlanId, ...PlanId[]]).default("FREE"),
  payloadJson: z.string().min(2, "Section JSON requise."),
});
export type LibraryItemInput = z.input<typeof libraryItemSchema>;

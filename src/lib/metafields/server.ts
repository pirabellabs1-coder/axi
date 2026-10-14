import "server-only";
import type { MetafieldDefinition } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { PLANS, type PlanId } from "@/config/plans";
import { isOwnStoredMediaUrl } from "@/lib/storage/write-guard";
import { isMetafieldType, type MetafieldDefinitionDTO, type MetafieldOwnerType, type MetafieldValue } from "./types";
import { isEmptyInput, readValidations, referencedId, validateMetafieldValue } from "./validate";

/**
 * Cœur serveur des champs personnalisés : un SEUL chemin d'écriture des valeurs (`writeOwnerMetafields`),
 * utilisé par l'éditeur, l'outil MCP `set_metafield` et l'import CSV produit. Garanties :
 *  - propriétaire vérifié dans la boutique ; définitions de la boutique et du même type de propriétaire ;
 *  - valeur validée par type et par les validations ; références (produit, collection) de la même boutique ;
 *  - image : https ou média de CETTE boutique.
 */

export function toDefinitionDTO(d: MetafieldDefinition): MetafieldDefinitionDTO | null {
  if (!isMetafieldType(d.type)) return null;
  return {
    id: d.id,
    ownerType: d.ownerType,
    namespace: d.namespace,
    key: d.key,
    name: d.name,
    description: d.description,
    type: d.type,
    validations: readValidations(d.type, d.validations),
    storefrontVisible: d.storefrontVisible,
    pinnedPosition: d.pinnedPosition,
  };
}

/** Ordre d'affichage : épinglés (position croissante), puis les autres par nom. */
export function sortDefinitions<T extends { pinnedPosition: number | null; name: string }>(defs: T[]): T[] {
  return [...defs].sort((a, b) => {
    if (a.pinnedPosition !== null && b.pinnedPosition !== null) return a.pinnedPosition - b.pinnedPosition;
    if (a.pinnedPosition !== null) return -1;
    if (b.pinnedPosition !== null) return 1;
    return a.name.localeCompare(b.name, "fr");
  });
}

/* ───────────── Plan ───────────── */

export function metafieldsEnabled(planId: PlanId): boolean {
  return PLANS[planId].features.metafields;
}

/** Plafond de définitions du plan (null = illimité ; 0 = fonction absente). */
export function definitionLimit(planId: PlanId): number | null {
  return metafieldsEnabled(planId) ? PLANS[planId].limits.metafieldDefinitions : 0;
}

/** Message d'upsell (null = création autorisée). */
export function definitionQuotaIssue(planId: PlanId, used: number, storeId: string): string | null {
  if (!metafieldsEnabled(planId)) return `Les champs personnalisés sont inclus à partir du plan Starter. Changez de plan : /app/${storeId}/abonnement`;
  const max = definitionLimit(planId);
  if (max !== null && used >= max) return `Limite de votre plan atteinte : ${used} champs sur ${max}. Passez au plan supérieur pour en créer davantage : /app/${storeId}/abonnement`;
  return null;
}

/** Sérialise la création d'une définition par boutique (contrôle du quota sans course). */
export async function lockStoreDefinitions(tx: Tx, storeId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`metafield-defs:${storeId}`}))`;
}

/* ───────────── Propriétaires et références ───────────── */

/** Le propriétaire existe-t-il dans CETTE boutique ? */
export async function ownerExists(tx: Tx | typeof db, storeId: string, ownerType: MetafieldOwnerType, ownerId: string): Promise<boolean> {
  const where = { id: ownerId, storeId };
  switch (ownerType) {
    case "STORE":
      return ownerId === storeId;
    case "PRODUCT":
      return !!(await tx.product.findFirst({ where, select: { id: true } }));
    case "VARIANT":
      return !!(await tx.variant.findFirst({ where: { id: ownerId, product: { storeId } }, select: { id: true } }));
    case "COLLECTION":
      return !!(await tx.category.findFirst({ where, select: { id: true } }));
    case "CUSTOMER":
      return !!(await tx.customer.findFirst({ where, select: { id: true } }));
    case "ORDER":
      return !!(await tx.order.findFirst({ where, select: { id: true } }));
    case "PAGE":
      return !!(await tx.storePage.findFirst({ where, select: { id: true } }));
    case "BLOG_POST":
      return !!(await tx.blogPost.findFirst({ where, select: { id: true } }));
  }
}

async function referenceExists(tx: Tx | typeof db, storeId: string, ref: { kind: "product" | "collection"; id: string }): Promise<boolean> {
  if (ref.kind === "product") return !!(await tx.product.findFirst({ where: { id: ref.id, storeId }, select: { id: true } }));
  return !!(await tx.category.findFirst({ where: { id: ref.id, storeId }, select: { id: true } }));
}

/* ───────────── Écriture ───────────── */

export type MetafieldEntry = { definitionId: string; value: unknown };
export type WriteResult = { errors: Record<string, string>; written: number; deleted: number };

/**
 * Écrit (upsert) ou supprime (valeur vide) les valeurs d'un propriétaire. Tout ou rien : si une valeur est invalide,
 * rien n'est écrit et `errors` (par identifiant de définition) est renseigné. Le propriétaire doit avoir été vérifié
 * par l'appelant (`ownerExists`) ; il est revérifié ici par défense en profondeur.
 */
export async function writeOwnerMetafields(
  tx: Tx,
  input: { storeId: string; currency: string; ownerType: MetafieldOwnerType; ownerId: string; entries: MetafieldEntry[] },
): Promise<WriteResult> {
  const { storeId, ownerType, ownerId } = input;
  const result: WriteResult = { errors: {}, written: 0, deleted: 0 };
  if (!input.entries.length) return result;
  if (!(await ownerExists(tx, storeId, ownerType, ownerId))) {
    result.errors._owner = "Élément introuvable dans votre boutique.";
    return result;
  }
  const ids = [...new Set(input.entries.map((e) => e.definitionId))];
  const defs = await tx.metafieldDefinition.findMany({ where: { storeId, ownerType, id: { in: ids } } });
  const byId = new Map(defs.map((d) => [d.id, d]));

  const ops: { def: MetafieldDefinition; value: MetafieldValue | null }[] = [];
  for (const e of input.entries) {
    const def = byId.get(e.definitionId);
    const dto = def ? toDefinitionDTO(def) : null;
    if (!def || !dto) {
      result.errors[e.definitionId] = "Champ inconnu pour cet élément.";
      continue;
    }
    if (isEmptyInput(e.value)) {
      ops.push({ def, value: null });
      continue;
    }
    const checked = validateMetafieldValue(dto, e.value, { currency: input.currency });
    if (!checked.ok) {
      result.errors[def.id] = checked.error;
      continue;
    }
    if (dto.type === "image") {
      const url = (checked.value as { url: string }).url;
      if (!url.startsWith("https://") && !isOwnStoredMediaUrl(url, storeId)) {
        result.errors[def.id] = "Cette image n'appartient pas à votre boutique : importez-la à nouveau.";
        continue;
      }
    }
    const ref = referencedId(dto.type, checked.value);
    if (ref && !(await referenceExists(tx, storeId, ref))) {
      result.errors[def.id] = ref.kind === "product" ? "Produit introuvable dans votre boutique." : "Collection introuvable dans votre boutique.";
      continue;
    }
    ops.push({ def, value: checked.value });
  }
  if (Object.keys(result.errors).length) return result;

  for (const { def, value } of ops) {
    if (value === null) {
      const r = await tx.metafieldValue.deleteMany({ where: { storeId, definitionId: def.id, ownerId } });
      result.deleted += r.count;
    } else {
      const json = value as Prisma.InputJsonValue;
      await tx.metafieldValue.upsert({
        where: { definitionId_ownerId: { definitionId: def.id, ownerId } },
        create: { storeId, definitionId: def.id, ownerType, ownerId, value: json },
        update: { value: json },
      });
      result.written++;
    }
  }
  return result;
}

/** Erreur Prisma de contrainte d'unicité. */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

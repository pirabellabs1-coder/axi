"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireStore, type Capability } from "@/lib/auth/permissions";
import { guard, fail, success, zRawId, type ActionResult } from "@/lib/action";
import { METAFIELD_OWNERS, type MetafieldOwnerType } from "./types";
import { definitionInputSchema, definitionUpdateSchema, effectiveStorefrontVisible, normalizeValidations } from "./validate";
import { definitionQuotaIssue, isUniqueViolation, lockStoreDefinitions, metafieldsEnabled, ownerExists, writeOwnerMetafields } from "./server";

/**
 * Actions des champs personnalisés (lot 4 §5).
 *  - Définitions : capacité `theme.manage` (personnalisation, lot 4), plan `metafields` + quota `metafieldDefinitions`.
 *  - Valeurs : capacité du propriétaire (produit → products.manage, client → customers.manage…), même boutique.
 */

/** Capacité requise pour modifier les valeurs d'un type de propriétaire. */
const VALUE_CAPABILITY: Record<MetafieldOwnerType, Capability> = {
  PRODUCT: "products.manage",
  VARIANT: "products.manage",
  COLLECTION: "products.manage",
  CUSTOMER: "customers.manage",
  ORDER: "orders.manage",
  STORE: "store.settings",
  PAGE: "store.settings",
  BLOG_POST: "store.settings",
};

const OWNER_PATH: Partial<Record<MetafieldOwnerType, (id: string) => string>> = {
  PRODUCT: (id) => `produits/${id}`,
  COLLECTION: (id) => `collections/${id}`,
  CUSTOMER: (id) => `clients/${id}`,
  ORDER: (id) => `commandes/${id}`,
  PAGE: (id) => `pages/${id}`,
};

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of error.issues) (out[String(i.path[0] ?? "form")] ??= []).push(i.message);
  return out;
}

function revalidateDefinitions(storeId: string, slug: string) {
  revalidatePath(`/app/${storeId}/parametres/champs`);
  revalidatePath(`/s/${slug}`, "layout");
}

/* ───────────── Définitions ───────────── */

export async function createMetafieldDefinition(storeId: string, input: z.input<typeof definitionInputSchema>): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const bad = zRawId.safeParse(storeId);
    if (!bad.success) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "theme.manage");
    const parsed = definitionInputSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Formulaire invalide", fieldErrorsOf(parsed.error));
    const d = parsed.data;
    const validations = normalizeValidations(d.type, d.validations);
    if (!validations.ok) return fail(validations.error, { validations: [validations.error] });
    const storefrontVisible = effectiveStorefrontVisible(d.ownerType, d.storefrontVisible);

    const res = await db.$transaction(async (tx) => {
      await lockStoreDefinitions(tx, ctx.store.id);
      const used = await tx.metafieldDefinition.count({ where: { storeId: ctx.store.id } });
      const quota = definitionQuotaIssue(ctx.planId, used, ctx.store.id);
      if (quota) return { error: quota } as const;
      const clash = await tx.metafieldDefinition.findFirst({ where: { storeId: ctx.store.id, ownerType: d.ownerType, namespace: d.namespace, key: d.key }, select: { id: true } });
      if (clash) return { error: "dup" } as const;
      const pinnedPosition = d.pinned ? (await tx.metafieldDefinition.count({ where: { storeId: ctx.store.id, ownerType: d.ownerType, pinnedPosition: { not: null } } })) : null;
      const def = await tx.metafieldDefinition.create({
        data: {
          storeId: ctx.store.id,
          ownerType: d.ownerType,
          namespace: d.namespace,
          key: d.key,
          name: d.name,
          description: d.description ?? null,
          type: d.type,
          validations: Object.keys(validations.value).length ? (validations.value as Prisma.InputJsonValue) : Prisma.DbNull,
          storefrontVisible,
          pinnedPosition,
        },
      });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "metafield.definition.create", target: def.id, metadata: { ownerType: d.ownerType, key: `${d.namespace}.${d.key}`, type: d.type, storefrontVisible } }, tx);
      return { id: def.id } as const;
    }).catch((e) => {
      if (isUniqueViolation(e)) return { error: "dup" } as const;
      throw e;
    });
    if ("error" in res) {
      if (res.error === "dup") return fail(`La clé ${d.namespace}.${d.key} existe déjà pour ce type d'élément.`, { key: ["Clé déjà utilisée."] });
      return fail(res.error ?? "Une erreur est survenue. Réessayez.");
    }
    revalidateDefinitions(ctx.store.id, ctx.store.slug);
    return success({ id: res.id }, `Champ « ${d.name} » créé`);
  });
}

export async function updateMetafieldDefinition(storeId: string, id: string, input: z.input<typeof definitionUpdateSchema>): Promise<ActionResult> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(id).success) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "theme.manage");
    if (!metafieldsEnabled(ctx.planId)) return fail(`Les champs personnalisés sont inclus à partir du plan Starter : /app/${ctx.store.id}/abonnement`);
    const parsed = definitionUpdateSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Formulaire invalide", fieldErrorsOf(parsed.error));
    const def = await db.metafieldDefinition.findFirst({ where: { id, storeId: ctx.store.id } });
    if (!def) return fail("Champ introuvable");
    const type = def.type as Parameters<typeof normalizeValidations>[0];
    const validations = normalizeValidations(type, parsed.data.validations);
    if (!validations.ok) return fail(validations.error, { validations: [validations.error] });
    const storefrontVisible = effectiveStorefrontVisible(def.ownerType, parsed.data.storefrontVisible);
    await db.$transaction(async (tx) => {
      await tx.metafieldDefinition.update({
        where: { id: def.id },
        data: {
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          validations: Object.keys(validations.value).length ? (validations.value as Prisma.InputJsonValue) : Prisma.DbNull,
          storefrontVisible,
        },
      });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "metafield.definition.update", target: def.id, metadata: { key: `${def.namespace}.${def.key}`, storefrontVisible } }, tx);
    });
    revalidateDefinitions(ctx.store.id, ctx.store.slug);
    return success(undefined, "Champ mis à jour");
  });
}

/** Supprime la définition ET toutes ses valeurs (cascade). Les sources dynamiques qui la citent retombent sur leur défaut. */
export async function deleteMetafieldDefinition(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(id).success) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "theme.manage");
    const def = await db.metafieldDefinition.findFirst({ where: { id, storeId: ctx.store.id } });
    if (!def) return fail("Champ introuvable");
    await db.$transaction(async (tx) => {
      const values = await tx.metafieldValue.count({ where: { storeId: ctx.store.id, definitionId: def.id } });
      await tx.metafieldValue.deleteMany({ where: { storeId: ctx.store.id, definitionId: def.id } });
      await tx.metafieldDefinition.deleteMany({ where: { id: def.id, storeId: ctx.store.id } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "metafield.definition.delete", target: def.id, metadata: { key: `${def.namespace}.${def.key}`, ownerType: def.ownerType, values } }, tx);
    });
    revalidateDefinitions(ctx.store.id, ctx.store.slug);
    return success(undefined, `Champ « ${def.name} » supprimé`);
  });
}

/** Épingle (fin de liste) ou désépingle ; `move` déplace un champ épinglé d'un cran. */
export async function setMetafieldDefinitionPin(storeId: string, id: string, op: "pin" | "unpin" | "up" | "down"): Promise<ActionResult> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(id).success) return fail("Identifiant invalide");
    if (!["pin", "unpin", "up", "down"].includes(op)) return fail("Opération inconnue");
    const ctx = await requireStore(storeId, "theme.manage");
    const def = await db.metafieldDefinition.findFirst({ where: { id, storeId: ctx.store.id } });
    if (!def) return fail("Champ introuvable");
    await db.$transaction(async (tx) => {
      await lockStoreDefinitions(tx, ctx.store.id);
      const pinned = (await tx.metafieldDefinition.findMany({ where: { storeId: ctx.store.id, ownerType: def.ownerType, pinnedPosition: { not: null } }, select: { id: true, pinnedPosition: true }, orderBy: { pinnedPosition: "asc" } }))
        .sort((a, b) => (a.pinnedPosition ?? 0) - (b.pinnedPosition ?? 0))
        .map((p) => p.id);
      let order = pinned.filter((x) => x !== def.id);
      if (op === "pin" || ((op === "up" || op === "down") && pinned.includes(def.id))) {
        const at = pinned.indexOf(def.id);
        const target = op === "pin" ? (at >= 0 ? at : order.length) : Math.max(0, Math.min(order.length, at + (op === "up" ? -1 : 1)));
        order = [...order.slice(0, target), def.id, ...order.slice(target)];
      }
      for (const [i, pid] of order.entries()) await tx.metafieldDefinition.updateMany({ where: { id: pid, storeId: ctx.store.id }, data: { pinnedPosition: i } });
      if (!order.includes(def.id)) await tx.metafieldDefinition.updateMany({ where: { id: def.id, storeId: ctx.store.id }, data: { pinnedPosition: null } });
    });
    revalidateDefinitions(ctx.store.id, ctx.store.slug);
    return success(undefined, op === "unpin" ? "Champ désépinglé" : op === "pin" ? "Champ épinglé" : "Ordre mis à jour");
  });
}

/* ───────────── Valeurs ───────────── */

const valuesSchema = z.object({
  ownerType: z.enum(METAFIELD_OWNERS),
  ownerId: zRawId,
  values: z.record(zRawId, z.unknown()).refine((v) => Object.keys(v).length <= 200, "Trop de champs."),
});

/**
 * Enregistre les valeurs d'un élément (produit, collection, page, client…). `values` : { [definitionId]: valeur } ;
 * valeur vide (null, "", []) = suppression. Tout ou rien ; erreurs par champ dans `fieldErrors[definitionId]`.
 */
export async function saveMetafieldValues(storeId: string, input: z.input<typeof valuesSchema>): Promise<ActionResult<{ written: number; deleted: number }>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success) return fail("Identifiant invalide");
    const parsed = valuesSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const { ownerType, ownerId, values } = parsed.data;
    const ctx = await requireStore(storeId, VALUE_CAPABILITY[ownerType]);
    if (!metafieldsEnabled(ctx.planId)) return fail(`Les champs personnalisés sont inclus à partir du plan Starter : /app/${ctx.store.id}/abonnement`);
    if (!(await ownerExists(db, ctx.store.id, ownerType, ownerId))) return fail("Élément introuvable dans votre boutique");
    const entries = Object.entries(values).map(([definitionId, value]) => ({ definitionId, value }));

    const res = await db.$transaction(async (tx) => {
      const r = await writeOwnerMetafields(tx, { storeId: ctx.store.id, currency: ctx.store.currency, ownerType, ownerId, entries });
      if (Object.keys(r.errors).length) throw new ValuesError(r.errors);
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "metafield.values.update", target: `${ownerType}:${ownerId}`, metadata: { definitions: entries.map((e) => e.definitionId), written: r.written, deleted: r.deleted } }, tx);
      return r;
    }).catch((e) => {
      if (e instanceof ValuesError) return e;
      throw e;
    });
    if (res instanceof ValuesError) {
      const first = Object.values(res.errors)[0] ?? "Valeur invalide";
      return fail(first, Object.fromEntries(Object.entries(res.errors).map(([k, v]) => [k, [v]])));
    }
    const path = OWNER_PATH[ownerType]?.(ownerId);
    if (path) revalidatePath(`/app/${ctx.store.id}/${path}`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success({ written: res.written, deleted: res.deleted }, "Champs personnalisés enregistrés");
  });
}

/** Erreur interne : annule la transaction quand une valeur est invalide (tout ou rien). */
class ValuesError extends Error {
  constructor(public errors: Record<string, string>) {
    super("metafield values invalid");
  }
}

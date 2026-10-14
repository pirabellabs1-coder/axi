"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { guard, fail, success, badIds, zId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import { imageUrlSchema } from "@/lib/products/schemas";
import { checkImageWrite } from "@/lib/storage/write-guard";
import { mergeArchivedMembers, readRules, rulesSchema, SORT_ORDERS } from "./rules";
import { lockStoreCategories } from "./service";
import { mergeCollectionOrder } from "./order";

const collectionSchema = z.object({
  id: zId.optional(),
  name: z.string().trim().min(1, "Titre requis").max(60, "60 caractères maximum"),
  slug: z.string().trim().max(80).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  // Une ancienne data-URL passe la validation de forme, puis n'est conservée que si elle est identique à la valeur
  // en base (checkImageWrite) ; toute autre image doit être https ou un média téléversé de la boutique.
  imageUrl: z
    .string()
    .max(600_000)
    .refine((u) => u.startsWith("data:") || imageUrlSchema.safeParse(u).success, "URL d'image invalide (https ou image téléversée)")
    .nullish()
    .transform((v) => v ?? null),
  seoTitle: z.string().trim().max(70).nullish().transform((v) => v || null),
  seoDescription: z.string().trim().max(320).nullish().transform((v) => v || null),
  published: z.boolean().default(true),
  sortOrder: z.enum(SORT_ORDERS).default("manual"),
  rules: rulesSchema,
});

export type CollectionInput = z.input<typeof collectionSchema>;

function revalidateCollections(ctx: StoreContext, id?: string) {
  revalidatePath(`/app/${ctx.store.id}/collections`);
  if (id) revalidatePath(`/app/${ctx.store.id}/collections/${id}`);
  revalidatePath(`/app/${ctx.store.id}/produits`);
  revalidatePath(`/s/${ctx.store.slug}`, "layout");
}

export async function saveCollection(storeId: string, input: CollectionInput): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const bad = badIds(storeId);
    if (bad) return bad;
    const parsed = collectionSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const fieldErrors: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (fieldErrors[String(i.path[0] ?? "_")] ??= []).push(i.message);
      return fail(first?.message ?? "Formulaire invalide", fieldErrors);
    }
    const d = parsed.data;
    const ctx = await requireStore(storeId, "products.manage");
    const sid = ctx.store.id;
    const slug = slugify(d.slug || d.name) || "collection";
    if (d.imageUrl) {
      const current = d.id ? await db.category.findFirst({ where: { id: d.id, storeId: sid }, select: { imageUrl: true } }) : null;
      const imageIssue = checkImageWrite(d.imageUrl, { storeId: sid, existing: [current?.imageUrl] });
      if (imageIssue) return fail(imageIssue, { imageUrl: [imageIssue] });
    }
    const clash = await db.category.findFirst({ where: { storeId: sid, slug, ...(d.id ? { id: { not: d.id } } : {}) }, select: { id: true } });
    if (clash) return fail("Une collection utilise déjà cette adresse.", { slug: ["Adresse déjà utilisée"] });

    let rules: Prisma.InputJsonValue = d.rules as unknown as Prisma.InputJsonValue;
    if (d.rules.type === "manual") {
      // Uniquement des produits de la boutique, sans doublon, dans l'ordre fourni.
      const ids = [...new Set(d.rules.productIds)];
      const valid = ids.length ? new Set((await db.product.findMany({ where: { storeId: sid, id: { in: ids } }, select: { id: true } })).map((p) => p.id)) : new Set<string>();
      rules = { type: "manual", productIds: ids.filter((id) => valid.has(id)) };
    }
    const data = {
      name: d.name,
      slug,
      description: d.description || null,
      imageUrl: d.imageUrl,
      seoTitle: d.seoTitle,
      seoDescription: d.seoDescription,
      published: d.published,
      sortOrder: d.sortOrder === "manual" && d.rules.type === "auto" ? "newest" : d.sortOrder,
      rules,
    };
    let id: string;
    if (d.id) {
      const colId = d.id;
      const found = await db.$transaction(async (tx) => {
        // Verrou des collections : la liste productIds n'est pas écrasée par un enregistrement concurrent.
        await lockStoreCategories(tx, sid);
        const existing = await tx.category.findFirst({ where: { id: colId, storeId: sid }, select: { id: true, rules: true } });
        if (!existing) return false;
        if (d.rules.type === "manual") {
          // L'éditeur ne montre pas les produits archivés : leurs adhésions existantes sont conservées.
          const prev = readRules(existing.rules);
          const prevIds = prev.type === "manual" ? prev.productIds : [];
          const archived = prevIds.length ? new Set((await tx.product.findMany({ where: { storeId: sid, id: { in: prevIds }, status: "ARCHIVED" }, select: { id: true } })).map((p) => p.id)) : new Set<string>();
          const keep = mergeArchivedMembers((rules as { productIds: string[] }).productIds, prevIds, archived);
          await tx.category.update({ where: { id: colId }, data: { ...data, rules: { type: "manual", productIds: keep } } });
          // Collection manuelle : les produits retirés de la liste perdent aussi leur catégorie principale (archivés exclus).
          await tx.product.updateMany({ where: { storeId: sid, categoryId: colId, status: { not: "ARCHIVED" }, id: { notIn: keep } }, data: { categoryId: null } });
        } else {
          await tx.category.update({ where: { id: colId }, data });
          await tx.product.updateMany({ where: { storeId: sid, categoryId: colId }, data: { categoryId: null } });
        }
        return true;
      });
      if (!found) return fail("Collection introuvable");
      id = colId;
    } else {
      const count = await db.category.count({ where: { storeId: sid } });
      if (count >= 100) return fail("100 collections maximum");
      id = (await db.category.create({ data: { ...data, storeId: sid, position: count } })).id;
    }
    await audit({ storeId: sid, actorId: ctx.user.id, action: d.id ? "collection.updated" : "collection.created", target: id, metadata: { type: d.rules.type } });
    revalidateCollections(ctx, id);
    return success({ id }, d.id ? "Collection enregistrée" : "Collection créée");
  });
}

export async function deleteCollection(storeId: string, collectionId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, collectionId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "products.manage");
    const r = await db.category.deleteMany({ where: { id: collectionId, storeId: ctx.store.id } });
    if (r.count === 0) return fail("Collection introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "collection.deleted", target: collectionId });
    revalidateCollections(ctx);
    return success(undefined, "Collection supprimée, les produits sont conservés");
  });
}

/** Collection manuelle : remplace la liste ordonnée des produits. */
export async function setCollectionProducts(storeId: string, collectionId: string, productIds: string[]): Promise<ActionResult<{ count: number }>> {
  return guard(async () => {
    const bad = badIds(storeId, collectionId);
    if (bad) return bad;
    const ids = z.array(zId).max(5000).safeParse(productIds);
    if (!ids.success) return fail("Liste de produits invalide");
    const ctx = await requireStore(storeId, "products.manage");
    const sid = ctx.store.id;
    const unique = [...new Set(ids.data)];
    const valid = new Set((await db.product.findMany({ where: { storeId: sid, id: { in: unique } }, select: { id: true } })).map((p) => p.id));
    const r = await db.$transaction(async (tx): Promise<{ error: string } | { list: string[] }> => {
      await lockStoreCategories(tx, sid);
      const col = await tx.category.findFirst({ where: { id: collectionId, storeId: sid }, select: { id: true, rules: true } });
      if (!col) return { error: "Collection introuvable" };
      const prev = readRules(col.rules);
      if (prev.type !== "manual") return { error: "Collection automatique : modifiez ses conditions." };
      const archived = prev.productIds.length ? new Set((await tx.product.findMany({ where: { storeId: sid, id: { in: prev.productIds }, status: "ARCHIVED" }, select: { id: true } })).map((p) => p.id)) : new Set<string>();
      const list = mergeArchivedMembers(unique.filter((id) => valid.has(id)), prev.productIds, archived);
      await tx.category.update({ where: { id: col.id }, data: { rules: { type: "manual", productIds: list } } });
      await tx.product.updateMany({ where: { storeId: sid, categoryId: col.id, status: { not: "ARCHIVED" }, id: { notIn: list } }, data: { categoryId: null } });
      return { list };
    });
    if ("error" in r) return fail(r.error);
    revalidateCollections(ctx, collectionId);
    return success({ count: r.list.length }, "Produits de la collection enregistrés");
  });
}

export async function reorderCollections(storeId: string, orderedIds: string[]): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId);
    if (bad) return bad;
    const parsedIds = z.array(zId).max(500).safeParse(orderedIds);
    if (!parsedIds.success) return fail("Liste de collections invalide");
    const ids = parsedIds.data;
    const ctx = await requireStore(storeId, "products.manage");
    // Positions 0..n-1 sur TOUTES les collections de la boutique : ids inconnus ignorés, oubliées conservées à la suite.
    const current = await db.category.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true } });
    const order = mergeCollectionOrder(ids, current.map((c) => c.id));
    await db.$transaction(order.map((id, i) => db.category.updateMany({ where: { id, storeId: ctx.store.id }, data: { position: i } })));
    revalidateCollections(ctx);
    return success(undefined, "Ordre enregistré");
  });
}

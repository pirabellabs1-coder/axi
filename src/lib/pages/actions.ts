"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zOptionalString, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";
import { slugify } from "@/lib/utils";
import { PAGE_BODY_MAX, RESERVED_PAGE_SLUGS } from "./constants";

function revalidate(storeId: string, slug: string) {
  revalidatePath(`/app/${storeId}/pages`);
  revalidatePath(`/s/${slug}`, "layout");
}

const schema = z.object({
  storeId: z.string().min(1),
  pageId: zOptionalString,
  title: z.string().trim().min(2, "Titre requis").max(80, "80 caractères maximum"),
  slug: zOptionalString,
  body: z.string().max(PAGE_BODY_MAX, `${PAGE_BODY_MAX.toLocaleString("fr-FR")} caractères maximum`).default(""),
  published: zBool,
});

export async function savePage(_prev: ActionResult<{ id: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return guard<{ id: string }>(async () => {
    const parsed = parseForm(schema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    const d = parsed.data;
    const slug = slugify(d.slug || d.title);
    if (slug.length < 2) return fail("Adresse invalide", { slug: ["2 caractères minimum : lettres, chiffres, tirets"] });
    if (RESERVED_PAGE_SLUGS.includes(slug)) return fail("Cette adresse est réservée", { slug: ["Adresse réservée par la boutique, choisissez-en une autre"] });

    const limit = PLANS[ctx.planId].limits.customPages;
    if (!d.pageId) {
      const count = await db.storePage.count({ where: { storeId: ctx.store.id } });
      if (limit !== null && count >= limit) {
        return fail(limit === 0 ? `Les pages personnalisées sont incluses à partir du plan Starter. Changez de plan : /app/${ctx.store.id}/abonnement` : `Votre plan inclut ${limit} pages. Passez au plan Business pour des pages illimitées.`);
      }
    }

    try {
      let page;
      if (d.pageId) {
        const existing = await db.storePage.findFirst({ where: { id: d.pageId, storeId: ctx.store.id }, select: { id: true } });
        if (!existing) return fail("Page introuvable");
        page = await db.storePage.update({ where: { id: existing.id }, data: { title: d.title, slug, body: d.body, published: d.published } });
      } else {
        const last = await db.storePage.aggregate({ where: { storeId: ctx.store.id }, _max: { position: true } });
        page = await db.storePage.create({ data: { storeId: ctx.store.id, title: d.title, slug, body: d.body, published: d.published, position: (last._max.position ?? -1) + 1 } });
      }
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: d.pageId ? "page.updated" : "page.created", target: page.id, metadata: { slug, published: d.published } });
      revalidate(ctx.store.id, ctx.store.slug);
      return success({ id: page.id }, d.pageId ? "Page enregistrée" : "Page créée");
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("Une autre page utilise déjà cette adresse", { slug: ["Adresse déjà utilisée"] });
      throw e;
    }
  });
}

export async function setPagePublished(storeId: string, pageId: string, published: boolean): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    const r = await db.storePage.updateMany({ where: { id: pageId, storeId: ctx.store.id }, data: { published } });
    if (r.count === 0) return fail("Page introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: published ? "page.published" : "page.unpublished", target: pageId });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, published ? "Page publiée" : "Page masquée");
  });
}

export async function movePage(storeId: string, pageId: string, direction: "up" | "down"): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    const pages = await db.storePage.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ position: "asc" }, { title: "asc" }], select: { id: true } });
    const i = pages.findIndex((p) => p.id === pageId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= pages.length) return success();
    [pages[i], pages[j]] = [pages[j]!, pages[i]!];
    await db.$transaction(pages.map((p, position) => db.storePage.update({ where: { id: p.id }, data: { position } })));
    revalidate(ctx.store.id, ctx.store.slug);
    return success();
  });
}

export async function deletePage(storeId: string, pageId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    const r = await db.storePage.deleteMany({ where: { id: pageId, storeId: ctx.store.id } });
    if (r.count === 0) return fail("Page introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "page.deleted", target: pageId });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Page supprimée");
  });
}

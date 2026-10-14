"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdminPermission } from "@/lib/admin/context";
import { guard, fail, success, zRawId, type ActionResult } from "@/lib/action";
import { storeImage, InvalidImageError } from "@/lib/storage";
import { libraryItemSchema, parseLibraryJson, type LibraryItemInput } from "./rules";
import { isStoreMediaUrl, LIBRARY_MEDIA_NAMESPACE } from "./service";

/**
 * Console /admin/bibliotheque : permission plateforme `settings.manage`, audit `admin.library.*`.
 * Charge : section JSON validée par le moteur, sans référence d'identifiant ni média de boutique.
 */

const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of error.issues) (out[String(i.path[0] ?? "form")] ??= []).push(i.message);
  return out;
}

function revalidateLibrary() {
  revalidatePath("/admin/bibliotheque");
}

function parseItem(input: LibraryItemInput): { data: z.output<typeof libraryItemSchema>; payload: Prisma.InputJsonValue } | { error: ActionResult<never> } {
  const parsed = libraryItemSchema.safeParse(input);
  if (!parsed.success) return { error: fail(parsed.error.issues[0]?.message ?? "Formulaire invalide", fieldErrorsOf(parsed.error)) };
  const checked = parseLibraryJson(parsed.data.payloadJson, isStoreMediaUrl);
  if (!checked.ok) return { error: fail(checked.errors[0] ?? "Section invalide", { payloadJson: checked.errors }) };
  return { data: parsed.data, payload: checked.payload as unknown as Prisma.InputJsonValue };
}

export async function createLibraryItem(input: LibraryItemInput): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    const p = parseItem(input);
    if ("error" in p) return p.error;
    const { data, payload } = p;
    const sectionType = (payload as { type: string }).type;
    try {
      const id = await db.$transaction(async (tx) => {
        const last = await tx.sectionLibraryItem.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
        const row = await tx.sectionLibraryItem.create({
          data: { slug: data.slug, name: data.name, description: data.description ?? null, category: data.category, tags: data.tags, premium: data.premium, minPlan: data.minPlan, sectionType, payload, published: false, position: (last?.position ?? -1) + 1 },
        });
        await audit({ actorId: user.id, action: "admin.library.create", target: row.id, metadata: { slug: data.slug, sectionType, premium: data.premium, minPlan: data.minPlan } }, tx);
        return row.id;
      });
      revalidateLibrary();
      return success({ id }, `« ${data.name} » ajouté (non publié)`);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("Cet identifiant est déjà utilisé.", { slug: ["Identifiant déjà utilisé."] });
      throw e;
    }
  });
}

export async function updateLibraryItem(id: string, input: LibraryItemInput): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    if (!zRawId.safeParse(id).success) return fail("Identifiant invalide");
    const p = parseItem(input);
    if ("error" in p) return p.error;
    const { data, payload } = p;
    const sectionType = (payload as { type: string }).type;
    const existing = await db.sectionLibraryItem.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return fail("Élément introuvable");
    try {
      await db.$transaction(async (tx) => {
        await tx.sectionLibraryItem.update({ where: { id }, data: { slug: data.slug, name: data.name, description: data.description ?? null, category: data.category, tags: data.tags, premium: data.premium, minPlan: data.minPlan, sectionType, payload } });
        await audit({ actorId: user.id, action: "admin.library.update", target: id, metadata: { slug: data.slug, sectionType, premium: data.premium, minPlan: data.minPlan } }, tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("Cet identifiant est déjà utilisé.", { slug: ["Identifiant déjà utilisé."] });
      throw e;
    }
    revalidateLibrary();
    return success(undefined, "Élément mis à jour");
  });
}

export async function setLibraryItemPublished(id: string, published: boolean): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    if (!zRawId.safeParse(id).success || typeof published !== "boolean") return fail("Données invalides");
    const item = await db.sectionLibraryItem.findUnique({ where: { id } });
    if (!item) return fail("Élément introuvable");
    if (published) {
      // Revalidation à la publication : le moteur a pu évoluer depuis la création.
      const checked = parseLibraryJson(JSON.stringify(item.payload), isStoreMediaUrl);
      if (!checked.ok) return fail(`Publication impossible : ${checked.errors[0] ?? "section invalide"}`);
    }
    await db.$transaction(async (tx) => {
      await tx.sectionLibraryItem.update({ where: { id }, data: { published } });
      await audit({ actorId: user.id, action: published ? "admin.library.publish" : "admin.library.unpublish", target: id, metadata: { slug: item.slug } }, tx);
    });
    revalidateLibrary();
    return success(undefined, published ? `« ${item.name} » publié` : `« ${item.name} » retiré de la bibliothèque`);
  });
}

/** Déplace l'élément d'un cran (positions renumérotées 0..n-1). */
export async function moveLibraryItem(id: string, direction: "up" | "down"): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    if (!zRawId.safeParse(id).success || (direction !== "up" && direction !== "down")) return fail("Données invalides");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"section-library:order"}))`;
      const rows = await tx.sectionLibraryItem.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
      const ids = rows.map((r) => r.id);
      const at = ids.indexOf(id);
      if (at < 0) return;
      const to = direction === "up" ? at - 1 : at + 1;
      if (to < 0 || to >= ids.length) return;
      [ids[at], ids[to]] = [ids[to], ids[at]];
      for (const [i, rid] of ids.entries()) await tx.sectionLibraryItem.update({ where: { id: rid }, data: { position: i } });
      await audit({ actorId: user.id, action: "admin.library.reorder", target: id, metadata: { direction, position: to } }, tx);
    });
    revalidateLibrary();
    return success(undefined, "Ordre mis à jour");
  });
}

export async function deleteLibraryItem(id: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    if (!zRawId.safeParse(id).success) return fail("Identifiant invalide");
    const item = await db.sectionLibraryItem.findUnique({ where: { id }, select: { id: true, slug: true, name: true } });
    if (!item) return fail("Élément introuvable");
    await db.$transaction(async (tx) => {
      await tx.sectionLibraryItem.delete({ where: { id } });
      await audit({ actorId: user.id, action: "admin.library.delete", target: id, metadata: { slug: item.slug } }, tx);
    });
    revalidateLibrary();
    return success(undefined, `« ${item.name} » supprimé`);
  });
}

/**
 * Aperçu (image statique) : fichier envoyé en FormData (`file`), 2 Mo maximum, format vérifié par les octets,
 * stocké sous `stores/axilibrary/…` (stockage objet). `remove=1` retire l'aperçu.
 */
export async function setLibraryItemPreview(id: string, formData: FormData): Promise<ActionResult<{ previewUrl: string | null }>> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    if (!zRawId.safeParse(id).success) return fail("Identifiant invalide");
    const item = await db.sectionLibraryItem.findUnique({ where: { id }, select: { id: true, slug: true } });
    if (!item) return fail("Élément introuvable");
    let previewUrl: string | null = null;
    if (formData.get("remove") !== "1") {
      const file = formData.get("file");
      if (!(file instanceof Blob) || file.size === 0) return fail("Choisissez une image.");
      if (file.size > PREVIEW_MAX_BYTES) return fail("Image trop lourde : 2 Mo maximum.");
      try {
        const stored = await storeImage(LIBRARY_MEDIA_NAMESPACE, new Uint8Array(await file.arrayBuffer()));
        previewUrl = stored.url;
      } catch (e) {
        if (e instanceof InvalidImageError) return fail(e.message);
        throw e;
      }
    }
    await db.$transaction(async (tx) => {
      await tx.sectionLibraryItem.update({ where: { id }, data: { previewUrl } });
      await audit({ actorId: user.id, action: "admin.library.preview", target: id, metadata: { slug: item.slug, removed: previewUrl === null } }, tx);
    });
    revalidateLibrary();
    return success({ previewUrl }, previewUrl ? "Aperçu enregistré" : "Aperçu retiré");
  });
}

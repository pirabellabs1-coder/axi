"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireStore } from "@/lib/auth/permissions";
import { guard, fail, success, zRawId, type ActionResult } from "@/lib/action";
import { checkImageWrite } from "@/lib/storage/write-guard";
import { compatibleTemplates, validateSectionPayload, type SectionPayload } from "./payload";
import { verifyPayloadRefs } from "./refs";
import { savedSectionQuotaIssue, savedSectionsEnabled, savedSectionLimit, toSavedSectionDTO, type SavedSectionDTO } from "./rules";

/**
 * Sections enregistrées (lot 4 §4), appelées par l'éditeur de thème (équipe T2). Capacité `theme.manage`.
 * Plan : Starter 20, Business et plus illimité (`features.savedSections`, `limits.savedSections`).
 * Contrat : docs/vague2/D-donnees.md.
 */

const MAX_PAYLOAD_BYTES = 200_000;
const zName = z.string().trim().min(1, "Nom requis.").max(60, "Nom : 60 caractères maximum.");

function revalidateEditor(storeId: string) {
  revalidatePath(`/app/${storeId}/apparence`, "layout");
}

async function lockSavedSections(tx: Prisma.TransactionClient, storeId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`saved-sections:${storeId}`}))`;
}

/**
 * Enregistre une section du brouillon (SectionInstance de l'éditeur ; ses identifiants sont ignorés).
 * Validation stricte, références absentes retirées, nom unique par boutique (sans tenir compte de la casse).
 */
export async function saveSection(storeId: string, input: { name: string; section: unknown }): Promise<ActionResult<{ id: string; name: string; removedRefs: number }>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "theme.manage");
    const name = zName.safeParse(input?.name);
    if (!name.success) return fail(name.error.issues[0]?.message ?? "Nom invalide", { name: [name.error.issues[0]?.message ?? "Nom invalide"] });
    if (JSON.stringify(input?.section ?? null).length > MAX_PAYLOAD_BYTES) return fail("Section trop volumineuse.");
    const checked = validateSectionPayload(input?.section);
    if (!checked.ok) return fail(checked.errors[0] ?? "Section invalide", { section: checked.errors });
    const imageIssue = checkImageWrite(checked.payload, { storeId: ctx.store.id });
    if (imageIssue) return fail(imageIssue);
    const { payload, removed } = await verifyPayloadRefs(ctx.store.id, checked.payload);

    const res = await db
      .$transaction(async (tx) => {
        await lockSavedSections(tx, ctx.store.id);
        const used = await tx.savedSection.count({ where: { storeId: ctx.store.id } });
        const quota = savedSectionQuotaIssue(ctx.planId, used, ctx.store.id);
        if (quota) return { error: quota } as const;
        const clash = await tx.savedSection.findFirst({ where: { storeId: ctx.store.id, name: { equals: name.data, mode: "insensitive" } }, select: { id: true } });
        if (clash) return { error: "dup" } as const;
        const row = await tx.savedSection.create({
          data: { storeId: ctx.store.id, name: name.data, sectionType: payload.type, payload: payload as unknown as Prisma.InputJsonValue, createdById: ctx.user.id },
        });
        await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.saved_section.create", target: row.id, metadata: { name: name.data, sectionType: payload.type, removedRefs: removed } }, tx);
        return { id: row.id } as const;
      })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "dup" } as const;
        throw e;
      });
    if ("error" in res) return res.error === "dup" ? fail(`Une section « ${name.data} » existe déjà.`, { name: ["Nom déjà utilisé."] }) : fail(res.error ?? "Une erreur est survenue. Réessayez.");
    revalidateEditor(ctx.store.id);
    const msg = removed > 0 ? `Section « ${name.data} » enregistrée (${removed} référence${removed > 1 ? "s" : ""} introuvable${removed > 1 ? "s" : ""} retirée${removed > 1 ? "s" : ""})` : `Section « ${name.data} » enregistrée`;
    return success({ id: res.id, name: name.data, removedRefs: removed }, msg);
  });
}

export type SavedSectionList = { items: SavedSectionDTO[]; used: number; limit: number | null; enabled: boolean };

/** Liste des sections enregistrées (les plus utilisées d'abord). Lisible même si le plan ne permet plus d'en créer. */
export async function listSavedSections(storeId: string): Promise<ActionResult<SavedSectionList>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "theme.manage");
    const rows = await db.savedSection.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }], take: 500 });
    return success({ items: rows.map(toSavedSectionDTO), used: rows.length, limit: savedSectionLimit(ctx.planId), enabled: savedSectionsEnabled(ctx.planId) });
  });
}

/**
 * Charge à insérer dans le brouillon : références revérifiées (un produit supprimé depuis est retiré), compteur
 * d'usage incrémenté. L'éditeur clone ensuite avec de nouveaux identifiants (`clonePayload(payload, uniqueIdFactory(doc))`).
 */
export async function getSavedSectionForInsert(storeId: string, id: string): Promise<ActionResult<{ id: string; name: string; payload: SectionPayload; removedRefs: number; templates: string[] }>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(id).success) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "theme.manage");
    if (!savedSectionsEnabled(ctx.planId)) return fail(`Les sections enregistrées sont incluses à partir du plan Starter : /app/${ctx.store.id}/abonnement`);
    const row = await db.savedSection.findFirst({ where: { id, storeId: ctx.store.id } });
    if (!row) return fail("Section enregistrée introuvable");
    // Revalidée : le schéma de la section a pu évoluer depuis l'enregistrement.
    const checked = validateSectionPayload(row.payload);
    if (!checked.ok) return fail(`Cette section n'est plus compatible avec le thème : ${checked.errors[0] ?? "section invalide"}`);
    const { payload, removed } = await verifyPayloadRefs(ctx.store.id, checked.payload);
    await db.savedSection.updateMany({ where: { id: row.id, storeId: ctx.store.id }, data: { usageCount: { increment: 1 } } });
    return success({ id: row.id, name: row.name, payload, removedRefs: removed, templates: compatibleTemplates(payload.type) });
  });
}

export async function renameSavedSection(storeId: string, id: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(id).success) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "theme.manage");
    const parsed = zName.safeParse(name);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Nom invalide", { name: [parsed.error.issues[0]?.message ?? "Nom invalide"] });
    const row = await db.savedSection.findFirst({ where: { id, storeId: ctx.store.id }, select: { id: true, name: true } });
    if (!row) return fail("Section enregistrée introuvable");
    const clash = await db.savedSection.findFirst({ where: { storeId: ctx.store.id, id: { not: row.id }, name: { equals: parsed.data, mode: "insensitive" } }, select: { id: true } });
    if (clash) return fail(`Une section « ${parsed.data} » existe déjà.`, { name: ["Nom déjà utilisé."] });
    try {
      await db.$transaction(async (tx) => {
        await tx.savedSection.updateMany({ where: { id: row.id, storeId: ctx.store.id }, data: { name: parsed.data } });
        await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.saved_section.rename", target: row.id, metadata: { from: row.name, to: parsed.data } }, tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail(`Une section « ${parsed.data} » existe déjà.`);
      throw e;
    }
    revalidateEditor(ctx.store.id);
    return success(undefined, "Section renommée");
  });
}

export async function deleteSavedSection(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(id).success) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "theme.manage");
    const row = await db.savedSection.findFirst({ where: { id, storeId: ctx.store.id }, select: { id: true, name: true } });
    if (!row) return fail("Section enregistrée introuvable");
    await db.$transaction(async (tx) => {
      await tx.savedSection.deleteMany({ where: { id: row.id, storeId: ctx.store.id } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.saved_section.delete", target: row.id, metadata: { name: row.name } }, tx);
    });
    revalidateEditor(ctx.store.id);
    return success(undefined, `Section « ${row.name} » supprimée`);
  });
}


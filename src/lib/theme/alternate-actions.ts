"use server";

/**
 * Modèles alternatifs (lot 4 §6) : renommer et supprimer touchent aussi les fiches qui les utilisent
 * (`templateSuffix` de Product / Category / StorePage / BlogPost), d'où une action serveur dédiée.
 * La création se fait dans l'éditeur (duplication pure) puis par l'enregistrement du brouillon (plan contrôlé par
 * `lot4PlanIssue`).
 *
 * Renommer ou supprimer s'applique au brouillon ET au thème publié (s'ils contiennent le modèle) dans la même
 * transaction que la mise à jour des fiches : la boutique en ligne reste cohérente (aucune fiche ne pointe vers un
 * suffixe absent du thème publié). L'éditeur repart du document renvoyé : pas de revalidation de sa page (lourde).
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, fail, success, zId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { ALTERNATE_SUFFIX_RE, ALTERNATE_TEMPLATE_TYPES, type AlternateTemplateType, type ThemeDocument } from "@/lib/theme-engine/types";
import { removeAlternate, renameAlternate, ThemeOpError } from "@/lib/theme-engine/operations";
import { editorDocument, publishedDocument } from "./bootstrap";

type Tx = Prisma.TransactionClient;

const typeSchema = z.enum(ALTERNATE_TEMPLATE_TYPES);
const suffixSchema = z.string().regex(ALTERNATE_SUFFIX_RE, "Nom de modèle : minuscules, chiffres et tirets (24 caractères maximum).");

const json = (doc: ThemeDocument) => doc as unknown as Prisma.InputJsonValue;

/** Met à jour le suffixe des fiches de la boutique qui utilisent `from` (null = retour au modèle par défaut). */
async function moveOwners(tx: Tx, storeId: string, type: AlternateTemplateType, from: string, to: string | null): Promise<number> {
  const where = { storeId, templateSuffix: from };
  const data = { templateSuffix: to };
  switch (type) {
    case "product":
      return (await tx.product.updateMany({ where, data })).count;
    case "collection":
      return (await tx.category.updateMany({ where, data })).count;
    case "page":
      return (await tx.storePage.updateMany({ where, data })).count;
    case "article":
      return (await tx.blogPost.updateMany({ where, data })).count;
  }
}

/** Applique `fn` à un document s'il contient le modèle ; le résultat est revalidé (jamais d'écriture invalide). */
function transform(doc: ThemeDocument | null, type: AlternateTemplateType, suffix: string, fn: (d: ThemeDocument) => ThemeDocument): ThemeDocument | null {
  if (!doc?.alternates?.[type]?.[suffix]) return null;
  const v = validateThemeDocument(fn(doc));
  return v.ok ? { ...v.doc, updatedAt: new Date().toISOString() } : null;
}

export async function renameAlternateTemplate(storeId: string, type: string, from: string, to: string): Promise<ActionResult<{ doc: ThemeDocument; owners: number }>> {
  return guard(async () => {
    if (!zId.safeParse(storeId).success) return fail("Boutique invalide.");
    const t = typeSchema.safeParse(type);
    const f = suffixSchema.safeParse(from);
    const n = suffixSchema.safeParse(to);
    if (!t.success || !f.success) return fail("Modèle introuvable.");
    if (!n.success) return fail(n.error.issues[0]?.message ?? "Nom invalide.", { name: [n.error.issues[0]?.message ?? "Nom invalide."] });
    const ctx = await requireStore(storeId, "theme.manage");
    const sid = ctx.store.id;
    const draft = editorDocument(ctx.store).doc;
    if (!draft.alternates?.[t.data]?.[f.data]) return fail("Modèle introuvable dans le brouillon.");
    let nextDraft: ThemeDocument | null;
    let nextPublished: ThemeDocument | null;
    try {
      nextDraft = transform(draft, t.data, f.data, (d) => renameAlternate(d, t.data, f.data, n.data));
      nextPublished = transform(publishedDocument(ctx.store), t.data, f.data, (d) => renameAlternate(d, t.data, f.data, n.data));
    } catch (e) {
      if (e instanceof ThemeOpError) return fail(e.message, { name: [e.message] });
      throw e;
    }
    if (!nextDraft) return fail("Le brouillon ne peut pas être modifié. Rechargez l'éditeur.");
    const owners = await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: sid }, data: { themeDocDraft: json(nextDraft), ...(nextPublished ? { themeDoc: json(nextPublished) } : {}) } });
      const moved = await moveOwners(tx, sid, t.data, f.data, n.data);
      await audit({ storeId: sid, actorId: ctx.user.id, action: "theme.alternate_renamed", target: `${t.data}:${n.data}`, metadata: { type: t.data, from: f.data, to: n.data, owners: moved, published: !!nextPublished } }, tx);
      return moved;
    });
    if (nextPublished) revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success({ doc: nextDraft, owners }, owners ? `Modèle renommé. ${owners} fiche${owners > 1 ? "s" : ""} mise${owners > 1 ? "s" : ""} à jour.` : "Modèle renommé.");
  });
}

export async function deleteAlternateTemplate(storeId: string, type: string, suffix: string): Promise<ActionResult<{ doc: ThemeDocument; owners: number }>> {
  return guard(async () => {
    if (!zId.safeParse(storeId).success) return fail("Boutique invalide.");
    const t = typeSchema.safeParse(type);
    const s = suffixSchema.safeParse(suffix);
    if (!t.success || !s.success) return fail("Modèle introuvable.");
    const ctx = await requireStore(storeId, "theme.manage");
    const sid = ctx.store.id;
    const draft = editorDocument(ctx.store).doc;
    const published = publishedDocument(ctx.store);
    if (!draft.alternates?.[t.data]?.[s.data] && !published?.alternates?.[t.data]?.[s.data]) return fail("Modèle introuvable.");
    const nextDraft = transform(draft, t.data, s.data, (d) => removeAlternate(d, t.data, s.data)) ?? draft;
    const nextPublished = transform(published, t.data, s.data, (d) => removeAlternate(d, t.data, s.data));
    const owners = await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: sid }, data: { themeDocDraft: json(nextDraft), ...(nextPublished ? { themeDoc: json(nextPublished) } : {}) } });
      const moved = await moveOwners(tx, sid, t.data, s.data, null);
      await audit({ storeId: sid, actorId: ctx.user.id, action: "theme.alternate_deleted", target: `${t.data}:${s.data}`, metadata: { type: t.data, suffix: s.data, owners: moved, published: !!nextPublished } }, tx);
      return moved;
    });
    if (nextPublished || owners) revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success({ doc: nextDraft, owners }, owners ? `Modèle supprimé. ${owners} fiche${owners > 1 ? "s utilisent" : " utilise"} maintenant le modèle par défaut.` : "Modèle supprimé.");
  });
}

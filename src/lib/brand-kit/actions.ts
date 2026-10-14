"use server";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, fail, success, zRawId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { checkImageWrite } from "@/lib/storage/write-guard";
import { brandKitSchema, buildBrandKit, parseBrandKit, type BrandKit } from "./palette";

/**
 * Lot 4 §7 : enregistrement du kit de marque (`Store.brandKit`). GRATUIT, aucun crédit IA.
 * Les couleurs sont extraites dans le navigateur ; le serveur revalide la forme (hex, polices, schémas),
 * recorrige le contraste (AA) et vérifie que le logo appartient bien à la boutique.
 */

export async function getBrandKit(storeId: string): Promise<ActionResult<{ kit: BrandKit | null }>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success) return fail("Boutique invalide.");
    const ctx = await requireStore(storeId, "theme.manage");
    const row = await db.store.findUnique({ where: { id: ctx.store.id }, select: { brandKit: true } });
    return success({ kit: parseBrandKit(row?.brandKit) });
  });
}

/** Enregistre le kit (reconstruit côté serveur à partir des couleurs : le client ne décide pas de la palette finale). */
export async function saveBrandKit(storeId: string, payload: unknown): Promise<ActionResult<{ kit: BrandKit }>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success) return fail("Boutique invalide.");
    const ctx = await requireStore(storeId, "theme.manage");
    const parsed = brandKitSchema.safeParse(payload);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Kit de marque invalide.");
    const d = parsed.data;

    // Logo : une image du stockage de CETTE boutique, ou le logo déjà enregistré.
    const logoUrl = d.logoUrl;
    if (logoUrl) {
      const issue = checkImageWrite({ logo: { url: logoUrl } }, { storeId: ctx.store.id, existing: [ctx.store.logoUrl, ctx.store.themeDoc, ctx.store.themeDocDraft] });
      if (issue) return fail(issue);
    }

    // Reconstruction déterministe : AA garanti quelles que soient les valeurs reçues.
    const kit = buildBrandKit({ colors: d.palette.length ? d.palette : [d.primary, d.accent], logoUrl, tone: d.voice.tone, formal: d.voice.formal, fontPair: d.fontPair });
    await db.store.update({ where: { id: ctx.store.id }, data: { brandKit: kit as unknown as Prisma.InputJsonValue } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "brand.kit_saved", metadata: { primary: kit.primary, accent: kit.accent, tone: kit.voice.tone, colors: kit.palette.length } });
    return success({ kit }, "Kit de marque enregistré");
  });
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { requireStore } from "@/lib/auth/permissions";
import { badIds, guard, parseForm, fail, success, zBool, zRawId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { currentFacebookLives, currentInstagramLives, MetaGraphError } from "@/lib/meta-social/graph";
import { isValidCode, normalizeCode } from "./claim-parser";
import { CLAIM_MESSAGE_MAX, PUBLIC_REPLY_MAX, validateClaimTemplate } from "./claim-message";
import { cancelClaim, remindClaim } from "./claims";

/**
 * Actions marchand du « commenter pour acheter » : réglages du direct, mots-clés, liaison à la vidéo en direct
 * Facebook / Instagram, annulation et relance d'une réservation. Capacité `theme.manage` (comme le live shopping),
 * plan `liveShopping`, tout filtré par `storeId`.
 */

async function liveContext(storeId: string) {
  const ctx = await requireStore(storeId, "theme.manage");
  if (!PLANS[ctx.planId].features.liveShopping) {
    return { ctx, error: fail(`Le live shopping est inclus à partir du plan Scale. Changez de plan : /app/${ctx.store.id}/abonnement`) };
  }
  return { ctx, error: null };
}

const settingsSchema = z.object({
  storeId: zRawId,
  eventId: zRawId,
  claimsEnabled: zBool,
  claimHoldMinutes: z.coerce.number().int("Nombre entier").min(5, "5 minutes minimum").max(60, "60 minutes maximum"),
  claimMaxPerAuthor: z.coerce.number().int("Nombre entier").min(1, "1 minimum").max(5, "5 maximum"),
  claimActiveCapUnits: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int("Nombre entier").min(1, "1 minimum").max(10_000).nullable()),
  claimActiveCapPercent: z.coerce.number().int("Nombre entier").min(1, "1 % minimum").max(100, "100 % maximum"),
  claimMessage: z.string().trim().max(CLAIM_MESSAGE_MAX, `${CLAIM_MESSAGE_MAX} caractères maximum`).optional(),
  claimPublicReply: zBool,
  claimPublicText: z.string().trim().max(PUBLIC_REPLY_MAX, `${PUBLIC_REPLY_MAX} caractères maximum`).optional(),
});

export async function saveClaimSettings(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(settingsSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const { ctx, error } = await liveContext(d.storeId);
    if (error) return error;
    const message = d.claimMessage?.trim() || null;
    if (message) {
      const err = validateClaimTemplate(message);
      if (err) return fail(err, { claimMessage: [err] });
    }
    const res = await db.liveEvent.updateMany({
      where: { id: d.eventId, storeId: ctx.store.id },
      data: {
        claimsEnabled: d.claimsEnabled,
        claimHoldMinutes: d.claimHoldMinutes,
        claimMaxPerAuthor: d.claimMaxPerAuthor,
        claimActiveCapUnits: d.claimActiveCapUnits,
        claimActiveCapPercent: d.claimActiveCapPercent,
        claimMessage: message,
        claimPublicReply: d.claimPublicReply,
        claimPublicText: d.claimPublicText?.trim() || null,
      },
    });
    if (res.count === 0) return fail("Direct introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "live.claims_settings", target: d.eventId, metadata: { enabled: d.claimsEnabled, hold: d.claimHoldMinutes } });
    revalidatePath(`/app/${ctx.store.id}/live/${d.eventId}`);
    return success(undefined, "Réglages enregistrés.");
  });
}

const keywordsSchema = z
  .array(
    z.object({
      code: z.string().trim().min(1, "Code requis").max(40),
      productId: zRawId,
      variantId: zRawId.nullable(),
    }),
  )
  .max(50, "50 mots-clés maximum");

export type KeywordInput = z.infer<typeof keywordsSchema>[number];

/** Remplace les mots-clés du direct. Chaque produit / variante est revérifié dans le catalogue ACTIF de la boutique. */
export async function saveLiveKeywords(storeId: string, eventId: string, rows: KeywordInput[]): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, eventId);
    if (bad) return bad;
    const parsed = keywordsSchema.safeParse(rows);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Mots-clés invalides");
    const { ctx, error } = await liveContext(storeId);
    if (error) return error;
    const sid = ctx.store.id;
    const event = await db.liveEvent.findFirst({ where: { id: eventId, storeId: sid }, select: { id: true } });
    if (!event) return fail("Direct introuvable");

    const seen = new Set<string>();
    const clean: { code: string; productId: string; variantId: string | null }[] = [];
    for (const r of parsed.data) {
      const code = normalizeCode(r.code);
      if (!isValidCode(code)) return fail(`Code « ${r.code} » invalide : lettres et chiffres uniquement.`);
      if (seen.has(code)) return fail(`Le code « ${code.toUpperCase()} » est utilisé deux fois.`);
      seen.add(code);
      clean.push({ code, productId: r.productId, variantId: r.variantId });
    }
    const products = clean.length
      ? await db.product.findMany({
          where: { storeId: sid, id: { in: [...new Set(clean.map((c) => c.productId))] }, status: "ACTIVE" },
          select: { id: true, name: true, isGiftCard: true, variants: { select: { id: true } }, optionGroups: { where: { required: true }, select: { id: true } } },
        })
      : [];
    for (const c of clean) {
      const p = products.find((x) => x.id === c.productId);
      if (!p) return fail(`Code ${c.code.toUpperCase()} : produit introuvable ou inactif.`);
      if (p.isGiftCard) return fail(`${p.name} : les cartes cadeaux ne se réservent pas par commentaire.`);
      if (p.optionGroups.length) return fail(`${p.name} : ce produit a des options obligatoires, il ne peut pas être réservé par commentaire.`);
      if (p.variants.length > 0 && (!c.variantId || !p.variants.some((v) => v.id === c.variantId))) return fail(`${p.name} : choisissez une variante pour le code ${c.code.toUpperCase()}.`);
      if (p.variants.length === 0) c.variantId = null;
    }
    await db.$transaction(async (tx) => {
      await tx.liveKeyword.deleteMany({ where: { storeId: sid, liveEventId: event.id } });
      if (clean.length) await tx.liveKeyword.createMany({ data: clean.map((c) => ({ ...c, storeId: sid, liveEventId: event.id })) });
    });
    await audit({ storeId: sid, actorId: ctx.user.id, action: "live.keywords", target: event.id, metadata: { count: clean.length } });
    revalidatePath(`/app/${sid}/live/${event.id}`);
    return success(undefined, `${clean.length} mot${clean.length > 1 ? "s" : ""}-clé${clean.length > 1 ? "s" : ""} enregistré${clean.length > 1 ? "s" : ""}.`);
  });
}

/** Relie le direct Axi aux vidéos en direct EN COURS des comptes connectés (Facebook et Instagram). */
export async function detectSocialLives(storeId: string, eventId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, eventId);
    if (bad) return bad;
    const { ctx, error } = await liveContext(storeId);
    if (error) return error;
    const sid = ctx.store.id;
    const event = await db.liveEvent.findFirst({ where: { id: eventId, storeId: sid }, select: { id: true } });
    if (!event) return fail("Direct introuvable");
    const accounts = await db.socialAccount.findMany({ where: { storeId: sid, status: "active" }, select: { platform: true, externalId: true, tokenEncrypted: true } });
    if (!accounts.length) return fail("Connectez d'abord votre Page Facebook / Instagram.");

    const ids = new Set<string>();
    const found: string[] = [];
    const errors: string[] = [];
    for (const a of accounts) {
      try {
        const token = decryptSecret(a.tokenEncrypted);
        const lives = a.platform === "FACEBOOK" ? await currentFacebookLives(a.externalId, token) : await currentInstagramLives(a.externalId, token);
        for (const l of lives) {
          l.ids.forEach((id) => ids.add(id));
          found.push(l.title);
        }
      } catch (e) {
        errors.push(e instanceof MetaGraphError ? e.message : "erreur");
      }
    }
    if (!ids.size) {
      return fail(errors.length ? `Aucun direct détecté (${errors[0]}).` : "Aucun direct en cours sur vos comptes. Lancez la diffusion sur Facebook ou Instagram, puis réessayez.");
    }
    await db.liveEvent.updateMany({ where: { id: event.id, storeId: sid }, data: { socialObjectIds: [...ids].slice(0, 20) } });
    revalidatePath(`/app/${sid}/live/${event.id}`);
    return success(undefined, `Direct relié : ${found.join(", ")}.`);
  });
}

/** Retire la liaison : les commentaires de toutes les publications des comptes connectés sont acceptés pendant le direct. */
export async function clearSocialLives(storeId: string, eventId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, eventId);
    if (bad) return bad;
    const { ctx, error } = await liveContext(storeId);
    if (error) return error;
    const res = await db.liveEvent.updateMany({ where: { id: eventId, storeId: ctx.store.id }, data: { socialObjectIds: [] } });
    if (res.count === 0) return fail("Direct introuvable");
    revalidatePath(`/app/${ctx.store.id}/live/${eventId}`);
    return success(undefined, "Liaison retirée.");
  });
}

export async function cancelLiveClaim(storeId: string, claimId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, claimId);
    if (bad) return bad;
    const { ctx, error } = await liveContext(storeId);
    if (error) return error;
    const claim = await db.liveClaim.findFirst({ where: { id: claimId, storeId: ctx.store.id }, select: { id: true, liveEventId: true } });
    if (!claim) return fail("Réservation introuvable");
    if (!(await cancelClaim(ctx.store.id, claim.id))) return fail("Cette réservation n'est plus annulable (payée, commandée, expirée ou déjà annulée).");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "live.claim_cancelled", target: claim.id });
    revalidatePath(`/app/${ctx.store.id}/live/${claim.liveEventId}`);
    return success(undefined, "Réservation annulée, article remis en vente.");
  });
}

export async function remindLiveClaim(storeId: string, claimId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, claimId);
    if (bad) return bad;
    const { ctx, error } = await liveContext(storeId);
    if (error) return error;
    const r = await remindClaim(ctx.store.id, claimId);
    if (!r.ok) return fail(r.error);
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "live.claim_reminded", target: claimId });
    revalidatePath(`/app/${ctx.store.id}/live`, "layout");
    return success(undefined, r.message);
  });
}

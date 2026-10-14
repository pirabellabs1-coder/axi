"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { ADD_ONS, PLAN_ORDER, type PricingZone } from "@/config/plans";
import { defaultAddOnPrice, defaultPlanMonthly, normalizeCouponCode, COUPON_CODE_RE, validatePriceAmount } from "@/lib/pricing/rules";
import { requireAdminPermission } from "./context";

/**
 * Catalogue des prix (PriceOverride) et codes promo SaaS (SaasCoupon).
 * Permissions : pricing.manage / coupons.manage (FINANCE, SUPER_ADMIN). Audit `admin.price_changed`, `admin.coupon.*`.
 */

const zZone = z.enum(["WORLD", "AFRICA"]);
const zItem = z.discriminatedUnion("itemType", [
  z.object({ itemType: z.literal("plan"), itemId: z.enum(PLAN_ORDER.filter((p) => p !== "FREE") as [string, ...string[]]) }),
  z.object({ itemType: z.literal("addon"), itemId: z.enum(ADD_ONS.map((a) => a.id) as [string, ...string[]]) }),
]);

function defaultOf(itemType: "plan" | "addon", itemId: string, zone: PricingZone) {
  return itemType === "plan" ? defaultPlanMonthly(itemId as (typeof PLAN_ORDER)[number], zone) : defaultAddOnPrice(itemId, zone);
}

function revalidatePricing() {
  revalidatePath("/admin/tarifs");
  revalidatePath("/admin");
}

/** Nouveau prix pour un article et une zone (prochaines factures). Les surcharges précédentes passent en historique. */
export async function setPriceOverride(input: { itemType: "plan" | "addon"; itemId: string; zone: PricingZone; amount: number; note?: string }): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("pricing.manage");
    const item = zItem.safeParse(input);
    const rest = z.object({ zone: zZone, amount: z.coerce.number().int("Montant entier attendu"), note: z.string().trim().max(200).optional() }).safeParse(input);
    if (!item.success || !rest.success) return fail(rest.success ? "Article inconnu" : (rest.error.issues[0]?.message ?? "Données invalides"));
    const { itemType, itemId } = item.data;
    const { zone, amount, note } = rest.data;
    const invalid = validatePriceAmount(amount, zone);
    if (invalid) return fail(invalid);
    const current = await db.priceOverride.findFirst({ where: { itemType, itemId, zone, active: true }, orderBy: { createdAt: "desc" } });
    const def = defaultOf(itemType, itemId, zone);
    const before = current?.amount ?? def;
    if (before === amount) return fail("Ce prix est déjà en vigueur.");
    await db.$transaction(async (tx) => {
      await tx.priceOverride.updateMany({ where: { itemType, itemId, zone, active: true }, data: { active: false } });
      await tx.priceOverride.create({ data: { itemType, itemId, zone, amount, active: true, note: note || null, actorId: user.id } });
      await audit({ actorId: user.id, action: "admin.price_changed", target: `${itemType}:${itemId}:${zone}`, metadata: { itemType, itemId, zone, from: before, to: amount, default: def, note: note || null } }, tx);
    });
    revalidatePricing();
    return success(undefined, "Prix mis à jour pour les prochaines factures");
  });
}

/** Retour au prix par défaut (src/config/plans.ts) : désactive les surcharges, garde l'historique. */
export async function resetPriceOverride(input: { itemType: "plan" | "addon"; itemId: string; zone: PricingZone }): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("pricing.manage");
    const item = zItem.safeParse(input);
    const zone = zZone.safeParse(input.zone);
    if (!item.success || !zone.success) return fail("Article inconnu");
    const { itemType, itemId } = item.data;
    const current = await db.priceOverride.findFirst({ where: { itemType, itemId, zone: zone.data, active: true }, orderBy: { createdAt: "desc" } });
    if (!current) return fail("Le prix par défaut est déjà en vigueur.");
    const def = defaultOf(itemType, itemId, zone.data);
    await db.$transaction(async (tx) => {
      await tx.priceOverride.updateMany({ where: { itemType, itemId, zone: zone.data, active: true }, data: { active: false } });
      // Trace dans l'historique (inactive) : « retour au prix par défaut ».
      await tx.priceOverride.create({ data: { itemType, itemId, zone: zone.data, amount: def ?? 0, active: false, note: "Retour au prix par défaut", actorId: user.id } });
      await audit({ actorId: user.id, action: "admin.price_changed", target: `${itemType}:${itemId}:${zone.data}`, metadata: { itemType, itemId, zone: zone.data, from: current.amount, to: def, reset: true } }, tx);
    });
    revalidatePricing();
    return success(undefined, "Prix par défaut rétabli");
  });
}

// ─────────────────────────── Codes promo SaaS ───────────────────────────

const couponSchema = z
  .object({
    code: z.string().transform(normalizeCouponCode).refine((c) => COUPON_CODE_RE.test(c), "Code : 3 à 32 caractères, lettres, chiffres, - ou _"),
    description: z.string().trim().max(200).optional(),
    kind: z.enum(["percent", "amount"]),
    value: z.coerce.number().int("Nombre entier attendu").min(1, "Valeur minimale : 1"),
    zone: z.enum(["", "WORLD", "AFRICA"]).default(""),
    plans: z.array(z.enum(["STARTER", "BUSINESS", "SCALE", "ENTERPRISE"])).default([]),
    durationMonths: z.coerce.number().int().min(1, "Au moins 1 facture").max(36, "36 factures maximum"),
    maxRedemptions: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(1, "Limite minimale : 1").max(1_000_000).nullable()),
    expiresAt: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable()),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "percent" && v.value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "100 % maximum" });
    if (v.kind === "amount" && !v.zone) ctx.addIssue({ code: "custom", path: ["zone"], message: "Une remise en montant exige une zone (devise)" });
  });

export type CouponInput = z.input<typeof couponSchema>;

function revalidateCoupons() {
  revalidatePath("/admin/codes-promo");
}

export async function saveCoupon(id: string | null, input: CouponInput): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("coupons.manage");
    const parsed = couponSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (fieldErrors[String(i.path[0] ?? "form")] ??= []).push(i.message);
      return fail(parsed.error.issues[0]?.message ?? "Données invalides", fieldErrors);
    }
    const v = parsed.data;
    if (v.expiresAt && v.expiresAt.getTime() < Date.now() - 86_400_000) return fail("La date d'expiration est déjà passée.", { expiresAt: ["Date passée"] });
    const data = {
      code: v.code,
      description: v.description || null,
      percentOff: v.kind === "percent" ? v.value : null,
      amountOff: v.kind === "amount" ? v.value : null,
      zone: v.zone || null,
      plans: v.plans,
      durationMonths: v.durationMonths,
      maxRedemptions: v.maxRedemptions,
      expiresAt: v.expiresAt,
    };
    const clash = await db.saasCoupon.findUnique({ where: { code: v.code }, select: { id: true } });
    if (clash && clash.id !== id) return fail("Ce code existe déjà.", { code: ["Ce code existe déjà"] });
    if (id) {
      const existing = await db.saasCoupon.findUnique({ where: { id } });
      if (!existing) return fail("Code promo introuvable");
      if (existing.redemptions > 0 && existing.code !== v.code) return fail("Un code déjà utilisé ne peut pas être renommé.", { code: ["Déjà utilisé : créez un nouveau code"] });
      await db.$transaction(async (tx) => {
        await tx.saasCoupon.update({ where: { id }, data });
        await audit({ actorId: user.id, action: "admin.coupon.updated", target: id, metadata: { ...data, expiresAt: data.expiresAt?.toISOString() ?? null } }, tx);
      });
      revalidateCoupons();
      return success(undefined, `Code ${v.code} mis à jour`);
    }
    await db.$transaction(async (tx) => {
      const c = await tx.saasCoupon.create({ data: { ...data, active: true } });
      await audit({ actorId: user.id, action: "admin.coupon.created", target: c.id, metadata: { ...data, expiresAt: data.expiresAt?.toISOString() ?? null } }, tx);
    });
    revalidateCoupons();
    return success(undefined, `Code ${v.code} créé`);
  });
}

export async function toggleCoupon(id: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("coupons.manage");
    const c = await db.saasCoupon.findUnique({ where: { id } });
    if (!c) return fail("Code promo introuvable");
    await db.$transaction(async (tx) => {
      await tx.saasCoupon.update({ where: { id }, data: { active: !c.active } });
      await audit({ actorId: user.id, action: c.active ? "admin.coupon.deactivated" : "admin.coupon.activated", target: id, metadata: { code: c.code } }, tx);
    });
    revalidateCoupons();
    return success(undefined, c.active ? `Code ${c.code} désactivé` : `Code ${c.code} réactivé`);
  });
}

/** Suppression réservée aux codes jamais utilisés (sinon : désactiver, pour garder la trace des factures). */
export async function deleteCoupon(id: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("coupons.manage");
    const c = await db.saasCoupon.findUnique({ where: { id } });
    if (!c) return fail("Code promo introuvable");
    if (c.redemptions > 0) return fail("Ce code a déjà été utilisé : désactivez-le plutôt.");
    await db.$transaction(async (tx) => {
      await tx.saasCoupon.delete({ where: { id } });
      await audit({ actorId: user.id, action: "admin.coupon.deleted", target: id, metadata: { code: c.code } }, tx);
    });
    revalidateCoupons();
    return success(undefined, `Code ${c.code} supprimé`);
  });
}

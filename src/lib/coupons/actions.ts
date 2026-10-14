"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zOptionalString, zMoneyText, readMoneyFields, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";

function requireCoupons(ctx: StoreContext) {
  if (!PLANS[ctx.planId].features.coupons) {
    return fail(`Les codes promo sont inclus à partir du plan Starter (plan actuel : ${PLANS[ctx.planId].name}). Changez de plan depuis la page Abonnement.`);
  }
  return null;
}

const zOptInt = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(0).optional());
const zOptDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional());

const couponSchema = z.object({
  storeId: z.string(),
  id: zOptionalString,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,24}$/, "3 à 24 caractères : lettres, chiffres, tirets"),
  type: z.enum(["PERCENT", "FIXED", "FREE_DELIVERY"]),
  value: zMoneyText, // FIXED : unités majeures de la devise ; PERCENT : pourcentage entier
  minSubtotal: zMoneyText,
  maxUses: zOptInt,
  maxUsesPerCustomer: zOptInt,
  startsAt: zOptDate,
  endsAt: zOptDate,
  active: zBool,
  // Lot 1
  combinesWithAutomatic: zBool,
  firstOrderOnly: zBool,
  appliesToProductIds: z.array(z.string().min(8).max(64)).max(200).default([]),
  appliesToCollectionIds: z.array(z.string().min(8).max(64)).max(50).default([]),
});

export async function upsertCoupon(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(couponSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { value: rawValue, minSubtotal: rawMin, ...rest } = parsed.data;
    const ctx = await requireStore(rest.storeId, "coupons.manage");
    const gate = requireCoupons(ctx);
    if (gate) return gate;
    // Pourcentage : entier saisi tel quel ; montant fixe et seuil : unités majeures → unités mineures.
    let value = 0;
    if (rest.type === "PERCENT") {
      const pct = rawValue.trim() === "" ? 0 : Number(rawValue.trim());
      if (!Number.isInteger(pct)) return fail("Le pourcentage doit être un nombre entier.", { value: ["Nombre entier"] });
      value = pct;
    } else if (rest.type === "FIXED") {
      const v = readMoneyFields({ value: rawValue }, { value: 0 }, ctx.store.currency);
      if ("error" in v) return v.error;
      value = v.values.value ?? 0;
    }
    const mm = readMoneyFields({ minSubtotal: rawMin }, { minSubtotal: 0 }, ctx.store.currency);
    if ("error" in mm) return mm.error;
    const d = { ...rest, value, minSubtotal: mm.values.minSubtotal ?? 0 };

    if (d.type === "PERCENT" && (d.value < 1 || d.value > 100)) return fail("Le pourcentage doit être entre 1 et 100.", { value: ["Entre 1 et 100"] });
    if (d.type === "FIXED" && d.value < 1) return fail("Indiquez un montant de remise.", { value: ["Montant requis"] });
    if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) return fail("La date de fin doit être après la date de début.", { endsAt: ["Après le début"] });

    const dup = await db.coupon.findUnique({ where: { storeId_code: { storeId: ctx.store.id, code: d.code } } });
    if (dup && dup.id !== d.id) return fail("Ce code existe déjà.", { code: ["Déjà utilisé"] });

    // Assiette (appliesTo) : références vérifiées dans la boutique ; vide = tout le panier.
    const productIds = [...new Set(d.appliesToProductIds)];
    const collectionIds = [...new Set(d.appliesToCollectionIds)];
    if (productIds.length) {
      const n = await db.product.count({ where: { storeId: ctx.store.id, id: { in: productIds } } });
      if (n !== productIds.length) return fail("Un produit sélectionné n'existe plus.", { appliesTo: ["Produit introuvable"] });
    }
    if (collectionIds.length) {
      const n = await db.category.count({ where: { storeId: ctx.store.id, id: { in: collectionIds } } });
      if (n !== collectionIds.length) return fail("Une collection sélectionnée n'existe plus.", { appliesTo: ["Collection introuvable"] });
    }
    const appliesTo = productIds.length || collectionIds.length ? { productIds, collectionIds } : Prisma.DbNull;

    const data = {
      code: d.code,
      type: d.type,
      value: d.type === "FREE_DELIVERY" ? 0 : d.value,
      minSubtotal: d.minSubtotal,
      maxUses: d.maxUses ?? null,
      maxUsesPerCustomer: d.maxUsesPerCustomer ?? null,
      startsAt: d.startsAt ?? null,
      endsAt: d.endsAt ?? null,
      active: d.active,
      combinesWithAutomatic: d.combinesWithAutomatic,
      firstOrderOnly: d.firstOrderOnly,
      appliesTo,
    };

    if (d.id) {
      const r = await db.coupon.updateMany({ where: { id: d.id, storeId: ctx.store.id }, data });
      if (r.count === 0) return fail("Code promo introuvable.");
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "coupon.updated", target: d.id });
    } else {
      const c = await db.coupon.create({ data: { ...data, storeId: ctx.store.id } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "coupon.created", target: c.id, metadata: { code: d.code } });
    }
    revalidatePath(`/app/${ctx.store.id}/promotions`);
    return success(undefined, d.id ? "Code promo mis à jour" : "Code promo créé");
  });
}

export async function toggleCoupon(storeId: string, id: string, active: boolean): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "coupons.manage");
    // Désactiver reste toujours possible (ex. après un changement de plan) ; activer exige la fonctionnalité.
    if (active) {
      const gate = requireCoupons(ctx);
      if (gate) return gate;
    }
    const r = await db.coupon.updateMany({ where: { id, storeId: ctx.store.id }, data: { active } });
    if (r.count === 0) return fail("Code promo introuvable.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: active ? "coupon.activated" : "coupon.deactivated", target: id });
    revalidatePath(`/app/${ctx.store.id}/promotions`);
    return success(undefined, active ? "Code activé" : "Code désactivé");
  });
}

export async function deleteCoupon(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "coupons.manage");
    const coupon = await db.coupon.findFirst({ where: { id, storeId: ctx.store.id }, include: { _count: { select: { redemptions: true } } } });
    if (!coupon) return fail("Code promo introuvable.");
    if (coupon._count.redemptions > 0) return fail("Ce code a déjà été utilisé : désactivez-le plutôt que de le supprimer (historique des commandes conservé).");
    await db.coupon.delete({ where: { id: coupon.id } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "coupon.deleted", target: id, metadata: { code: coupon.code } });
    revalidatePath(`/app/${ctx.store.id}/promotions`);
    return success(undefined, "Code promo supprimé");
  });
}

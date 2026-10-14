import "server-only";
import type { SaasCoupon } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { PlanId, PricingZone } from "@/config/plans";
import { couponEligibility, couponStillApplies, normalizeCouponCode, type CouponCheck } from "./rules";

/**
 * Codes promo SaaS (abonnements). Sans changer le schéma :
 *  - l'utilisation d'un code par une boutique est journalisée `saas_coupon.redeemed`
 *    (AuditLog, storeId, target = id du code) : un code = une fois par boutique ;
 *  - chaque facture remisée est journalisée `invoice.discount` (target = facture,
 *    metadata { couponId, code, gross, discount }) : c'est la ligne de remise de la facture,
 *    et le compteur de la durée (`durationMonths` = nombre de factures remisées, hors annulées).
 */
export const COUPON_REDEEMED_ACTION = "saas_coupon.redeemed";
export const INVOICE_DISCOUNT_ACTION = "invoice.discount";

type Client = Tx | typeof db;

export async function findCouponByCode(code: string, client: Client = db): Promise<SaasCoupon | null> {
  const c = normalizeCouponCode(code);
  if (!c) return null;
  return client.saasCoupon.findUnique({ where: { code: c } });
}

export async function storeRedeemedCoupon(storeId: string, couponId: string, client: Client = db): Promise<boolean> {
  const row = await client.auditLog.findFirst({ where: { storeId, action: COUPON_REDEEMED_ACTION, target: couponId }, select: { id: true } });
  return !!row;
}

/** Contrôle sans écriture (affichage, pré-validation d'une action). */
export async function checkCoupon(code: string, ctx: { storeId: string; zone: PricingZone; planId: PlanId }, client: Client = db): Promise<CouponCheck & { coupon?: SaasCoupon }> {
  const coupon = await findCouponByCode(code, client);
  if (!coupon) return { ok: false, error: "Code promo inconnu." };
  const already = await storeRedeemedCoupon(ctx.storeId, coupon.id, client);
  const check = couponEligibility(coupon, { zone: ctx.zone, planId: ctx.planId, alreadyRedeemed: already });
  return check.ok ? { ok: true, coupon } : check;
}

/** Message unique côté marchand : ne révèle pas si un code existe, a expiré ou est réservé à un autre plan. */
export const COUPON_PUBLIC_ERROR = "Code promo invalide ou non applicable.";

/**
 * Pré-validation d'un code saisi par un marchand : 10 essais par heure et par boutique (anti-énumération),
 * puis contrôle sans écriture. Toute raison de refus est rendue par le même message.
 */
export async function precheckStoreCoupon(code: string, ctx: { storeId: string; zone: PricingZone; planId: PlanId }): Promise<{ ok: true; coupon: SaasCoupon } | { ok: false; error: string }> {
  const rl = await rateLimit(`saas-coupon:store:${ctx.storeId}`, 10, 3600);
  if (!rl.ok) return { ok: false, error: rateLimitMessage(rl.retryAfter) };
  const r = await checkCoupon(code, ctx);
  return r.ok && r.coupon ? { ok: true, coupon: r.coupon } : { ok: false, error: COUPON_PUBLIC_ERROR };
}

/**
 * Utilisation d'un code (dans la transaction qui émet la facture) : incrément atomique du compteur
 * sous la limite, puis journal `saas_coupon.redeemed`. L'émission de facture applique ensuite la remise.
 */
export async function redeemCoupon(tx: Tx, params: { code: string; storeId: string; zone: PricingZone; planId: PlanId; actorId?: string | null }): Promise<CouponCheck & { coupon?: SaasCoupon }> {
  const check = await checkCoupon(params.code, params, tx);
  if (!check.ok || !check.coupon) return check;
  const c = check.coupon;
  const claimed = await tx.saasCoupon.updateMany({
    where: { id: c.id, active: true, ...(c.maxRedemptions != null ? { redemptions: { lt: c.maxRedemptions } } : {}) },
    data: { redemptions: { increment: 1 } },
  });
  if (claimed.count !== 1) return { ok: false, error: "Ce code promo a atteint sa limite d'utilisation." };
  await audit({ storeId: params.storeId, actorId: params.actorId ?? null, action: COUPON_REDEEMED_ACTION, target: c.id, metadata: { code: c.code, planId: params.planId, zone: params.zone } }, tx);
  return { ok: true, coupon: c };
}

/**
 * Code à appliquer à une nouvelle facture de plan de la boutique : le dernier code utilisé, s'il est
 * encore valable pour ce plan et cette zone, et si sa durée (nombre de factures) n'est pas épuisée.
 * La limite d'utilisations ne s'applique pas ici (le code a déjà été compté à l'utilisation).
 */
export async function couponForNextInvoice(storeId: string, zone: PricingZone, planId: PlanId, client: Client = db): Promise<SaasCoupon | null> {
  const last = await client.auditLog.findFirst({ where: { storeId, action: COUPON_REDEEMED_ACTION }, orderBy: { createdAt: "desc" }, select: { target: true } });
  if (!last?.target) return null;
  const coupon = await client.saasCoupon.findUnique({ where: { id: last.target } });
  if (!coupon) return null;
  // Un code expiré après son utilisation continue de s'appliquer jusqu'au bout de sa durée ;
  // un code désactivé par l'administration cesse de s'appliquer.
  const check = couponEligibility({ ...coupon, expiresAt: null }, { zone, planId, countRedemption: false });
  if (!check.ok) return null;
  const discounts = await client.auditLog.findMany({
    where: { storeId, action: INVOICE_DISCOUNT_ACTION, metadata: { path: ["couponId"], equals: coupon.id } },
    select: { target: true },
  });
  const invoiceIds = discounts.map((d) => d.target!).filter(Boolean);
  const live = invoiceIds.length ? await client.invoice.count({ where: { id: { in: invoiceIds }, status: { not: "VOID" } } }) : 0;
  return couponStillApplies(coupon.durationMonths, live) ? coupon : null;
}

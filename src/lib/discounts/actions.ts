"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, badIds, zBool, zOptionalString, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { zonedMidnight } from "@/lib/reports/daily";
import { ADVANCED_KINDS, CART_OFFER_MODES, CART_OFFER_PLACEMENTS, DISCOUNT_KINDS, KIND_LABELS, configReferences, parseDiscountConfig, type DiscountKind } from "./schema";
import { allowedDiscountKinds } from "./service";
import { linkedDiscountConfig } from "./offer-link";

/**
 * Remises automatiques et offres au panier (lot 1, §2 et §6). Capacité `coupons.manage` ; contrôle de plan serveur
 * (`automaticDiscounts` pour PRODUCT_AMOUNT et CART_TIER, `advancedDiscounts` pour BUY_X_GET_Y et BUNDLE,
 * `cartOffers` pour les offres). Désactiver reste toujours possible après une baisse de plan.
 */

const DAY_MS = 86_400_000;
const zOptInt = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(1).max(1_000_000).optional());
const zDay = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide").optional());

function upsell(ctx: StoreContext, what: string, minPlan: string) {
  return fail(`${what} : inclus à partir du plan ${minPlan} (plan actuel : ${PLANS[ctx.planId].name}). Changez de plan depuis /app/${ctx.store.id}/abonnement.`);
}

function gateKind(ctx: StoreContext, kind: DiscountKind): ActionResult<never> | null {
  if (allowedDiscountKinds(ctx.planId).has(kind)) return null;
  return ADVANCED_KINDS.includes(kind) ? upsell(ctx, `« ${KIND_LABELS[kind]} »`, "Business") : upsell(ctx, "Les remises automatiques", "Starter");
}

function revalidate(storeId: string) {
  revalidatePath(`/app/${storeId}/promotions`);
}

/* ───────────────────────── Remises automatiques ───────────────────────── */

const discountSchema = z.object({
  storeId: z.string(),
  id: zOptionalString,
  title: z.string().trim().min(2, "Indiquez un titre (2 caractères minimum)").max(80, "80 caractères maximum"),
  kind: z.enum(DISCOUNT_KINDS),
  config: z.string().min(2).max(20_000),
  priority: z.preprocess((v) => (v === "" || v == null ? 0 : v), z.coerce.number().int().min(-100).max(100)),
  combinesWithCoupons: zBool,
  combinesWithOtherAutomatic: zBool,
  startsOn: zDay,
  endsOn: zDay,
  maxUses: zOptInt,
  active: zBool,
});

async function checkReferences(storeId: string, refs: { productIds: string[]; collectionIds: string[]; variantIds: string[] }): Promise<string | null> {
  if (refs.productIds.length) {
    const n = await db.product.count({ where: { storeId, id: { in: refs.productIds } } });
    if (n !== refs.productIds.length) return "Un produit sélectionné n'existe plus dans votre catalogue.";
  }
  if (refs.collectionIds.length) {
    const n = await db.category.count({ where: { storeId, id: { in: refs.collectionIds } } });
    if (n !== refs.collectionIds.length) return "Une collection sélectionnée n'existe plus.";
  }
  if (refs.variantIds.length) {
    const n = await db.variant.count({ where: { id: { in: refs.variantIds }, product: { storeId } } });
    if (n !== refs.variantIds.length) return "Une variante sélectionnée n'existe plus.";
  }
  return null;
}

export async function upsertAutomaticDiscount(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(discountSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "coupons.manage");
    if (d.id && badIds(d.id)) return fail("Identifiant invalide");
    const gate = gateKind(ctx, d.kind);
    if (gate) return gate;

    let raw: unknown;
    try {
      raw = JSON.parse(d.config);
    } catch {
      return fail("Configuration illisible.", { config: ["Configuration illisible"] });
    }
    const cfg = parseDiscountConfig(d.kind, raw);
    if (!cfg.ok) return fail(cfg.error, { config: [cfg.error] });
    const refError = await checkReferences(ctx.store.id, configReferences(cfg.value));
    if (refError) return fail(refError, { config: [refError] });

    // Dates : jour entier dans le fuseau de la boutique.
    const tz = ctx.store.timezone;
    const startsAt = d.startsOn ? zonedMidnight(d.startsOn, tz) : null;
    const endsAt = d.endsOn ? new Date(zonedMidnight(d.endsOn, tz).getTime() + DAY_MS - 1000) : null;
    if (startsAt && endsAt && endsAt <= startsAt) return fail("La date de fin doit être après la date de début.", { endsOn: ["Après le début"] });

    const data = {
      title: d.title,
      kind: d.kind,
      config: cfg.value.config as unknown as Prisma.InputJsonValue,
      priority: d.priority,
      combinesWithCoupons: d.combinesWithCoupons,
      combinesWithOtherAutomatic: d.combinesWithOtherAutomatic,
      startsAt,
      endsAt,
      maxUses: d.maxUses ?? null,
      active: d.active,
    };
    if (d.id) {
      const current = await db.automaticDiscount.findFirst({ where: { id: d.id, storeId: ctx.store.id }, select: { id: true, kind: true, _count: { select: { applications: true } } } });
      if (!current) return fail("Remise introuvable.");
      // Le type d'une remise déjà appliquée ne change pas (historique des commandes lisible) : dupliquez plutôt.
      if (current.kind !== d.kind && current._count.applications > 0) return fail("Cette remise a déjà été appliquée : son type ne peut plus changer. Dupliquez-la plutôt.");
      await db.automaticDiscount.updateMany({ where: { id: d.id, storeId: ctx.store.id }, data });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "discount.updated", target: d.id, metadata: { kind: d.kind, title: d.title } });
    } else {
      const count = await db.automaticDiscount.count({ where: { storeId: ctx.store.id } });
      if (count >= 200) return fail("200 remises automatiques maximum par boutique : supprimez ou réutilisez les anciennes.");
      const created = await db.automaticDiscount.create({ data: { ...data, storeId: ctx.store.id } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "discount.created", target: created.id, metadata: { kind: d.kind, title: d.title } });
    }
    revalidate(ctx.store.id);
    return success(undefined, d.id ? "Remise mise à jour" : "Remise créée");
  });
}

export async function toggleAutomaticDiscount(storeId: string, id: string, active: boolean): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "coupons.manage");
    const row = await db.automaticDiscount.findFirst({ where: { id, storeId: ctx.store.id }, select: { kind: true } });
    if (!row) return fail("Remise introuvable.");
    if (active === true) {
      const gate = gateKind(ctx, row.kind);
      if (gate) return gate;
    }
    await db.automaticDiscount.updateMany({ where: { id, storeId: ctx.store.id }, data: { active: active === true } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: active ? "discount.activated" : "discount.deactivated", target: id });
    revalidate(ctx.store.id);
    return success(undefined, active ? "Remise activée" : "Remise désactivée");
  });
}

export async function duplicateAutomaticDiscount(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "coupons.manage");
    const row = await db.automaticDiscount.findFirst({ where: { id, storeId: ctx.store.id } });
    if (!row) return fail("Remise introuvable.");
    const gate = gateKind(ctx, row.kind);
    if (gate) return gate;
    const copy = await db.automaticDiscount.create({
      data: {
        storeId: ctx.store.id,
        title: `${row.title} (copie)`.slice(0, 80),
        kind: row.kind,
        config: row.config as Prisma.InputJsonValue,
        priority: row.priority,
        combinesWithCoupons: row.combinesWithCoupons,
        combinesWithOtherAutomatic: row.combinesWithOtherAutomatic,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        maxUses: row.maxUses,
        active: false, // une copie démarre désactivée : le commerçant la relit avant de l'activer
      },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "discount.duplicated", target: copy.id, metadata: { from: id } });
    revalidate(ctx.store.id);
    return success(undefined, "Remise dupliquée (désactivée)");
  });
}

export async function deleteAutomaticDiscount(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "coupons.manage");
    const row = await db.automaticDiscount.findFirst({ where: { id, storeId: ctx.store.id }, select: { id: true, title: true, _count: { select: { applications: true } } } });
    if (!row) return fail("Remise introuvable.");
    if (row._count.applications > 0) return fail("Cette remise a déjà été appliquée à des commandes : désactivez-la plutôt (historique conservé).");
    await db.automaticDiscount.deleteMany({ where: { id, storeId: ctx.store.id } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "discount.deleted", target: id, metadata: { title: row.title } });
    revalidate(ctx.store.id);
    return success(undefined, "Remise supprimée");
  });
}

/* ───────────────────────── Offres au panier ───────────────────────── */

const zIds = (max: number) => z.array(z.string().min(8).max(64)).max(max).default([]);

const offerSchema = z.object({
  storeId: z.string(),
  id: zOptionalString,
  title: z.string().trim().min(2, "Indiquez un titre (2 caractères minimum)").max(80, "80 caractères maximum"),
  placement: z.enum(CART_OFFER_PLACEMENTS),
  mode: z.enum(CART_OFFER_MODES),
  triggerProductIds: zIds(50),
  triggerCollectionIds: zIds(20),
  offerProductIds: z.array(z.string().min(8).max(64)).min(1, "Choisissez au moins un produit à proposer").max(10, "10 produits maximum"),
  automaticDiscountId: zOptionalString,
  /** La remise liée ne s'applique que si un produit déclencheur est au panier (`requiresProductsInCart`). */
  discountRequiresTrigger: zBool,
  position: z.preprocess((v) => (v === "" || v == null ? 0 : v), z.coerce.number().int().min(0).max(1000)),
  active: zBool,
});

function gateOffers(ctx: StoreContext): ActionResult<never> | null {
  return PLANS[ctx.planId].features.cartOffers ? null : upsell(ctx, "Les offres au panier", "Business");
}

export async function upsertCartOffer(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(offerSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "coupons.manage");
    if (d.id && badIds(d.id)) return fail("Identifiant invalide");
    const gate = gateOffers(ctx);
    if (gate) return gate;

    const triggers = [...new Set(d.triggerProductIds)];
    const triggerCols = [...new Set(d.triggerCollectionIds)];
    const offered = [...new Set(d.offerProductIds)];
    if (triggers.length + triggerCols.length === 0) return fail("Choisissez au moins un déclencheur (produit ou collection).", { triggerProductIds: ["Déclencheur requis"] });
    if (offered.some((id) => triggers.includes(id))) return fail("Un produit proposé ne peut pas être aussi un déclencheur.", { offerProductIds: ["Produit en double"] });
    const refError = await checkReferences(ctx.store.id, { productIds: [...triggers, ...offered], collectionIds: triggerCols, variantIds: [] });
    if (refError) return fail(refError);
    const giftCards = await db.product.count({ where: { storeId: ctx.store.id, id: { in: offered }, isGiftCard: true } });
    if (giftCards > 0) return fail("Une carte cadeau ne peut pas être proposée en offre au panier.", { offerProductIds: ["Carte cadeau"] });

    let automaticDiscountId: string | null = null;
    let linkedConfig: Prisma.InputJsonValue | null = null;
    if (d.automaticDiscountId) {
      if (badIds(d.automaticDiscountId)) return fail("Identifiant invalide");
      const linked = await db.automaticDiscount.findFirst({ where: { id: d.automaticDiscountId, storeId: ctx.store.id }, select: { id: true, kind: true, config: true } });
      if (!linked || linked.kind !== "PRODUCT_AMOUNT") return fail("La remise liée doit être une remise sur des produits de votre boutique.", { automaticDiscountId: ["Remise invalide"] });
      automaticDiscountId = linked.id;
      // Remise liée conditionnée aux produits déclencheurs (lot 1, offres au panier) : réglée depuis l'offre.
      if (d.discountRequiresTrigger && triggers.length === 0) return fail("La remise liée ne peut dépendre que de produits déclencheurs : ajoutez au moins un produit déclencheur ou décochez la condition.", { discountRequiresTrigger: ["Produit déclencheur requis"] });
      const nextLinked = linkedDiscountConfig(linked.config, d.discountRequiresTrigger ? triggers : null);
      if (nextLinked && "error" in nextLinked) return fail(nextLinked.error, { discountRequiresTrigger: [nextLinked.error] });
      if (nextLinked) linkedConfig = nextLinked.config as unknown as Prisma.InputJsonValue;
    }

    const data = { title: d.title, placement: d.placement, mode: d.mode, triggerProductIds: triggers, triggerCollectionIds: triggerCols, offerProductIds: offered, automaticDiscountId, position: d.position, active: d.active };
    if (d.id) {
      const r = await db.cartOffer.updateMany({ where: { id: d.id, storeId: ctx.store.id }, data });
      if (r.count === 0) return fail("Offre introuvable.");
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "offer.updated", target: d.id, metadata: { title: d.title } });
    } else {
      const count = await db.cartOffer.count({ where: { storeId: ctx.store.id } });
      if (count >= 100) return fail("100 offres au panier maximum par boutique.");
      const created = await db.cartOffer.create({ data: { ...data, storeId: ctx.store.id } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "offer.created", target: created.id, metadata: { title: d.title } });
    }
    if (automaticDiscountId && linkedConfig) {
      await db.automaticDiscount.updateMany({ where: { id: automaticDiscountId, storeId: ctx.store.id }, data: { config: linkedConfig } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "discount.updated", target: automaticDiscountId, metadata: { requiresProductsInCart: d.discountRequiresTrigger, via: "cart_offer" } });
    }
    revalidate(ctx.store.id);
    return success(undefined, d.id ? "Offre mise à jour" : "Offre créée");
  });
}

export async function toggleCartOffer(storeId: string, id: string, active: boolean): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "coupons.manage");
    if (active === true) {
      const gate = gateOffers(ctx);
      if (gate) return gate;
    }
    const r = await db.cartOffer.updateMany({ where: { id, storeId: ctx.store.id }, data: { active: active === true } });
    if (r.count === 0) return fail("Offre introuvable.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: active ? "offer.activated" : "offer.deactivated", target: id });
    revalidate(ctx.store.id);
    return success(undefined, active ? "Offre activée" : "Offre désactivée");
  });
}

export async function deleteCartOffer(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "coupons.manage");
    const row = await db.cartOffer.findFirst({ where: { id, storeId: ctx.store.id }, select: { id: true, title: true, conversions: true } });
    if (!row) return fail("Offre introuvable.");
    if (row.conversions > 0) return fail("Cette offre a déjà généré des ventes : désactivez-la plutôt (mesures conservées).");
    await db.cartOffer.deleteMany({ where: { id, storeId: ctx.store.id } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "offer.deleted", target: id, metadata: { title: row.title } });
    revalidate(ctx.store.id);
    return success(undefined, "Offre supprimée");
  });
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, badIds, zBool, zMoneyText, readMoneyFields, zOptionalString, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { PLANS } from "@/config/plans";
import { CARRIER_LABELS, isCarrierId, type CarrierId } from "@/lib/carriers/types";
import { getCarrierAdapter } from "@/lib/carriers/registry";
import { cancelShipment as cancelShipmentService, createShipment as createShipmentService, recordShipmentEvent, ShippingError } from "./service";
import { canTransitionShipment, type ShipmentStatusValue } from "./state";
import { orderWeightGrams } from "./rates";

/**
 * Actions marchand de l'expédition (lot 3 §1.2 et §4) : tarifs par zone, comptes transporteurs,
 * expéditions (création partielle, changement de statut, annulation).
 * `delivery.manage` pour la configuration, `orders.manage` pour les expéditions. Isolation `storeId`,
 * contrôle de plan côté serveur, audit du sensible.
 */

const MAX_RATES_PER_ZONE = 20;
const MAX_CARRIER_ACCOUNTS = 10;

function revalidateShipping(storeId: string) {
  revalidatePath(`/app/${storeId}/livraison`);
  revalidatePath(`/app/${storeId}/livraison/tarifs`);
  revalidatePath(`/app/${storeId}/livraison/transporteurs`);
}

/* ───────────────────────── Tarifs d'expédition ───────────────────────── */

const zOptInt = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(0).max(1_000_000).optional());

const rateSchema = z.object({
  storeId: z.string(),
  id: zOptionalString,
  zoneId: z.string(),
  carrierAccountId: zOptionalString,
  name: z.string().trim().min(2, "Nom du tarif requis").max(80),
  minWeightGrams: zOptInt,
  maxWeightGrams: zOptInt,
  minSubtotal: zMoneyText,
  maxSubtotal: zMoneyText,
  price: zMoneyText,
  freeAbove: zMoneyText,
  etaLabel: zOptionalString,
  active: zBool,
});

export async function upsertShippingRate(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(rateSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { minSubtotal: rawMin, maxSubtotal: rawMax, price: rawPrice, freeAbove: rawFree, ...rest } = parsed.data;
    const ctx = await requireStore(rest.storeId, "delivery.manage");
    // Montants saisis en unités majeures de la devise de la boutique → unités mineures.
    const m = readMoneyFields({ minSubtotal: rawMin, maxSubtotal: rawMax, price: rawPrice, freeAbove: rawFree }, { minSubtotal: null, maxSubtotal: null, price: 0, freeAbove: null }, ctx.store.currency);
    if ("error" in m) return m.error;
    const d = { ...rest, ...m.values, price: m.values.price ?? 0 };
    const bad = badIds(d.zoneId);
    if (bad) return bad;
    // Les tarifs au poids et au montant sont inclus à partir du plan Starter (spec §5) ; le plan
    // Gratuit garde le forfait de la zone (`DeliveryZone.fee`), sans régression.
    if (ctx.planId === "FREE") {
      return fail(`Les tarifs d'expédition par poids et par montant sont inclus à partir du plan Starter (plan actuel : ${PLANS[ctx.planId].name}). Votre zone garde son forfait.`);
    }
    if (d.minWeightGrams != null && d.maxWeightGrams != null && d.maxWeightGrams < d.minWeightGrams) {
      return fail("Le poids maximal doit être supérieur au poids minimal.", { maxWeightGrams: ["Supérieur au minimum"] });
    }
    if (d.minSubtotal != null && d.maxSubtotal != null && d.maxSubtotal < d.minSubtotal) {
      return fail("Le montant maximal doit être supérieur au montant minimal.", { maxSubtotal: ["Supérieur au minimum"] });
    }
    const zone = await db.deliveryZone.findFirst({ where: { id: d.zoneId, storeId: ctx.store.id }, select: { id: true } });
    if (!zone) return fail("Zone introuvable.");
    if (d.carrierAccountId) {
      const account = await db.carrierAccount.findFirst({ where: { id: d.carrierAccountId, storeId: ctx.store.id }, select: { id: true } });
      if (!account) return fail("Compte transporteur introuvable.");
    }
    const data = {
      name: d.name,
      zoneId: d.zoneId,
      carrierAccountId: d.carrierAccountId ?? null,
      minWeightGrams: d.minWeightGrams ?? null,
      maxWeightGrams: d.maxWeightGrams ?? null,
      minSubtotal: d.minSubtotal ?? null,
      maxSubtotal: d.maxSubtotal ?? null,
      price: d.price,
      freeAbove: d.freeAbove ?? null,
      etaLabel: d.etaLabel ?? null,
      active: d.active,
    };
    if (d.id) {
      if (badIds(d.id)) return fail("Identifiant invalide");
      const r = await db.shippingRate.updateMany({ where: { id: d.id, storeId: ctx.store.id }, data });
      if (r.count === 0) return fail("Tarif introuvable.");
    } else {
      const count = await db.shippingRate.count({ where: { storeId: ctx.store.id, zoneId: d.zoneId } });
      if (count >= MAX_RATES_PER_ZONE) return fail(`Maximum ${MAX_RATES_PER_ZONE} tarifs par zone.`);
      await db.shippingRate.create({ data: { ...data, storeId: ctx.store.id, position: count } });
    }
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: d.id ? "shipping_rate.updated" : "shipping_rate.created", target: d.id ?? d.zoneId, metadata: { name: d.name, price: d.price } });
    revalidateShipping(ctx.store.id);
    return success(undefined, d.id ? "Tarif mis à jour" : "Tarif ajouté");
  });
}

export async function deleteShippingRate(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "delivery.manage");
    const r = await db.shippingRate.deleteMany({ where: { id, storeId: ctx.store.id } });
    if (r.count === 0) return fail("Tarif introuvable.");
    revalidateShipping(ctx.store.id);
    return success(undefined, "Tarif supprimé");
  });
}

/** Dépôt qui sert une zone (priorité 1 de l'affectation des commandes). */
export async function setZoneLocation(storeId: string, zoneId: string, locationId: string | null): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, zoneId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "delivery.manage");
    if (locationId) {
      if (badIds(locationId)) return fail("Identifiant invalide");
      const loc = await db.location.findFirst({ where: { id: locationId, storeId: ctx.store.id }, select: { id: true } });
      if (!loc) return fail("Dépôt introuvable.");
    }
    const r = await db.deliveryZone.updateMany({ where: { id: zoneId, storeId: ctx.store.id }, data: { locationId } });
    if (r.count === 0) return fail("Zone introuvable.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "delivery_zone.location_set", target: zoneId, metadata: { locationId } });
    revalidateShipping(ctx.store.id);
    return success(undefined, "Dépôt de la zone enregistré");
  });
}

/* ───────────────────────── Comptes transporteurs ───────────────────────── */

const carrierSchema = z.object({
  storeId: z.string(),
  id: zOptionalString,
  carrier: z.string(),
  name: z.string().trim().min(2, "Nom requis").max(80),
  active: zBool,
});

export async function upsertCarrierAccount(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(carrierSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "delivery.manage");
    if (!isCarrierId(d.carrier)) return fail("Transporteur inconnu.");
    const carrier: CarrierId = d.carrier;
    const plan = PLANS[ctx.planId].features;
    if (carrier === "manual" && !plan.couriers) {
      return fail(`Les étiquettes internes et la page livreur sont incluses à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}).`);
    }
    if (carrier !== "manual" && !plan.carriers) {
      return fail(`L'API des transporteurs est incluse à partir du plan Scale (plan actuel : ${PLANS[ctx.planId].name}).`);
    }

    // Identifiants : chiffrés au repos, jamais relus en clair par l'interface.
    const adapter = getCarrierAdapter(carrier);
    const credentials: Record<string, string> = {};
    for (const field of adapter.credentialFields) {
      const value = formData.get(`cred-${field.key}`);
      if (typeof value === "string" && value.trim()) credentials[field.key] = value.trim();
    }
    const data = { carrier, name: d.name, active: d.active };

    if (d.id) {
      if (badIds(d.id)) return fail("Identifiant invalide");
      const existing = await db.carrierAccount.findFirst({ where: { id: d.id, storeId: ctx.store.id }, select: { id: true } });
      if (!existing) return fail("Compte transporteur introuvable.");
      await db.carrierAccount.update({
        where: { id: d.id },
        // Champs laissés vides : identifiants inchangés.
        data: { ...data, ...(Object.keys(credentials).length ? { credentialsEncrypted: encryptSecret(JSON.stringify(credentials)) } : {}) },
      });
    } else {
      const count = await db.carrierAccount.count({ where: { storeId: ctx.store.id } });
      if (count >= MAX_CARRIER_ACCOUNTS) return fail(`Maximum ${MAX_CARRIER_ACCOUNTS} transporteurs.`);
      await db.carrierAccount.create({
        data: { ...data, storeId: ctx.store.id, credentialsEncrypted: Object.keys(credentials).length ? encryptSecret(JSON.stringify(credentials)) : null },
      });
    }
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: d.id ? "carrier_account.updated" : "carrier_account.created", target: d.id ?? carrier, metadata: { carrier, name: d.name, credentials: Object.keys(credentials) } });
    revalidateShipping(ctx.store.id);
    return success(undefined, `${CARRIER_LABELS[carrier]} enregistré`);
  });
}

export async function deleteCarrierAccount(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "delivery.manage");
    const used = await db.shipment.count({ where: { storeId: ctx.store.id, carrierAccountId: id } });
    if (used > 0) {
      const r = await db.carrierAccount.updateMany({ where: { id, storeId: ctx.store.id }, data: { active: false } });
      if (r.count === 0) return fail("Compte transporteur introuvable.");
      revalidateShipping(ctx.store.id);
      return success(undefined, "Transporteur désactivé (des expéditions y font référence)");
    }
    const r = await db.carrierAccount.deleteMany({ where: { id, storeId: ctx.store.id } });
    if (r.count === 0) return fail("Compte transporteur introuvable.");
    revalidateShipping(ctx.store.id);
    return success(undefined, "Transporteur supprimé");
  });
}

/* ───────────────────────── Expéditions ───────────────────────── */

const shipmentSchema = z.object({
  storeId: z.string(),
  orderId: z.string(),
  carrierAccountId: zOptionalString,
  locationId: zOptionalString,
  courierName: zOptionalString,
  courierPhone: zOptionalString,
  trackingNumber: zOptionalString,
  withDeliveryCode: zBool,
});

/**
 * Crée une expédition (partielle possible) : lignes `ship-<orderItemId>` → quantité.
 * Renvoie le code de remise UNE SEULE FOIS (à transmettre à l'acheteur) : il n'est pas relisible.
 */
export async function createShipmentAction(_prev: ActionResult<{ id: string; deliveryCode: string | null }> | undefined, formData: FormData): Promise<ActionResult<{ id: string; deliveryCode: string | null }>> {
  return guard(async () => {
    const parsed = parseForm(shipmentSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "orders.manage");
    const bad = badIds(d.orderId);
    if (bad) return bad;

    const items: { orderItemId: string; quantity: number }[] = [];
    for (const [key, raw] of formData.entries()) {
      if (!key.startsWith("ship-")) continue;
      const qty = z.coerce.number().int().min(0).max(100_000).safeParse(raw);
      if (qty.success && qty.data > 0) items.push({ orderItemId: key.slice(5), quantity: qty.data });
    }
    if (!items.length) return fail("Choisissez au moins un article à expédier.");

    let carrier = "manual";
    if (d.carrierAccountId) {
      const account = await db.carrierAccount.findFirst({ where: { id: d.carrierAccountId, storeId: ctx.store.id, active: true }, select: { carrier: true } });
      if (!account) return fail("Compte transporteur introuvable.");
      carrier = account.carrier;
      const adapter = getCarrierAdapter(carrier);
      if (!adapter.implemented && carrier !== "manual") {
        return fail(`L'intégration ${CARRIER_LABELS[carrier as CarrierId]} n'est pas encore activée : créez l'expédition avec un transporteur manuel (étiquette interne).`);
      }
    }
    if (d.withDeliveryCode && !PLANS[ctx.planId].features.couriers) {
      return fail(`Le code de remise est inclus à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}).`);
    }
    if (d.locationId) {
      const loc = await db.location.findFirst({ where: { id: d.locationId, storeId: ctx.store.id }, select: { id: true } });
      if (!loc) return fail("Dépôt introuvable.");
    }

    // Poids de l'expédition : variante, sinon produit (signalement si des poids manquent).
    const lines = await db.orderItem.findMany({
      where: { orderId: d.orderId, order: { storeId: ctx.store.id }, id: { in: items.map((i) => i.orderItemId) } },
      select: { id: true, quantity: true, product: { select: { weightGrams: true } }, variant: { select: { weightGrams: true } } },
    });
    if (lines.length !== items.length) return fail("Une ligne n'appartient pas à cette commande.");
    const weight = orderWeightGrams(
      items.map((i) => {
        const line = lines.find((l) => l.id === i.orderItemId);
        return { quantity: i.quantity, variantWeightGrams: line?.variant?.weightGrams ?? null, productWeightGrams: line?.product?.weightGrams ?? null };
      }),
    );

    try {
      const created = await createShipmentService({
        storeId: ctx.store.id,
        orderId: d.orderId,
        carrierAccountId: d.carrierAccountId ?? null,
        carrier,
        locationId: d.locationId ?? null,
        courierName: d.courierName ?? null,
        courierPhone: d.courierPhone ?? null,
        trackingNumber: d.trackingNumber ?? null,
        weightGrams: weight.grams || null,
        items,
        actorId: ctx.user.id,
        withDeliveryCode: d.withDeliveryCode,
      });
      revalidatePath(`/app/${ctx.store.id}/commandes/${d.orderId}`);
      return success(
        { id: created.id, deliveryCode: created.deliveryCode },
        created.deliveryCode ? `Expédition créée. Code de remise à transmettre à l'acheteur : ${created.deliveryCode}` : "Expédition créée",
      );
    } catch (e) {
      if (e instanceof ShippingError) return fail(e.message);
      throw e;
    }
  });
}

const statusSchema = z.object({
  storeId: z.string(),
  shipmentId: z.string(),
  status: z.enum(["LABEL_CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_ATTEMPT", "RETURNED", "CANCELLED"]),
  message: zOptionalString,
});

export async function updateShipmentStatus(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(statusSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "orders.manage");
    const bad = badIds(d.shipmentId);
    if (bad) return bad;
    const shipment = await db.shipment.findFirst({ where: { id: d.shipmentId, storeId: ctx.store.id }, select: { id: true, status: true, orderId: true } });
    if (!shipment) return fail("Expédition introuvable.");
    if (!canTransitionShipment(shipment.status as ShipmentStatusValue, d.status)) return fail("Ce changement d'état n'est pas permis depuis l'état actuel.");

    try {
      if (d.status === "CANCELLED") {
        await cancelShipmentService({ storeId: ctx.store.id, shipmentId: d.shipmentId, actorId: ctx.user.id });
      } else {
        const result = await recordShipmentEvent({
          storeId: ctx.store.id,
          shipmentId: d.shipmentId,
          status: d.status,
          source: "manual",
          strict: true,
          message: d.message ?? null,
          actorId: ctx.user.id,
        });
        if (!result.applied) return fail("Ce changement d'état n'est pas permis depuis l'état actuel.");
      }
    } catch (e) {
      if (e instanceof ShippingError) return fail(e.message);
      throw e;
    }
    revalidatePath(`/app/${ctx.store.id}/commandes/${shipment.orderId}`);
    return success(undefined, "Expédition mise à jour");
  });
}

/* ───────────────────────── Jeton de la page livreur ───────────────────────── */

/**
 * Révoque le lien livreur d'une expédition (mineur n° 6). Le jeton vaut accès sans authentification à
 * l'adresse du client, à son prénom, au montant à encaisser et au détail du colis : il doit pouvoir être
 * coupé à la demande (livreur remplacé, lien partagé par erreur), sans attendre les 7 jours d'expiration.
 *
 * Le jeton est effacé (`null`) et l'expiration ramenée à l'instant : la page répond « lien inconnu », et
 * un nouveau lien peut être émis en recréant une expédition. Capacité `orders.manage`, isolation `storeId`.
 */
export async function revokeCourierToken(storeId: string, shipmentId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, shipmentId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "orders.manage");
    const shipment = await db.shipment.findFirst({ where: { id: shipmentId, storeId: ctx.store.id }, select: { id: true, orderId: true, courierToken: true } });
    if (!shipment) return fail("Expédition introuvable.");
    if (!shipment.courierToken) return fail("Ce lien livreur est déjà révoqué.");
    await db.shipment.updateMany({
      where: { id: shipment.id, storeId: ctx.store.id },
      data: { courierToken: null, courierTokenExpiresAt: new Date() },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "shipment.courier_token_revoked", target: shipment.id });
    revalidatePath(`/app/${ctx.store.id}/commandes/${shipment.orderId}`);
    return success(undefined, "Lien livreur révoqué : il ne donne plus aucun accès.");
  });
}

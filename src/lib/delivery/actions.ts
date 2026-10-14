"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zOptionalString, zMoneyText, readMoneyFields, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { MAX_ZONES_HARD, zoneLimit, zoneLimitMessage } from "./limits";

function revalidate(storeId: string, slug: string) {
  revalidatePath(`/app/${storeId}/livraison`);
  revalidatePath(`/s/${slug}`, "layout");
}

/** Toggles retrait / livraison. */
export async function setFulfillmentOption(storeId: string, key: "pickupEnabled" | "deliveryEnabled", value: boolean): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "delivery.manage");
    if (!value && ((key === "pickupEnabled" && !ctx.store.deliveryEnabled) || (key === "deliveryEnabled" && !ctx.store.pickupEnabled))) {
      return fail("Gardez au moins un mode : retrait ou livraison.");
    }
    await db.store.update({ where: { id: ctx.store.id }, data: { [key]: value } });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, value ? "Activé" : "Désactivé");
  });
}

// ─────────────── Zones de livraison ───────────────

const zoneSchema = z.object({
  storeId: z.string(),
  id: zOptionalString,
  name: z.string().trim().min(2, "Nom de zone requis").max(80),
  fee: zMoneyText,
  freeAbove: zMoneyText,
  etaLabel: zOptionalString,
  active: zBool,
});

export async function upsertDeliveryZone(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(zoneSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "delivery.manage");
    const m = readMoneyFields({ fee: d.fee, freeAbove: d.freeAbove }, { fee: 0, freeAbove: null }, ctx.store.currency);
    if ("error" in m) return m.error;
    const fee = m.values.fee ?? 0;
    const data = { name: d.name, fee, freeAbove: m.values.freeAbove, etaLabel: d.etaLabel ?? null, active: d.active };
    if (d.id) {
      const r = await db.deliveryZone.updateMany({ where: { id: d.id, storeId: ctx.store.id }, data });
      if (r.count === 0) return fail("Zone introuvable.");
    } else {
      const count = await db.deliveryZone.count({ where: { storeId: ctx.store.id } });
      // Limite du plan (Gratuit : 1 zone), vérifiée ici et non seulement dans l'interface.
      const limit = zoneLimit(ctx.planId);
      if (limit != null && count >= limit) return fail(zoneLimitMessage(ctx.planId, count));
      if (count >= MAX_ZONES_HARD) return fail(`Maximum ${MAX_ZONES_HARD} zones par boutique.`);
      const z = await db.deliveryZone.create({ data: { ...data, storeId: ctx.store.id, position: count } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "delivery_zone.created", target: z.id, metadata: { name: d.name, fee } });
    }
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, d.id ? "Zone mise à jour" : "Zone ajoutée");
  });
}

export async function deleteDeliveryZone(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "delivery.manage");
    const r = await db.deliveryZone.deleteMany({ where: { id, storeId: ctx.store.id } });
    if (r.count === 0) return fail("Zone introuvable.");
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Zone supprimée");
  });
}

export async function moveDeliveryZone(storeId: string, id: string, direction: "up" | "down"): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "delivery.manage");
    const zones = await db.deliveryZone.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ position: "asc" }, { name: "asc" }] });
    const idx = zones.findIndex((z) => z.id === id);
    if (idx < 0) return fail("Zone introuvable.");
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= zones.length) return success();
    [zones[idx], zones[target]] = [zones[target], zones[idx]];
    await db.$transaction(zones.map((z, i) => db.deliveryZone.update({ where: { id: z.id }, data: { position: i } })));
    revalidate(ctx.store.id, ctx.store.slug);
    return success();
  });
}

// ─────────────── Créneaux de retrait ───────────────

const time = z.string().regex(/^\d{2}:\d{2}$/, "Heure au format HH:MM");

const slotSchema = z.object({
  storeId: z.string(),
  id: zOptionalString,
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startTime: time,
  endTime: time,
  capacity: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(1).max(1000).optional()),
  active: zBool,
});

export async function upsertPickupSlot(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(slotSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "delivery.manage");
    if (!PLANS[ctx.planId].features.pickupSlots) {
      return fail(`Les créneaux de retrait sont inclus à partir du plan Starter (plan actuel : ${PLANS[ctx.planId].name}). Changez de plan depuis la page Abonnement.`);
    }
    if (d.endTime <= d.startTime) return fail("L'heure de fin doit être après l'heure de début.", { endTime: ["Après le début"] });
    const data = { dayOfWeek: d.dayOfWeek, startTime: d.startTime, endTime: d.endTime, capacity: d.capacity ?? null, active: d.active };
    if (d.id) {
      const r = await db.pickupSlot.updateMany({ where: { id: d.id, storeId: ctx.store.id }, data });
      if (r.count === 0) return fail("Créneau introuvable.");
    } else {
      const count = await db.pickupSlot.count({ where: { storeId: ctx.store.id } });
      if (count >= 100) return fail("Maximum 100 créneaux.");
      await db.pickupSlot.create({ data: { ...data, storeId: ctx.store.id } });
    }
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, d.id ? "Créneau mis à jour" : "Créneau ajouté");
  });
}

export async function deletePickupSlot(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "delivery.manage");
    const r = await db.pickupSlot.deleteMany({ where: { id, storeId: ctx.store.id } });
    if (r.count === 0) return fail("Créneau introuvable.");
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Créneau supprimé");
  });
}

export async function togglePickupSlot(storeId: string, id: string, active: boolean): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "delivery.manage");
    if (active && !PLANS[ctx.planId].features.pickupSlots) {
      return fail(`Les créneaux de retrait sont inclus à partir du plan Starter (plan actuel : ${PLANS[ctx.planId].name}).`);
    }
    const r = await db.pickupSlot.updateMany({ where: { id, storeId: ctx.store.id }, data: { active } });
    if (r.count === 0) return fail("Créneau introuvable.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "pickup_slot.toggled", target: id, metadata: { active } });
    revalidate(ctx.store.id, ctx.store.slug);
    return success();
  });
}

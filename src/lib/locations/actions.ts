"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, badIds, zBool, zOptionalString, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { MAX_LOCATIONS_HARD, initializeLevelsFromAggregateTx, locationLimit, locationLimitMessage, locationStock } from "./service";

/**
 * Dépôts : création, modification, dépôt par défaut, archivage (lot 3 §4).
 * Capacité `products.manage` (le stock est une donnée catalogue) ; isolation `storeId` sur chaque requête.
 */

const locationSchema = z.object({
  storeId: z.string(),
  id: zOptionalString,
  name: z.string().trim().min(2, "Nom du dépôt requis").max(80),
  type: z.enum(["WAREHOUSE", "STORE", "PICKUP_POINT"]),
  address: zOptionalString,
  city: zOptionalString,
  phone: zOptionalString,
  fulfillsOnlineOrders: zBool,
  pickupEnabled: zBool,
  active: zBool,
});

function revalidate(storeId: string) {
  revalidatePath(`/app/${storeId}/depots`);
  revalidatePath(`/app/${storeId}/produits`);
}

export async function upsertLocation(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(locationSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "products.manage");
    const data = {
      name: d.name,
      type: d.type,
      address: d.address ?? null,
      city: d.city ?? null,
      phone: d.phone ?? null,
      fulfillsOnlineOrders: d.fulfillsOnlineOrders,
      pickupEnabled: d.pickupEnabled,
      active: d.active,
    };
    // Unicité du nom par boutique (contrainte @@unique([storeId, name]) : on la transforme en message clair).
    const clash = await db.location.findFirst({ where: { storeId: ctx.store.id, name: d.name, ...(d.id ? { NOT: { id: d.id } } : {}) }, select: { id: true } });
    if (clash) return fail("Un dépôt porte déjà ce nom.", { name: ["Nom déjà utilisé"] });

    if (d.id) {
      if (badIds(d.id)) return fail("Identifiant invalide");
      const current = await db.location.findFirst({ where: { id: d.id, storeId: ctx.store.id }, select: { isDefault: true } });
      if (!current) return fail("Dépôt introuvable.");
      // Le dépôt par défaut reste actif (il sert les commandes).
      if (current.isDefault && !d.active) return fail("Le dépôt par défaut ne peut pas être désactivé. Désignez d'abord un autre dépôt par défaut.");
      await db.location.updateMany({ where: { id: d.id, storeId: ctx.store.id }, data });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "location.updated", target: d.id, metadata: { name: d.name } });
    } else {
      const count = await db.location.count({ where: { storeId: ctx.store.id } });
      const limit = locationLimit(ctx.planId);
      if (limit != null && count >= limit) return fail(locationLimitMessage(ctx.planId));
      if (count >= MAX_LOCATIONS_HARD) return fail(`Maximum ${MAX_LOCATIONS_HARD} dépôts par boutique.`);
      const created = await db.$transaction(async (tx) => {
        const row = await tx.location.create({
          data: { ...data, storeId: ctx.store.id, country: ctx.store.country, isDefault: count === 0, position: count },
          select: { id: true },
        });
        // PREMIER dépôt de la boutique : il reçoit les stocks agrégés existants (majeur n° 8), sans quoi
        // tous les articles paraîtraient absents des dépôts dès le lendemain (écarts d'inventaire).
        if (count === 0) await initializeLevelsFromAggregateTx(tx, ctx.store.id, row.id);
        return row;
      });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "location.created", target: created.id, metadata: { name: d.name, type: d.type } });
    }
    revalidate(ctx.store.id);
    return success(undefined, d.id ? "Dépôt mis à jour" : "Dépôt ajouté");
  });
}

export async function setDefaultLocation(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "products.manage");
    const target = await db.location.findFirst({ where: { id, storeId: ctx.store.id }, select: { id: true, active: true } });
    if (!target) return fail("Dépôt introuvable.");
    if (!target.active) return fail("Activez d'abord ce dépôt.");
    await db.$transaction(async (tx) => {
      await tx.location.updateMany({ where: { storeId: ctx.store.id, isDefault: true }, data: { isDefault: false } });
      await tx.location.updateMany({ where: { id, storeId: ctx.store.id }, data: { isDefault: true } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "location.set_default", target: id }, tx);
    });
    revalidate(ctx.store.id);
    return success(undefined, "Dépôt par défaut mis à jour");
  });
}

/** Archivage (désactivation) : refusé tant que du stock reste dans le dépôt ou s'il est le dépôt par défaut. */
export async function archiveLocation(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "products.manage");
    const target = await db.location.findFirst({ where: { id, storeId: ctx.store.id }, select: { id: true, isDefault: true, name: true } });
    if (!target) return fail("Dépôt introuvable.");
    if (target.isDefault) return fail("Désignez d'abord un autre dépôt par défaut.");
    const stock = await locationStock(ctx.store.id, id);
    if (stock.lines !== 0) {
      return fail(
        `Ce dépôt porte encore ${stock.lines} article${stock.lines > 1 ? "s" : ""} au niveau non nul (solde ${stock.net}). Transférez ou régularisez ce stock avant de l'archiver.`,
      );
    }
    await db.location.updateMany({ where: { id, storeId: ctx.store.id }, data: { active: false } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "location.archived", target: id, metadata: { name: target.name } });
    revalidate(ctx.store.id);
    return success(undefined, "Dépôt archivé");
  });
}

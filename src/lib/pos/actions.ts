"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, badIds, zOptionalString, zMoneyText, readMoneyFields, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { formatMoney } from "@/lib/money";
import { PLANS } from "@/config/plans";
import { newDeviceToken } from "./device";
import {
  managerCodeFingerprint,
  managerCodeWeakness,
  MANAGER_CODE_MAX_LENGTH,
  MANAGER_CODE_MIN_LENGTH,
  normalizeManagerCode,
} from "./manager-code";
import { addCashMovement, closeSession, openSession, PosSessionError } from "./session";

/**
 * Actions marchand de la caisse (lot 3 §2 et §4) : appareils (enregistrement, révocation), sessions
 * (ouverture, mouvements d'espèces, clôture). Capacité `pos.sell` pour vendre ; l'enregistrement d'un
 * appareil exige `store.settings` (gérant ou propriétaire). Contrôle de plan côté serveur.
 */

function revalidatePos(storeId: string) {
  revalidatePath(`/app/${storeId}/caisse`);
  revalidatePath(`/caisse/${storeId}`);
}

function posUnavailable(planName: string): string {
  return `La caisse en magasin est incluse à partir du plan Business (plan actuel : ${planName}). Changez de plan depuis la page Abonnement.`;
}

const deviceSchema = z.object({
  storeId: z.string(),
  name: z.string().trim().min(2, "Nom de l'appareil requis").max(60),
  locationId: z.string(),
});

/** Enregistre un appareil et renvoie son jeton UNE SEULE FOIS (il n'est plus relisible ensuite). */
export async function registerPosDevice(_prev: ActionResult<{ token: string }> | undefined, formData: FormData): Promise<ActionResult<{ token: string }>> {
  return guard(async () => {
    const parsed = parseForm(deviceSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "store.settings");
    const bad = badIds(d.locationId);
    if (bad) return bad;
    const limit = PLANS[ctx.planId].limits.posDevices;
    if (limit === 0) return fail(posUnavailable(PLANS[ctx.planId].name));
    const count = await db.posDevice.count({ where: { storeId: ctx.store.id, revokedAt: null } });
    if (limit != null && count >= limit) {
      return fail(`Votre plan ${PLANS[ctx.planId].name} permet ${limit} appareil${limit > 1 ? "s" : ""} de caisse. Révoquez un appareil ou changez de plan.`);
    }
    const location = await db.location.findFirst({ where: { id: d.locationId, storeId: ctx.store.id, active: true }, select: { id: true } });
    if (!location) return fail("Dépôt introuvable.");

    const { token, tokenHash, tokenPrefix } = newDeviceToken();
    const device = await db.posDevice.create({
      data: { storeId: ctx.store.id, locationId: location.id, name: d.name, tokenHash, tokenPrefix, createdById: ctx.user.id },
      select: { id: true },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "pos.device_registered", target: device.id, metadata: { name: d.name, locationId: location.id, tokenPrefix } });
    revalidatePos(ctx.store.id);
    return success({ token }, "Appareil enregistré. Copiez le jeton : il ne sera plus affiché.");
  });
}

export async function revokePosDevice(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "store.settings");
    const r = await db.posDevice.updateMany({ where: { id, storeId: ctx.store.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) return fail("Appareil introuvable ou déjà révoqué.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "pos.device_revoked", target: id });
    revalidatePos(ctx.store.id);
    // Les ventes déjà en file sur l'appareil restent acceptées 24 h (aucun encaissement perdu).
    return success(undefined, "Appareil révoqué. Ses ventes en attente seront encore acceptées 24 h.");
  });
}

/* ───────────────────────── Code du gérant (dépassement du plafond de remise) ───────────────────────── */

const managerCodeSchema = z.object({
  storeId: z.string(),
  code: z.string().trim(),
  confirm: z.string().trim(),
});

/**
 * Définit (ou remplace) le code du gérant de la caisse : 4 à 6 chiffres, conservé sous forme
 * d'empreinte HMAC liée à la boutique, jamais réaffiché. Capacité `store.settings` (propriétaire ou
 * gérant) : un caissier STAFF ne peut pas se donner le droit de dépasser son plafond de remise.
 */
export async function setPosManagerCode(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(managerCodeSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "store.settings");
    if (PLANS[ctx.planId].limits.posDevices === 0) return fail(posUnavailable(PLANS[ctx.planId].name));

    const code = normalizeManagerCode(d.code);
    if (!code) {
      return fail(`Le code du gérant comporte ${MANAGER_CODE_MIN_LENGTH} à ${MANAGER_CODE_MAX_LENGTH} chiffres.`, { code: ["Code invalide"] });
    }
    const weak = managerCodeWeakness(code);
    if (weak) return fail(weak, { code: [weak] });
    if (normalizeManagerCode(d.confirm) !== code) return fail("Les deux codes saisis diffèrent.", { confirm: ["Confirmation différente"] });

    await db.store.update({
      where: { id: ctx.store.id },
      data: { posManagerCodeHash: managerCodeFingerprint(ctx.store.id, code), posManagerCodeSetAt: new Date() },
    });
    // Jamais le code (ni sa longueur) dans l'audit : seule la trace de la définition est utile.
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "pos.manager_code_set", target: ctx.store.id });
    revalidatePos(ctx.store.id);
    return success(undefined, "Code du gérant enregistré. Il ne sera plus affiché.");
  });
}

/** Retire le code du gérant : tout dépassement de plafond de remise devient impossible. */
export async function clearPosManagerCode(storeId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "store.settings");
    await db.store.update({ where: { id: ctx.store.id }, data: { posManagerCodeHash: null, posManagerCodeSetAt: null } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "pos.manager_code_cleared", target: ctx.store.id });
    revalidatePos(ctx.store.id);
    return success(undefined, "Code du gérant retiré : aucune remise au-delà des plafonds de rôle n'est désormais possible.");
  });
}

/** Plafond historique des montants de caisse (unités mineures). */
const POS_MAX_MINOR = 100_000_000;

/** Lit un montant de caisse saisi en unités majeures ; `empty` null = champ obligatoire. */
function readPosMoney(raw: string, field: string, currency: string, empty: number | null): { value: number } | { error: ActionResult<never> } {
  const m = readMoneyFields({ [field]: raw }, { [field]: empty }, currency);
  if ("error" in m) return m;
  const v = m.values[field];
  if (v == null) return { error: fail("Indiquez un montant.", { [field]: ["Montant requis"] }) };
  if (v > POS_MAX_MINOR) return { error: fail("Montant trop élevé.", { [field]: ["Montant trop élevé"] }) };
  return { value: v };
}

const openSchema = z.object({ storeId: z.string(), deviceId: z.string(), openingFloat: zMoneyText });

export async function openPosSession(_prev: ActionResult<{ id: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const parsed = parseForm(openSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "pos.sell");
    // Montants de caisse saisis en unités majeures de la devise de la boutique → unités mineures.
    const mf = readPosMoney(d.openingFloat, "openingFloat", ctx.store.currency, 0);
    if ("error" in mf) return mf.error;
    const bad = badIds(d.deviceId);
    if (bad) return bad;
    if (PLANS[ctx.planId].limits.posDevices === 0) return fail(posUnavailable(PLANS[ctx.planId].name));
    const device = await db.posDevice.findFirst({ where: { id: d.deviceId, storeId: ctx.store.id, revokedAt: null }, select: { id: true, locationId: true } });
    if (!device) return fail("Appareil introuvable ou révoqué.");
    try {
      const session = await openSession({ storeId: ctx.store.id, deviceId: device.id, locationId: device.locationId, actorId: ctx.user.id, openingFloat: mf.value });
      revalidatePos(ctx.store.id);
      return success({ id: session.id }, session.reopened ? "Session en cours reprise" : "Caisse ouverte");
    } catch (e) {
      if (e instanceof PosSessionError) return fail(e.message);
      throw e;
    }
  });
}

const closeSchema = z.object({
  storeId: z.string(),
  sessionId: z.string(),
  countedCash: zMoneyText, // unités majeures
  /** Appareil qui ferme (vérifié : la session doit lui appartenir) et file qu'il déclare (mineur n° 13). */
  deviceId: zOptionalString,
  pendingSales: z.coerce.number().int().min(0).max(100_000).optional(),
  blockedSales: z.coerce.number().int().min(0).max(100_000).optional(),
  blockedAmount: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  acknowledgeBlocked: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).optional(),
});

export async function closePosSession(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(closeSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "pos.sell");
    const counted = readPosMoney(d.countedCash, "countedCash", ctx.store.currency, null);
    if ("error" in counted) return counted.error;
    const bad = badIds(d.sessionId, ...(d.deviceId ? [d.deviceId] : []));
    if (bad) return bad;
    try {
      const report = await closeSession({
        storeId: ctx.store.id,
        sessionId: d.sessionId,
        actorId: ctx.user.id,
        countedCash: counted.value,
        canManage: ctx.can("store.settings"),
        deviceId: d.deviceId ?? null,
        pendingSales: d.pendingSales ?? 0,
        blockedSales: d.blockedSales ?? 0,
        blockedAmount: d.blockedAmount ?? 0,
        acknowledgeBlocked: d.acknowledgeBlocked ?? false,
      });
      revalidatePos(ctx.store.id);
      const gap = report.discrepancy ?? 0;
      return success(undefined, gap === 0 ? "Caisse fermée : aucun écart" : `Caisse fermée : écart de ${gap > 0 ? "+" : "−"}${formatMoney(Math.abs(gap), ctx.store.currency)}`);
    } catch (e) {
      if (e instanceof PosSessionError) return fail(e.message);
      throw e;
    }
  });
}

const moveSchema = z.object({
  storeId: z.string(),
  sessionId: z.string(),
  kind: z.enum(["in", "out"]),
  amount: zMoneyText, // unités majeures
  reason: z.string().trim().min(3, "Motif requis").max(120),
});

export async function addPosCashMovement(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(moveSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "pos.sell");
    const mv = readPosMoney(d.amount, "amount", ctx.store.currency, null);
    if ("error" in mv) return mv.error;
    if (mv.value < 1) return fail("Indiquez un montant positif.", { amount: ["Montant requis"] });
    const bad = badIds(d.sessionId);
    if (bad) return bad;
    try {
      await addCashMovement({
        storeId: ctx.store.id,
        sessionId: d.sessionId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        kind: d.kind,
        amount: mv.value,
        reason: d.reason,
        canManage: ctx.can("store.settings"),
      });
      revalidatePos(ctx.store.id);
      return success(undefined, d.kind === "in" ? "Entrée de caisse enregistrée" : "Sortie de caisse enregistrée");
    } catch (e) {
      if (e instanceof PosSessionError) return fail(e.message);
      throw e;
    }
  });
}

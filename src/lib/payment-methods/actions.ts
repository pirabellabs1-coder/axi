"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zOptionalString, type ActionResult } from "@/lib/action";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { getGateway, gatewayCredentials } from "@/lib/payments/gateways";
import { applyAttemptStatus } from "@/lib/payments/service";
import { audit } from "@/lib/audit";
import { PLANS, type PlanId } from "@/config/plans";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { checkGatewayForStore, mergeCredentials } from "./gateway-config";

const KINDS = ["CASH_ON_DELIVERY", "MOBILE_MONEY_MANUAL", "BANK_TRANSFER_MANUAL", "GATEWAY"] as const;

const schema = z.object({
  storeId: z.string(),
  id: zOptionalString,
  kind: z.enum(KINDS),
  label: z.string().trim().min(2, "Libellé requis").max(60),
  provider: zOptionalString,
  instructions: zOptionalString,
  accountNumber: zOptionalString,
  accountName: zOptionalString,
  active: zBool,
});

/**
 * Mobile Money et carte en ligne (méthodes GATEWAY) : réservés à `features.onlinePayments` (Starter et plus).
 * Le paiement à la livraison et les paiements manuels restent disponibles sur tous les plans.
 */
function onlinePaymentsMessage(planId: PlanId) {
  return `Le Mobile Money et la carte en ligne sont inclus à partir du plan Starter (plan actuel : ${PLANS[planId].name}). Le paiement à la livraison et le Mobile Money manuel restent disponibles.`;
}

function revalidate(storeId: string, slug: string) {
  revalidatePath(`/app/${storeId}/paiements`);
  revalidatePath(`/s/${slug}`, "layout");
}

/**
 * Crée ou met à jour un moyen de paiement.
 * Passerelle : les champs `cred_<key>` sont fusionnés avec les identifiants existants ;
 * un secret laissé vide est conservé, un secret saisi remplace l'ancien. Jamais renvoyés au client.
 */
export async function upsertPaymentMethod(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(schema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "payments.manage");

    const existing = d.id ? await db.paymentMethod.findFirst({ where: { id: d.id, storeId: ctx.store.id } }) : null;
    if (d.id && !existing) return fail("Moyen de paiement introuvable.");

    let credentialsEncrypted: string | null | undefined = undefined;
    let provider: string | null = null;
    let channels: string[] = [];

    if (d.kind === "MOBILE_MONEY_MANUAL" && !d.accountNumber) return fail("Indiquez le numéro Mobile Money.", { accountNumber: ["Numéro requis"] });
    if (d.kind === "BANK_TRANSFER_MANUAL" && !d.accountNumber) return fail("Indiquez l'IBAN / RIB.", { accountNumber: ["RIB requis"] });

    // Création d'une passerelle, ou passerelle laissée active : exige le plan. Désactiver reste permis.
    const canOnline = PLANS[ctx.planId].features.onlinePayments;
    if (d.kind === "GATEWAY" && !canOnline && (existing?.kind !== "GATEWAY" || d.active)) return fail(onlinePaymentsMessage(ctx.planId), { kind: ["Plan Starter requis"] });

    if (d.kind === "GATEWAY") {
      const gw = d.provider ? getGateway(d.provider) : null;
      if (!gw) return fail("Choisissez un fournisseur de paiement.", { provider: ["Requis"] });
      provider = gw.id;
      const prev = existing?.credentialsEncrypted && existing.provider === gw.id ? gatewayCredentials(decryptSecret(existing.credentialsEncrypted)) : {};
      const { creds, missing, invalid } = mergeCredentials(gw, (k) => String(formData.get(`cred_${k}`) ?? ""), prev);
      if (invalid.length) return fail(`Valeur non valide : ${invalid.map((m) => m.label).join(", ")}.`);
      if (missing.length) return fail(`Champs manquants : ${missing.map((m) => m.label).join(", ")}.`);
      // Lot 1 bis : pays et devise couverts, portefeuilles proposés (Wave, Orange Money…).
      const check = checkGatewayForStore(gw, ctx.store, creds, formData.getAll("channels"));
      if (!check.ok) return fail(check.error, { [check.field]: [check.error] });
      channels = check.channels;
      credentialsEncrypted = encryptSecret(JSON.stringify(creds));
    } else {
      credentialsEncrypted = null;
    }

    const data = {
      kind: d.kind,
      label: d.label,
      provider,
      instructions: d.instructions ?? null,
      accountNumber: d.kind === "CASH_ON_DELIVERY" || d.kind === "GATEWAY" ? null : (d.accountNumber ?? null),
      accountName: d.kind === "CASH_ON_DELIVERY" || d.kind === "GATEWAY" ? null : (d.accountName ?? null),
      active: d.active,
      credentialsEncrypted,
      channels,
    };

    if (existing) {
      await db.paymentMethod.update({ where: { id: existing.id }, data });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "payment_method.updated", target: existing.id, metadata: { kind: d.kind, provider, channels } });
    } else {
      const count = await db.paymentMethod.count({ where: { storeId: ctx.store.id } });
      if (count >= 20) return fail("Maximum 20 moyens de paiement.");
      const pm = await db.paymentMethod.create({ data: { ...data, storeId: ctx.store.id, position: count } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "payment_method.created", target: pm.id, metadata: { kind: d.kind, provider, channels } });
    }
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, existing ? "Moyen de paiement mis à jour" : "Moyen de paiement ajouté");
  });
}

export async function togglePaymentMethod(storeId: string, id: string, active: boolean): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "payments.manage");
    if (active && !PLANS[ctx.planId].features.onlinePayments) {
      const pm = await db.paymentMethod.findFirst({ where: { id, storeId: ctx.store.id }, select: { kind: true } });
      if (pm?.kind === "GATEWAY") return fail(onlinePaymentsMessage(ctx.planId));
    }
    if (!active) {
      const others = await db.paymentMethod.count({ where: { storeId: ctx.store.id, active: true, id: { not: id } } });
      if (others === 0 && ctx.store.status === "PUBLISHED") return fail("Gardez au moins un moyen de paiement actif sur une boutique publiée.");
    }
    const r = await db.paymentMethod.updateMany({ where: { id, storeId: ctx.store.id }, data: { active } });
    if (r.count === 0) return fail("Moyen de paiement introuvable.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: active ? "payment_method.activated" : "payment_method.deactivated", target: id });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, active ? "Activé" : "Désactivé");
  });
}

export async function movePaymentMethod(storeId: string, id: string, direction: "up" | "down"): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "payments.manage");
    const list = await db.paymentMethod.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return fail("Moyen de paiement introuvable.");
    const t = direction === "up" ? idx - 1 : idx + 1;
    if (t < 0 || t >= list.length) return success();
    [list[idx], list[t]] = [list[t], list[idx]];
    await db.$transaction(list.map((m, i) => db.paymentMethod.update({ where: { id: m.id }, data: { position: i } })));
    revalidate(ctx.store.id, ctx.store.slug);
    return success();
  });
}

export async function deletePaymentMethod(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "payments.manage");
    const pm = await db.paymentMethod.findFirst({ where: { id, storeId: ctx.store.id }, include: { _count: { select: { attempts: true } } } });
    if (!pm) return fail("Moyen de paiement introuvable.");
    if (pm._count.attempts > 0) return fail("Des paiements sont rattachés à ce moyen : désactivez-le plutôt que de le supprimer.");
    await db.paymentMethod.delete({ where: { id: pm.id } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "payment_method.deleted", target: id, metadata: { kind: pm.kind } });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Moyen de paiement supprimé");
  });
}

/**
 * Rapprochement pour CETTE boutique : interroge le fournisseur pour les tentatives INITIATED
 * (webhooks manqués). Même logique que reconcilePendingAttempts (src/lib/payments/service.ts),
 * mais filtrée par storeId via la commande.
 */
export async function reconcileStorePayments(storeId: string): Promise<ActionResult<{ checked: number; updated: number }>> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "payments.manage");
    const attempts = await db.paymentAttempt.findMany({
      where: { status: "INITIATED", providerRef: { not: null }, order: { storeId: ctx.store.id } },
      include: { paymentMethod: true },
      take: 50,
      orderBy: { createdAt: "asc" },
    });
    let updated = 0;
    for (const a of attempts) {
      const gateway = a.paymentMethod?.provider ? getGateway(a.paymentMethod.provider) : null;
      if (!gateway || !a.providerRef) continue;
      const creds = gatewayCredentials(a.paymentMethod?.credentialsEncrypted ? decryptSecret(a.paymentMethod.credentialsEncrypted) : null);
      let s: Awaited<ReturnType<typeof gateway.fetchStatus>> = "UNKNOWN";
      try {
        s = await gateway.fetchStatus(a.providerRef, creds, { initiatedAt: a.updatedAt });
      } catch {
        s = "UNKNOWN";
      }
      if (s === "UNKNOWN" || s === "PENDING") continue;
      await applyAttemptStatus(a.id, s);
      updated++;
    }
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "payments.reconciled", metadata: { checked: attempts.length, updated } });
    revalidatePath(`/app/${ctx.store.id}/paiements`);
    revalidatePath(`/app/${ctx.store.id}/commandes`);
    return success({ checked: attempts.length, updated }, attempts.length === 0 ? "Aucun paiement en attente de vérification" : `${attempts.length} vérifié(s), ${updated} mis à jour`);
  });
}

export type GatewayTestResult = { message: string; warnings: string[] };

/**
 * Test de connexion d'une passerelle avec les clés SAISIES (ou enregistrées si le champ est laissé vide).
 * Aucun paiement n'est créé. Limité à 10 essais / 10 min par boutique (appels sortants).
 */
export async function testPaymentGateway(_prev: ActionResult<GatewayTestResult> | undefined, formData: FormData): Promise<ActionResult<GatewayTestResult>> {
  return guard(async () => {
    const storeId = String(formData.get("storeId") ?? "");
    const ctx = await requireStore(storeId, "payments.manage");
    if (!PLANS[ctx.planId].features.onlinePayments) return fail(onlinePaymentsMessage(ctx.planId));
    const gw = getGateway(String(formData.get("provider") ?? ""));
    if (!gw) return fail("Choisissez un fournisseur de paiement.", { provider: ["Requis"] });
    if (!gw.testConnection) return fail(`Le test de connexion n'est pas disponible pour ${gw.label} : enregistrez le moyen puis passez une commande de test en mode sandbox.`);
    const rl = await rateLimit(`payments:test:${ctx.store.id}`, 10, 10 * 60);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const id = String(formData.get("id") ?? "");
    const existing = id ? await db.paymentMethod.findFirst({ where: { id, storeId: ctx.store.id } }) : null;
    const prev = existing?.credentialsEncrypted && existing.provider === gw.id ? gatewayCredentials(decryptSecret(existing.credentialsEncrypted)) : {};
    const { creds, missing, invalid } = mergeCredentials(gw, (k) => String(formData.get(`cred_${k}`) ?? ""), prev);
    if (invalid.length) return fail(`Valeur non valide : ${invalid.map((m) => m.label).join(", ")}.`);
    if (missing.length) return fail(`Renseignez d'abord : ${missing.map((m) => m.label).join(", ")}.`);

    const r = await gw.testConnection(creds).catch(() => ({ ok: false as const, error: `${gw.label} : test impossible pour le moment. Réessayez.` }));
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "payment_method.connection_tested", target: existing?.id, metadata: { provider: gw.id, ok: r.ok } });
    if (!r.ok) return fail(r.error);
    const warnings = [...(r.warnings ?? [])];
    const check = checkGatewayForStore(gw, ctx.store, creds, formData.getAll("channels"));
    if (!check.ok) warnings.unshift(check.error);
    return success({ message: r.message, warnings }, r.message);
  });
}

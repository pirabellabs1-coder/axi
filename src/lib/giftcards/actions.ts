"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, badIds, zOptionalString, zBool, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { decryptSecret } from "@/lib/crypto";
import { parseMoneyInput, formatMoney } from "@/lib/money";
import { normalizePhone } from "@/lib/utils";
import { getCountry } from "@/config/site";
import { clientIp, rateLimitMessage } from "@/lib/rate-limit";
import { formatGiftCardCode, hashGiftCardCode, normalizeGiftCardCode } from "./code";
import {
  GIFT_CARD_INVALID_MESSAGE,
  GIFT_CARD_MESSAGE_MAX,
  MAX_GIFT_CARD_VALIDITY_DAYS,
  canTransitionGiftCard,
  endOfLocalDay,
  giftCardLimits,
  type GiftCardStatusValue,
} from "./state";
import { createGiftCardRecord, giftCardWhatsappLink } from "./service";
import { getGiftCardsKillSwitch, GIFTCARDS_SUSPENDED_MESSAGE } from "./kill-switch";
import { limitGiftCardCheck, recordInvalidGiftCardAttempt } from "./abuse";

/**
 * Actions des cartes cadeaux (spécification lot 1, §3 et §6).
 * Marchand : `giftcards.manage`, audit `giftcard.*`. Contrôle de plan (`giftCards`) pour la création et les crédits ;
 * désactivation, réactivation, prolongation, débit, révélation et renvoi restent possibles après une baisse de plan
 * (cartes déjà émises : obligation envers l'acheteur).
 * Public : `checkGiftCardBalance` (débit limité, message unique « Carte cadeau invalide »).
 */

function planGate(ctx: StoreContext): ActionResult<never> | null {
  if (PLANS[ctx.planId].features.giftCards) return null;
  return fail(`Les cartes cadeaux sont incluses à partir du plan ${PLANS.BUSINESS.name} (plan actuel : ${PLANS[ctx.planId].name}). Changez de plan depuis /app/${ctx.store.id}/abonnement.`);
}

function revalidate(storeId: string, id?: string) {
  revalidatePath(`/app/${storeId}/cartes-cadeaux`);
  if (id) revalidatePath(`/app/${storeId}/cartes-cadeaux/${id}`);
}

const zText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max, `${max} caractères maximum`).optional());
const zReason = z.string().trim().min(3, "Indiquez un motif (3 caractères minimum)").max(300, "300 caractères maximum");

async function loadCard(storeId: string, id: string) {
  return db.giftCard.findFirst({ where: { id, storeId } });
}

/* ───────────────────────── Création manuelle ───────────────────────── */

const createSchema = z.object({
  storeId: z.string(),
  value: z.string().trim().min(1, "Indiquez une valeur"),
  expiresOn: zOptionalString,
  recipientName: zText(80),
  recipientPhone: zText(30),
  recipientEmail: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.email("Adresse e-mail invalide").max(160).optional()),
  message: zText(GIFT_CARD_MESSAGE_MAX),
  note: zText(300),
  sendNow: zBool,
});

export async function createGiftCard(_prev: ActionResult<{ id: string; code: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string; code: string }>> {
  return guard(async () => {
    const parsed = parseForm(createSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    if (badIds(d.storeId)) return fail("Identifiant invalide");
    const ctx = await requireStore(d.storeId, "giftcards.manage");
    const gate = planGate(ctx);
    if (gate) return gate;
    const store = ctx.store;

    const limits = giftCardLimits(store.currency);
    const value = parseMoneyInput(d.value, store.currency);
    if (value == null || value < limits.minValue || value > limits.maxValue) {
      return fail(`La valeur doit être comprise entre ${formatMoney(limits.minValue, store.currency)} et ${formatMoney(limits.maxValue, store.currency)}.`, { value: ["Valeur hors limites"] });
    }

    const now = new Date();
    let expiresAt: Date | null = null;
    if (d.expiresOn) {
      expiresAt = endOfLocalDay(d.expiresOn, store.timezone);
      if (!expiresAt || expiresAt.getTime() <= now.getTime()) return fail("La date d'expiration doit être dans le futur.", { expiresOn: ["Date future requise"] });
      if (expiresAt.getTime() - now.getTime() > MAX_GIFT_CARD_VALIDITY_DAYS * 86_400_000) return fail("Validité maximale : 5 ans.", { expiresOn: ["5 ans maximum"] });
    }

    let recipientPhone: string | null = null;
    if (d.recipientPhone) {
      recipientPhone = normalizePhone(d.recipientPhone, getCountry(store.country)?.dialCode ?? "229");
      if (!recipientPhone) return fail("Numéro de téléphone invalide.", { recipientPhone: ["Numéro invalide"] });
    }
    const recipientEmail = d.recipientEmail?.toLowerCase() ?? null;
    if (d.sendNow && !recipientEmail && !recipientPhone) return fail("Indiquez un téléphone ou un e-mail pour envoyer la carte.", { recipientEmail: ["Destinataire requis pour l'envoi"] });

    // Rattachement automatique à la fiche client du destinataire (même boutique, même téléphone).
    const customer = recipientPhone ? await db.customer.findFirst({ where: { storeId: store.id, phone: recipientPhone }, select: { id: true } }) : null;

    const card = await db.$transaction(async (tx) => {
      const created = await createGiftCardRecord(
        tx,
        {
          storeId: store.id,
          currency: store.currency,
          initialValue: value,
          status: "ACTIVE",
          source: "MANUAL",
          expiresAt,
          customerId: customer?.id ?? null,
          recipientName: d.recipientName ?? null,
          recipientPhone,
          recipientEmail,
          message: d.message ?? null,
          createdById: ctx.user.id,
        },
        { actorId: ctx.user.id, note: d.note ?? "Création manuelle" },
      );
      await audit({ storeId: store.id, actorId: ctx.user.id, action: "giftcard.created", target: created.id, metadata: { last4: created.last4, value, expiresAt: expiresAt?.toISOString() ?? null } }, tx);
      if (d.sendNow && recipientEmail) await enqueue("giftcard.deliver", { giftCardId: created.id }, { storeId: store.id }, tx);
      return created;
    });
    revalidate(store.id);
    return success({ id: card.id, code: formatGiftCardCode(card.code) }, "Carte cadeau créée");
  });
}

/* ───────────────────────── Transitions ───────────────────────── */

const disableSchema = z.object({ storeId: z.string(), id: z.string(), reason: zReason });

export async function disableGiftCard(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(disableSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const bad = badIds(d.storeId, d.id);
    if (bad) return bad;
    const ctx = await requireStore(d.storeId, "giftcards.manage");
    const card = await loadCard(ctx.store.id, d.id);
    if (!card) return fail("Carte cadeau introuvable.");
    if (!canTransitionGiftCard(card.status, "DISABLED", { expiresAt: card.expiresAt })) return fail("Seule une carte active peut être désactivée.");
    const ok = await db.$transaction(async (tx) => {
      const r = await tx.giftCard.updateMany({ where: { id: card.id, storeId: ctx.store.id, status: "ACTIVE" }, data: { status: "DISABLED", disabledReason: d.reason } });
      if (r.count !== 1) return false;
      await tx.giftCardTransaction.create({ data: { storeId: ctx.store.id, giftCardId: card.id, kind: "ADJUST", amount: 0, balanceAfter: card.balance, actorId: ctx.user.id, note: `Désactivée : ${d.reason}` } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "giftcard.disabled", target: card.id, metadata: { last4: card.last4, reason: d.reason } }, tx);
      return true;
    });
    if (!ok) return fail("La carte a changé entre-temps. Rechargez la page.");
    revalidate(ctx.store.id, card.id);
    return success(undefined, "Carte désactivée");
  });
}

export async function enableGiftCard(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "giftcards.manage");
    const card = await loadCard(ctx.store.id, id);
    if (!card) return fail("Carte cadeau introuvable.");
    if (card.status !== "DISABLED") return fail("Seule une carte désactivée peut être réactivée.");
    if (!canTransitionGiftCard("DISABLED", "ACTIVE", { expiresAt: card.expiresAt })) return fail("Cette carte est expirée : prolongez-la pour la réactiver.");
    const ok = await db.$transaction(async (tx) => {
      const r = await tx.giftCard.updateMany({ where: { id: card.id, storeId: ctx.store.id, status: "DISABLED" }, data: { status: "ACTIVE", disabledReason: null } });
      if (r.count !== 1) return false;
      await tx.giftCardTransaction.create({ data: { storeId: ctx.store.id, giftCardId: card.id, kind: "REACTIVATE", amount: 0, balanceAfter: card.balance, actorId: ctx.user.id, note: "Réactivée" } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "giftcard.enabled", target: card.id, metadata: { last4: card.last4 } }, tx);
      return true;
    });
    if (!ok) return fail("La carte a changé entre-temps. Rechargez la page.");
    revalidate(ctx.store.id, card.id);
    return success(undefined, "Carte réactivée");
  });
}

const extendSchema = z.object({ storeId: z.string(), id: z.string(), expiresOn: z.string().trim().min(1, "Choisissez une date") });

/** Prolongation : nouvelle date future. Une carte EXPIRED redevient ACTIVE (REACTIVATE) ; sinon ADJUST de 0 avec note. */
export async function extendGiftCard(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(extendSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const bad = badIds(d.storeId, d.id);
    if (bad) return bad;
    const ctx = await requireStore(d.storeId, "giftcards.manage");
    const card = await loadCard(ctx.store.id, d.id);
    if (!card) return fail("Carte cadeau introuvable.");
    const now = new Date();
    const expiresAt = endOfLocalDay(d.expiresOn, ctx.store.timezone);
    if (!expiresAt || expiresAt.getTime() <= now.getTime()) return fail("La nouvelle date doit être dans le futur.", { expiresOn: ["Date future requise"] });
    if (expiresAt.getTime() - now.getTime() > MAX_GIFT_CARD_VALIDITY_DAYS * 86_400_000) return fail("Validité maximale : 5 ans.", { expiresOn: ["5 ans maximum"] });
    const reactivate = card.status === "EXPIRED";
    if (reactivate && !canTransitionGiftCard("EXPIRED", "ACTIVE", { expiresAt: card.expiresAt, newExpiresAt: expiresAt, now })) return fail("Date invalide.");
    const ok = await db.$transaction(async (tx) => {
      const r = await tx.giftCard.updateMany({
        where: { id: card.id, storeId: ctx.store.id, status: card.status as GiftCardStatusValue },
        data: reactivate ? { expiresAt, status: "ACTIVE" } : { expiresAt },
      });
      if (r.count !== 1) return false;
      await tx.giftCardTransaction.create({
        data: { storeId: ctx.store.id, giftCardId: card.id, kind: reactivate ? "REACTIVATE" : "ADJUST", amount: 0, balanceAfter: card.balance, actorId: ctx.user.id, note: `Prolongée jusqu'au ${d.expiresOn}` },
      });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "giftcard.extended", target: card.id, metadata: { last4: card.last4, from: card.expiresAt?.toISOString() ?? null, to: expiresAt.toISOString(), reactivated: reactivate } }, tx);
      return true;
    });
    if (!ok) return fail("La carte a changé entre-temps. Rechargez la page.");
    revalidate(ctx.store.id, card.id);
    return success(undefined, reactivate ? "Carte prolongée et réactivée" : "Date d'expiration prolongée");
  });
}

/* ───────────────────────── Ajustement du solde ───────────────────────── */

const adjustSchema = z.object({ storeId: z.string(), id: z.string(), direction: z.enum(["credit", "debit"]), amount: z.string().trim().min(1, "Indiquez un montant"), reason: zReason });

export async function adjustGiftCardBalance(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(adjustSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const bad = badIds(d.storeId, d.id);
    if (bad) return bad;
    const ctx = await requireStore(d.storeId, "giftcards.manage");
    if (d.direction === "credit") {
      const gate = planGate(ctx);
      if (gate) return gate;
    }
    const card = await loadCard(ctx.store.id, d.id);
    if (!card) return fail("Carte cadeau introuvable.");
    const amount = parseMoneyInput(d.amount, card.currency);
    if (amount == null || amount <= 0) return fail("Montant invalide.", { amount: ["Montant invalide"] });
    const limits = giftCardLimits(card.currency);
    if (d.direction === "credit" && card.balance + amount > limits.maxValue) return fail(`Le solde ne peut pas dépasser ${formatMoney(limits.maxValue, card.currency)}.`, { amount: ["Plafond dépassé"] });
    if (d.direction === "debit" && amount > card.balance) return fail("Le montant dépasse le solde de la carte.", { amount: ["Supérieur au solde"] });

    const result = await db.$transaction(async (tx) => {
      const r =
        d.direction === "credit"
          ? await tx.giftCard.updateMany({ where: { id: card.id, storeId: ctx.store.id }, data: { balance: { increment: amount } } })
          : await tx.giftCard.updateMany({ where: { id: card.id, storeId: ctx.store.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
      if (r.count !== 1) return null;
      const after = await tx.giftCard.findUnique({ where: { id: card.id }, select: { balance: true } });
      const balanceAfter = after?.balance ?? 0;
      const signed = d.direction === "credit" ? amount : -amount;
      await tx.giftCardTransaction.create({ data: { storeId: ctx.store.id, giftCardId: card.id, kind: "ADJUST", amount: signed, balanceAfter, actorId: ctx.user.id, note: d.reason } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "giftcard.balance_adjusted", target: card.id, metadata: { last4: card.last4, amount: signed, balanceAfter, reason: d.reason } }, tx);
      return balanceAfter;
    });
    if (result == null) return fail("Le solde a changé entre-temps. Rechargez la page.");
    revalidate(ctx.store.id, card.id);
    return success(undefined, `Solde ajusté : ${formatMoney(result, card.currency)}`);
  });
}

/* ───────────────────────── Révélation et renvoi ───────────────────────── */

/** Code en clair (giftcards.manage), audit `giftcard.code_revealed`. */
export async function revealGiftCardCode(storeId: string, id: string): Promise<ActionResult<{ code: string }>> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "giftcards.manage");
    const card = await loadCard(ctx.store.id, id);
    if (!card) return fail("Carte cadeau introuvable.");
    const code = decryptSecret(card.codeEnc);
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "giftcard.code_revealed", target: card.id, metadata: { last4: card.last4 } });
    return success({ code: formatGiftCardCode(code) });
  });
}

/**
 * Renvoi au destinataire : e-mail → job giftcard.deliver (forcé) ; téléphone seul → lien wa.me prérempli
 * (contient le code : révélation auditée).
 */
export async function resendGiftCard(storeId: string, id: string): Promise<ActionResult<{ waLink?: string }>> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "giftcards.manage");
    const card = await loadCard(ctx.store.id, id);
    if (!card) return fail("Carte cadeau introuvable.");
    if (card.status !== "ACTIVE") return fail("Seule une carte active peut être envoyée.");
    if (card.recipientEmail) {
      await db.$transaction(async (tx) => {
        await enqueue("giftcard.deliver", { giftCardId: card.id, force: true }, { storeId: ctx.store.id }, tx);
        await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "giftcard.resent", target: card.id, metadata: { last4: card.last4, channel: "email" } }, tx);
      });
      return success({}, "Envoi programmé par e-mail");
    }
    if (card.recipientPhone) {
      const link = await giftCardWhatsappLink(card.id, ctx.store.id);
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "giftcard.code_revealed", target: card.id, metadata: { last4: card.last4, via: "resend_whatsapp_link" } });
      return success({ waLink: link ?? undefined });
    }
    return fail("Aucun destinataire enregistré pour cette carte.");
  });
}

/* ───────────────────────── Public : vérification du solde ───────────────────────── */

export type GiftCardBalanceResult = { last4: string; balance: number; currency: string; expiresAt: string | null };

const checkSchema = z.object({ slug: z.string().trim().min(1).max(80), code: z.string().max(64) });

export async function checkGiftCardBalance(_prev: ActionResult<GiftCardBalanceResult> | undefined, formData: FormData): Promise<ActionResult<GiftCardBalanceResult>> {
  return guard(async () => {
    const parsed = parseForm(checkSchema, formData);
    if ("error" in parsed) return fail(GIFT_CARD_INVALID_MESSAGE);
    const store = await db.store.findUnique({ where: { slug: parsed.data.slug }, select: { id: true, status: true, currency: true } });
    if (!store || (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY")) return fail(GIFT_CARD_INVALID_MESSAGE);
    const kill = await getGiftCardsKillSwitch();
    if (kill.enabled) return fail(kill.message || GIFTCARDS_SUSPENDED_MESSAGE);

    const rl = await limitGiftCardCheck({ storeId: store.id, ip: await clientIp() });
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const code = normalizeGiftCardCode(parsed.data.code);
    const card = code
      ? await db.giftCard.findFirst({ where: { storeId: store.id, codeHash: hashGiftCardCode(store.id, code) }, select: { last4: true, balance: true, currency: true, expiresAt: true, status: true } })
      : null;
    const now = Date.now();
    if (!card || card.status !== "ACTIVE" || card.currency !== store.currency || (card.expiresAt && card.expiresAt.getTime() <= now)) {
      await recordInvalidGiftCardAttempt(store.id);
      return fail(GIFT_CARD_INVALID_MESSAGE);
    }
    return success({ last4: card.last4, balance: card.balance, currency: card.currency, expiresAt: card.expiresAt?.toISOString() ?? null });
  });
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Prisma, type ConsentChannel } from "@prisma/client";
import { db } from "@/lib/db";
import { AuthError, effectivePlanId } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zOptionalString, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { clientIp, rateLimitAll, rateLimitMessage } from "@/lib/rate-limit";
import { getCountry } from "@/config/site";
import { formatPhone, normalizePhone } from "@/lib/utils";
import { effectivePrice } from "@/lib/commerce/pricing";
import { canSell, isSellable } from "@/lib/inventory/policy";
import { notifyStore } from "@/lib/notifications/service";
import {
  MAX_ADDRESSES,
  MAX_FAVORITES,
  OTP_INVALID_MESSAGE,
  OTP_MAX_ATTEMPTS,
  OTP_SENT_MESSAGE,
  OTP_SENT_MESSAGE_EMAIL,
  OTP_TTL_MS,
  FAIL_DAILY_CAP,
  emailVerifyRules,
  failuresFrom,
  shouldReissue,
  generateOtpCode,
  hashOtp,
  isOtpUsable,
  maskDestination,
  normalizeCode,
  otpMatches,
  otpRequestRules,
  otpVerifyRules,
  parseIdentifier,
  type BuyerIdentifier,
} from "./otp";
import { createBuyerSession, destroyBuyerSession, getBuyer, revokeCustomerSessions, type Buyer } from "./session";
import { getAccountSettings, getBuyerKillSwitch } from "./settings";
import { sendBuyerOtp } from "./senders";
import { TURNSTILE_FIELD, requireChallenge } from "./challenge";
import { emitDomainEvent } from "@/lib/webhooks/emit";
import { customerEventData } from "@/lib/customers/events";

/**
 * Actions publiques des comptes acheteurs (lot 1, F1). Chaque action :
 *  - résout la boutique par son slug (statuts publics uniquement) ;
 *  - exige la session de CETTE boutique (getBuyer) et filtre toutes les requêtes par storeId + customerId ;
 *  - refuse les écritures si la boutique est fermée temporairement ou si l'arrêt d'urgence plateforme est actif.
 */

const zSlug = z.string().regex(/^[a-z0-9-]{3,48}$/, "Boutique introuvable");
const zCuid = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Identifiant invalide");

type StoreLite = { id: string; slug: string; name: string; status: string; accountsEnabled: boolean; country: string; currency: string; freePlan: boolean };

async function loadStore(slug: unknown): Promise<StoreLite | null> {
  const s = zSlug.safeParse(slug);
  if (!s.success) return null;
  const store = await db.store.findUnique({
    where: { slug: s.data },
    select: { id: true, slug: true, name: true, status: true, accountsEnabled: true, country: true, currency: true, subscription: { select: { planId: true, status: true, trialEndsAt: true, currentPeriodEnd: true } } },
  });
  if (!store || (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY")) return null;
  const { subscription, ...rest } = store;
  // Plan Gratuit : expéditeur Axi soumis à un quota quotidien serré (senders.ts).
  return { ...rest, freePlan: effectivePlanId(subscription ?? null) === "FREE" };
}

const UNAVAILABLE = "Les comptes clients ne sont pas disponibles sur cette boutique.";
const KILLED = "La connexion aux comptes clients est momentanément indisponible. Réessayez plus tard.";
const LOCKED = "Trop d'essais pour ce numéro aujourd'hui. Réessayez demain ou contactez la boutique.";

async function requireBuyer(slug: unknown, opts: { write?: boolean } = {}): Promise<{ store: StoreLite; buyer: Buyer }> {
  const store = await loadStore(slug);
  if (!store) throw new AuthError("Boutique introuvable");
  if (!store.accountsEnabled) throw new AuthError(UNAVAILABLE);
  const buyer = await getBuyer(store);
  if (!buyer) throw new AuthError("Votre session a expiré. Reconnectez-vous.", "UNAUTHENTICATED");
  if (opts.write) {
    if (store.status === "CLOSED_TEMPORARILY") throw new AuthError("La boutique est temporairement fermée : votre compte est en lecture seule.");
    const kill = await getBuyerKillSwitch();
    if (kill.enabled) throw new AuthError(kill.message || KILLED);
  }
  return { store, buyer };
}

const accountPath = (slug: string, rest = "") => `/s/${slug}/compte${rest}`;

/** Durée minimale de réponse de requestOtp (l'envoi lui-même part après la réponse, via after()). */
const MIN_REQUEST_MS = 700;
async function padTo(startedAt: number) {
  const left = MIN_REQUEST_MS - (Date.now() - startedAt);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

const dayPeriod = (d = new Date()) => d.toISOString().slice(0, 10);

/** Indicateurs plateforme (UsageCounter `otp:<canal>`, période jour). Jamais bloquant. */
function count(storeId: string, metric: string) {
  const period = dayPeriod();
  void db.usageCounter
    .upsert({ where: { storeId_metric_period: { storeId, metric, period } }, create: { storeId, metric, period, value: 1 }, update: { value: { increment: 1 } } })
    .catch((e) => console.error("[buyer-otp] compteur", e));
}

/**
 * Plafond d'échecs (audit m4) : au-delà de FAIL_DAILY_CAP essais ratés sur 24 h pour une destination de la boutique,
 * plus aucun code n'est émis ni vérifié jusqu'à ce que la fenêtre glisse. Alerte : UsageCounter `otp:locked`.
 */
async function isDestinationLocked(storeId: string, destination: string): Promise<boolean> {
  const rows = await db.customerOtp.findMany({
    where: { storeId, destination, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    select: { attempts: true, usedAt: true },
    take: 500,
  });
  const locked = failuresFrom(rows) >= FAIL_DAILY_CAP;
  if (locked) {
    count(storeId, "otp:locked");
    console.warn(`[buyer-otp] destination bloquée 24 h après ${FAIL_DAILY_CAP} échecs (boutique ${storeId}).`);
  }
  return locked;
}

/**
 * Émet un code puis l'envoie. Un code encore valable (essais restants) n'est remplacé que si la demande vient de la
 * même IP (audit m3) ; seuls les codes du même client sont expirés (audit m2).
 */
async function issueOtp(store: StoreLite, id: BuyerIdentifier, customerId: string | null, ip: string): Promise<void> {
  const now = new Date();
  const scope = { storeId: store.id, destination: id.destination, customerId, usedAt: null, expiresAt: { gt: now } };
  const active = await db.customerOtp.findFirst({ where: { ...scope, attempts: { lt: OTP_MAX_ATTEMPTS } }, orderBy: { createdAt: "desc" }, select: { id: true, ip: true } });
  if (!shouldReissue(active, ip)) {
    count(store.id, "otp:kept");
    return;
  }
  const code = generateOtpCode();
  const otp = await db.$transaction(async (tx) => {
    await tx.customerOtp.updateMany({ where: scope, data: { expiresAt: now } });
    return tx.customerOtp.create({
      data: {
        storeId: store.id,
        customerId,
        channel: id.kind === "email" ? "EMAIL" : "WHATSAPP",
        destination: id.destination,
        codeHash: hashOtp(store.id, id.destination, code),
        attempts: 0,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        ip,
      },
      select: { id: true, channel: true },
    });
  });
  const settings = await getAccountSettings(store.id);
  const sent = await sendBuyerOtp({ storeId: store.id, storeName: store.name, otpId: otp.id, identifier: id, code, pref: settings.channel, freePlan: store.freePlan });
  if (sent.channel !== otp.channel) await db.customerOtp.updateMany({ where: { id: otp.id, storeId: store.id }, data: { channel: sent.channel } });
  const metric = `otp:${sent.channel.toLowerCase()}`;
  if (sent.delivered) {
    count(store.id, metric);
  } else {
    // Code non envoyé : rendu inutilisable ; jamais le numéro ni le code dans les journaux.
    await db.customerOtp.updateMany({ where: { id: otp.id, storeId: store.id }, data: { expiresAt: new Date() } });
    count(store.id, `${metric}:failed`);
    console.warn(`[buyer-otp] envoi impossible (boutique ${store.id}, canal ${sent.via}) : ${sent.error ?? "inconnu"}`);
  }
}

/** Envoi découplé de la réponse HTTP (audit m1) : même temps de réponse que le code parte ou non. */
function issueAfterResponse(store: StoreLite, id: BuyerIdentifier, customerId: string | null, ip: string) {
  after(async () => {
    try {
      await issueOtp(store, id, customerId, ip);
    } catch (e) {
      console.error("[buyer-otp] émission", e);
    }
  });
}

type ConsumeResult = { ok: true; otpId: string; customerId: string | null } | { ok: false; error: string };

/**
 * Vérifie un code : dernier code actif de la destination, essai compté AVANT la comparaison (incrément
 * conditionnel, 5 au plus), comparaison HMAC en temps constant, consommation conditionnelle (usage unique).
 */
async function consumeOtp(storeId: string, destination: string, rawCode: unknown, customerId?: string): Promise<ConsumeResult> {
  const code = normalizeCode(rawCode);
  const now = new Date();
  const otp = await db.customerOtp.findFirst({
    where: { storeId, destination, usedAt: null, expiresAt: { gt: now }, ...(customerId ? { customerId } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, attempts: true, expiresAt: true, usedAt: true, customerId: true },
  });
  if (!otp || !isOtpUsable(otp, now)) return { ok: false, error: OTP_INVALID_MESSAGE };
  const bumped = await db.customerOtp.updateMany({ where: { id: otp.id, storeId, usedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
  if (bumped.count !== 1) return { ok: false, error: OTP_INVALID_MESSAGE };
  if (!otpMatches(otp.codeHash, storeId, destination, code)) {
    const left = OTP_MAX_ATTEMPTS - (otp.attempts + 1);
    return { ok: false, error: left > 0 ? `Code incorrect. Il vous reste ${left} essai${left > 1 ? "s" : ""}.` : "Code incorrect. Demandez un nouveau code." };
  }
  const used = await db.customerOtp.updateMany({ where: { id: otp.id, storeId, usedAt: null }, data: { usedAt: now } });
  if (used.count !== 1) return { ok: false, error: OTP_INVALID_MESSAGE };
  return { ok: true, otpId: otp.id, customerId: otp.customerId };
}

/** Destination de retour après connexion : uniquement un chemin de CETTE boutique. */
function safeNext(slug: string, next: unknown): string {
  if (typeof next !== "string") return accountPath(slug);
  const base = `/s/${slug}`;
  if ((next === base || next.startsWith(`${base}/`)) && !next.includes("//") && !next.includes("\\") && next.length <= 300 && !next.startsWith(`${base}/compte/connexion`)) return next;
  return accountPath(slug);
}

/** Fiche unique portant cet e-mail vérifié dans la boutique (sinon null : connexion par e-mail impossible). */
async function verifiedEmailOwner(storeId: string, email: string): Promise<string | null> {
  const matches = await db.customer.findMany({
    where: { storeId, email: { equals: email, mode: "insensitive" }, emailVerifiedAt: { not: null } },
    select: { id: true },
    take: 2,
  });
  return matches.length === 1 ? matches[0]!.id : null;
}

/* ───────────────────────── Connexion ───────────────────────── */

const requestSchema = z.object({ slug: zSlug, identifier: z.string().trim().min(1, "Saisissez votre numéro ou votre e-mail").max(254) });

export type OtpRequestData = { masked: string; kind: "phone" | "email"; identifier: string };

export async function requestOtp(_prev: ActionResult<OtpRequestData> | undefined, formData: FormData): Promise<ActionResult<OtpRequestData>> {
  return guard(async () => {
    const startedAt = Date.now();
    const parsed = parseForm(requestSchema, formData);
    if ("error" in parsed) return parsed.error;
    const store = await loadStore(parsed.data.slug);
    if (!store) return fail("Boutique introuvable.");
    if (!store.accountsEnabled) return fail(UNAVAILABLE);
    const kill = await getBuyerKillSwitch();
    if (kill.enabled) return fail(kill.message || KILLED);

    const id = parseIdentifier(parsed.data.identifier, getCountry(store.country).dialCode);
    if (!id) return fail("Saisissez un numéro de téléphone ou une adresse e-mail valide.", { identifier: ["Numéro ou e-mail invalide"] });

    const ip = await clientIp();
    const challenge = await requireChallenge(ip, formData.get(TURNSTILE_FIELD));
    if (challenge) return fail(challenge, { challenge: [challenge] });
    const rl = await rateLimitAll(otpRequestRules(store.id, id.destination, ip));
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    // Destination bloquée (trop d'échecs) : même réponse, aucun code.
    if (!(await isDestinationLocked(store.id, id.destination))) {
      if (id.kind === "email") {
        // Connexion par e-mail : seulement si UNE fiche de la boutique porte cet e-mail vérifié.
        const owner = await verifiedEmailOwner(store.id, id.destination);
        if (owner) issueAfterResponse(store, id, owner, ip);
      } else {
        // Numéro jamais vu : même message, la fiche n'est créée qu'à la vérification.
        const existing = await db.customer.findUnique({ where: { storeId_phone: { storeId: store.id, phone: id.destination } }, select: { id: true } });
        issueAfterResponse(store, id, existing?.id ?? null, ip);
      }
    }
    await padTo(startedAt);
    return success({ masked: maskDestination(id), kind: id.kind, identifier: id.destination }, id.kind === "email" ? OTP_SENT_MESSAGE_EMAIL : OTP_SENT_MESSAGE);
  });
}

const verifySchema = z.object({ slug: zSlug, identifier: z.string().trim().min(1).max(254), code: z.string().max(20), next: zOptionalString });

export async function verifyOtp(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(verifySchema, formData);
    if ("error" in parsed) return parsed.error;
    const store = await loadStore(parsed.data.slug);
    if (!store) return fail("Boutique introuvable.");
    if (!store.accountsEnabled) return fail(UNAVAILABLE);
    const kill = await getBuyerKillSwitch();
    if (kill.enabled) return fail(kill.message || KILLED);

    const id = parseIdentifier(parsed.data.identifier, getCountry(store.country).dialCode);
    if (!id) return fail(OTP_INVALID_MESSAGE);
    if (normalizeCode(parsed.data.code).length !== 6) return fail("Le code contient 6 chiffres.", { code: ["6 chiffres"] });

    const ip = await clientIp();
    const rl = await rateLimitAll(otpVerifyRules(store.id, ip));
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));
    const isEmail = id.kind === "email";
    // E-mail : réponse toujours identique (audit m1), ni compteur d'essais ni message de blocage.
    const invalid = (msg: string) => fail(isEmail ? OTP_INVALID_MESSAGE : msg, { code: [isEmail ? OTP_INVALID_MESSAGE : msg] });
    if (await isDestinationLocked(store.id, id.destination)) return invalid(LOCKED);

    const now = new Date();
    let customerId: string;
    if (isEmail) {
      const owner = await verifiedEmailOwner(store.id, id.destination);
      if (!owner) return invalid(OTP_INVALID_MESSAGE);
      const res = await consumeOtp(store.id, id.destination, parsed.data.code, owner);
      if (!res.ok) return invalid(res.error);
      await db.customer.updateMany({ where: { id: owner, storeId: store.id }, data: { lastLoginAt: now } });
      customerId = owner;
    } else {
      const res = await consumeOtp(store.id, id.destination, parsed.data.code);
      if (!res.ok) return invalid(res.error);
      customerId = await upsertPhoneCustomer(store.id, id.destination, now);
      await db.customerOtp.updateMany({ where: { id: res.otpId, storeId: store.id, customerId: null }, data: { customerId } });
    }
    await createBuyerSession(store.id, store.slug, customerId);
    count(store.id, "otp:verified");
    redirect(safeNext(store.slug, parsed.data.next));
  });
}

/** Le code prouve la possession du numéro : fiche créée ou marquée vérifiée (course entre deux connexions gérée). */
async function upsertPhoneCustomer(storeId: string, phone: string, now: Date): Promise<string> {
  const data = { phoneVerifiedAt: now, lastLoginAt: now };
  try {
    const c = await db.customer.upsert({
      where: { storeId_phone: { storeId, phone } },
      create: { storeId, phone, name: formatPhone(phone), ...data },
      update: data,
      select: { id: true, name: true, createdAt: true },
    });
    // Lot 2 (W) : fiche créée par cette connexion (horodatage de création = celui de la vérification).
    if (c.createdAt.getTime() >= now.getTime()) {
      await emitDomainEvent(db, storeId, "customer.created", customerEventData({ id: c.id, name: c.name, phone }, { source: "buyer_account" })).catch((err) => console.error("[buyer] customer.created", err));
    }
    return c.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const c = await db.customer.update({ where: { storeId_phone: { storeId, phone } }, data, select: { id: true } });
      return c.id;
    }
    throw e;
  }
}

/* ───────────────────────── Session ───────────────────────── */

export async function logoutBuyer(slug: string): Promise<ActionResult> {
  return guard(async () => {
    const store = await loadStore(slug);
    if (!store) return fail("Boutique introuvable.");
    await destroyBuyerSession(store.id, store.slug);
    redirect(`/s/${store.slug}`);
  });
}

export async function logoutAllDevices(slug: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, buyer } = await requireBuyer(slug);
    const n = await revokeCustomerSessions(store.id, buyer.customerId);
    await audit({ storeId: store.id, action: "buyer.sessions_revoked", target: buyer.customerId, metadata: { sessions: n, by: "buyer" } });
    await destroyBuyerSession(store.id, store.slug);
    redirect(`${accountPath(store.slug, "/connexion")}?deconnecte=1`);
  });
}

/* ───────────────────────── Profil ───────────────────────── */

const nameSchema = z.object({ slug: zSlug, name: z.string().trim().min(2, "Indiquez votre nom (2 caractères minimum)").max(80, "80 caractères maximum") });

export async function updateBuyerName(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(nameSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { store, buyer } = await requireBuyer(parsed.data.slug, { write: true });
    await db.customer.updateMany({ where: { id: buyer.customerId, storeId: store.id }, data: { name: parsed.data.name } });
    revalidatePath(accountPath(store.slug));
    return success(undefined, "Nom enregistré");
  });
}

/* ───────────────────────── Adresses ───────────────────────── */

const addressSchema = z.object({
  slug: zSlug,
  id: z.preprocess((v) => (v === "" ? undefined : v), zCuid.optional()),
  label: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(40, "40 caractères maximum").optional()),
  recipientName: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(80, "80 caractères maximum").optional()),
  phone: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(24).optional()),
  address: z.string().trim().min(3, "Indiquez l'adresse (quartier, rue)").max(300, "300 caractères maximum"),
  landmark: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(200, "200 caractères maximum").optional()),
  city: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(80, "80 caractères maximum").optional()),
  deliveryZoneId: z.preprocess((v) => (v === "" ? undefined : v), zCuid.optional()),
  isDefault: zBool,
});

export async function saveAddress(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(addressSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { store, buyer } = await requireBuyer(parsed.data.slug, { write: true });
    const d = parsed.data;
    const sid = store.id;
    const cid = buyer.customerId;

    let phone: string | null = null;
    if (d.phone) {
      phone = normalizePhone(d.phone, getCountry(store.country).dialCode);
      if (!phone) return fail("Numéro de téléphone invalide.", { phone: ["Numéro invalide"] });
    }
    if (d.deliveryZoneId) {
      const zone = await db.deliveryZone.findFirst({ where: { id: d.deliveryZoneId, storeId: sid, active: true }, select: { id: true } });
      if (!zone) return fail("Zone de livraison introuvable.", { deliveryZoneId: ["Zone introuvable"] });
    }
    const data = { label: d.label ?? null, recipientName: d.recipientName ?? null, phone, address: d.address, landmark: d.landmark ?? null, city: d.city ?? null, deliveryZoneId: d.deliveryZoneId ?? null };

    const result = await db.$transaction(async (tx) => {
      // Verrou par client : deux ajouts simultanés ne dépassent pas la limite de 10.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`buyer-address:${cid}`}))`;
      const existingCount = await tx.customerAddress.count({ where: { storeId: sid, customerId: cid } });
      if (d.id) {
        const current = await tx.customerAddress.findFirst({ where: { id: d.id, storeId: sid, customerId: cid }, select: { id: true, isDefault: true } });
        if (!current) return "missing" as const;
        if (d.isDefault && !current.isDefault) await tx.customerAddress.updateMany({ where: { storeId: sid, customerId: cid, isDefault: true }, data: { isDefault: false } });
        await tx.customerAddress.update({ where: { id: current.id }, data: { ...data, isDefault: current.isDefault || d.isDefault } });
        return "ok" as const;
      }
      if (existingCount >= MAX_ADDRESSES) return "full" as const;
      const makeDefault = d.isDefault || existingCount === 0;
      if (makeDefault) await tx.customerAddress.updateMany({ where: { storeId: sid, customerId: cid, isDefault: true }, data: { isDefault: false } });
      await tx.customerAddress.create({ data: { ...data, storeId: sid, customerId: cid, isDefault: makeDefault } });
      return "ok" as const;
    });
    if (result === "missing") return fail("Adresse introuvable.");
    if (result === "full") return fail(`Vous avez atteint ${MAX_ADDRESSES} adresses. Supprimez-en une pour en ajouter une nouvelle.`);
    revalidatePath(accountPath(store.slug, "/adresses"));
    return success(undefined, d.id ? "Adresse mise à jour" : "Adresse ajoutée");
  });
}

export async function deleteAddress(slug: string, addressId: string): Promise<ActionResult> {
  return guard(async () => {
    if (!zCuid.safeParse(addressId).success) return fail("Identifiant invalide");
    const { store, buyer } = await requireBuyer(slug, { write: true });
    const sid = store.id;
    const cid = buyer.customerId;
    const ok = await db.$transaction(async (tx) => {
      const current = await tx.customerAddress.findFirst({ where: { id: addressId, storeId: sid, customerId: cid }, select: { id: true, isDefault: true } });
      if (!current) return false;
      await tx.customerAddress.deleteMany({ where: { id: current.id, storeId: sid, customerId: cid } });
      if (current.isDefault) {
        const next = await tx.customerAddress.findFirst({ where: { storeId: sid, customerId: cid }, orderBy: { updatedAt: "desc" }, select: { id: true } });
        if (next) await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      return true;
    });
    if (!ok) return fail("Adresse introuvable.");
    revalidatePath(accountPath(store.slug, "/adresses"));
    return success(undefined, "Adresse supprimée");
  });
}

export async function setDefaultAddress(slug: string, addressId: string): Promise<ActionResult> {
  return guard(async () => {
    if (!zCuid.safeParse(addressId).success) return fail("Identifiant invalide");
    const { store, buyer } = await requireBuyer(slug, { write: true });
    const sid = store.id;
    const cid = buyer.customerId;
    const ok = await db.$transaction(async (tx) => {
      const current = await tx.customerAddress.findFirst({ where: { id: addressId, storeId: sid, customerId: cid }, select: { id: true } });
      if (!current) return false;
      await tx.customerAddress.updateMany({ where: { storeId: sid, customerId: cid, isDefault: true }, data: { isDefault: false } });
      await tx.customerAddress.update({ where: { id: current.id }, data: { isDefault: true } });
      return true;
    });
    if (!ok) return fail("Adresse introuvable.");
    revalidatePath(accountPath(store.slug, "/adresses"));
    return success(undefined, "Adresse par défaut modifiée");
  });
}

/* ───────────────────────── Favoris ───────────────────────── */

/**
 * Ajoute ou retire un favori (cœur des cartes produit et de la fiche, équipe E).
 * Non connecté : échec « Connectez-vous… » (l'appelant redirige vers /compte/connexion).
 */
export async function toggleFavorite(slug: string, productId: string): Promise<ActionResult<{ favorited: boolean }>> {
  return guard<{ favorited: boolean }>(async () => {
    if (!zCuid.safeParse(productId).success) return fail("Identifiant invalide");
    const { store, buyer } = await requireBuyer(slug, { write: true });
    const sid = store.id;
    const cid = buyer.customerId;
    const existing = await db.customerFavorite.findFirst({ where: { storeId: sid, customerId: cid, productId }, select: { id: true } });
    if (existing) {
      await db.customerFavorite.deleteMany({ where: { id: existing.id, storeId: sid, customerId: cid } });
      revalidatePath(accountPath(store.slug, "/favoris"));
      return success({ favorited: false }, "Retiré de vos favoris");
    }
    const product = await db.product.findFirst({ where: { id: productId, storeId: sid, status: "ACTIVE" }, select: { id: true } });
    if (!product) return fail("Produit introuvable.");
    const n = await db.customerFavorite.count({ where: { storeId: sid, customerId: cid } });
    if (n >= MAX_FAVORITES) return fail(`Vous avez atteint ${MAX_FAVORITES} favoris. Retirez-en pour en ajouter.`);
    try {
      await db.customerFavorite.create({ data: { storeId: sid, customerId: cid, productId: product.id } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // double clic : déjà favori
    }
    revalidatePath(accountPath(store.slug, "/favoris"));
    return success({ favorited: true }, "Ajouté à vos favoris");
  });
}

/* ───────────────────────── Commander à nouveau ───────────────────────── */

export type ReorderLine = {
  productId: string;
  variantId: string | null;
  optionIds: string[];
  quantity: number;
  snapshot: { name: string; variantName: string | null; unitPrice: number; image: string | null; productSlug: string; optionNames: string[] };
};
export type ReorderData = { lines: ReorderLine[]; skipped: string[] };

function firstImage(images: unknown, variantImage: string | null | undefined): string | null {
  if (variantImage) return variantImage;
  if (!Array.isArray(images)) return null;
  const f = images.find((i) => i && typeof i === "object" && typeof (i as { url?: unknown }).url === "string") as { url: string } | undefined;
  return f?.url ?? null;
}

/**
 * Reconstruit un panier depuis une commande de l'acheteur : suppléments retrouvés par nom dans leur groupe,
 * articles indisponibles ignorés (avec avertissement), prix ACTUELS (le serveur recalcule tout à la commande).
 */
export async function reorder(slug: string, reference: string): Promise<ActionResult<ReorderData>> {
  return guard(async () => {
    if (typeof reference !== "string" || !/^[A-Za-z0-9-]{3,40}$/.test(reference)) return fail("Commande introuvable.");
    const { store, buyer } = await requireBuyer(slug);
    if (store.status === "CLOSED_TEMPORARILY") return fail("La boutique est temporairement fermée : les commandes reprendront bientôt.");
    const order = await db.order.findFirst({
      where: { storeId: store.id, customerId: buyer.customerId, reference },
      select: { items: { select: { productId: true, variantId: true, name: true, variantName: true, options: true, quantity: true, isGiftCard: true } } },
    });
    if (!order) return fail("Commande introuvable.");
    const ids = [...new Set(order.items.map((i) => i.productId).filter((x): x is string => !!x))];
    const products = ids.length
      ? await db.product.findMany({ where: { storeId: store.id, id: { in: ids }, status: "ACTIVE" }, include: { variants: true, optionGroups: { include: { options: true } } } })
      : [];
    const now = new Date();
    const lines: ReorderLine[] = [];
    const skipped: string[] = [];
    for (const item of order.items) {
      const label = item.variantName ? `${item.name} (${item.variantName})` : item.name;
      const p = products.find((x) => x.id === item.productId);
      if (!p || item.isGiftCard || p.isGiftCard) {
        skipped.push(label);
        continue;
      }
      const variant = item.variantId ? p.variants.find((v) => v.id === item.variantId && v.available) : null;
      if ((item.variantId && !variant) || (p.variants.length > 0 && !variant)) {
        skipped.push(label);
        continue;
      }
      // Suppléments : retrouvés par nom dans les groupes actuels du produit.
      const wanted = Array.isArray(item.options) ? (item.options as { name?: unknown }[]).map((o) => (typeof o?.name === "string" ? o.name : null)).filter((n): n is string => !!n) : [];
      const picked: { id: string; name: string; priceDelta: number }[] = [];
      let missingOption = false;
      for (const name of wanted) {
        const opt = p.optionGroups.flatMap((g) => g.options).find((o) => o.name === name && !picked.some((x) => x.id === o.id));
        if (opt) picked.push({ id: opt.id, name: opt.name, priceDelta: opt.priceDelta });
        else missingOption = true;
      }
      const requiredUnmet = p.optionGroups.some((g) => g.required && g.options.filter((o) => picked.some((x) => x.id === o.id)).length < Math.max(1, g.minSelect));
      if (missingOption || requiredUnmet) {
        skipped.push(label);
        continue;
      }
      const stockItem = variant ? { trackStock: p.trackStock, stock: variant.stock, policy: variant.inventoryPolicy } : { trackStock: p.trackStock, stock: p.stock, policy: p.inventoryPolicy };
      if (!isSellable(stockItem)) {
        skipped.push(label);
        continue;
      }
      let quantity = Math.min(999, Math.max(1, item.quantity));
      if (p.maxQty) quantity = Math.min(quantity, p.maxQty);
      if (!canSell(stockItem, quantity)) quantity = Math.max(1, stockItem.stock);
      const unitPrice = (variant?.price ?? effectivePrice(p, now).price) + picked.reduce((s, o) => s + o.priceDelta, 0);
      lines.push({
        productId: p.id,
        variantId: variant?.id ?? null,
        optionIds: picked.map((o) => o.id),
        quantity,
        snapshot: { name: p.name, variantName: variant?.name ?? null, unitPrice, image: firstImage(p.images, variant?.imageUrl), productSlug: p.slug, optionNames: picked.map((o) => o.name) },
      });
    }
    if (lines.length === 0) return fail("Les articles de cette commande ne sont plus disponibles.");
    return success({ lines, skipped }, skipped.length ? `${skipped.length} article${skipped.length > 1 ? "s" : ""} indisponible${skipped.length > 1 ? "s" : ""} ignoré${skipped.length > 1 ? "s" : ""}.` : "Articles ajoutés au panier");
  });
}

/* ───────────────────────── Préférences et données ───────────────────────── */

const consentSchema = z.object({ slug: zSlug, marketing: zBool });

/** Consentement marketing WhatsApp, journalisé (`Consent`, source `account`) uniquement s'il change. */
export async function updateBuyerConsent(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(consentSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { store, buyer } = await requireBuyer(parsed.data.slug, { write: true });
    const latest = await db.consent.findFirst({
      where: { customerId: buyer.customerId, customer: { storeId: store.id }, channel: "WHATSAPP", purpose: "MARKETING" },
      orderBy: { createdAt: "desc" },
      select: { granted: true },
    });
    if (latest?.granted !== parsed.data.marketing) {
      await db.consent.create({ data: { customerId: buyer.customerId, channel: "WHATSAPP", purpose: "MARKETING", granted: parsed.data.marketing, source: "account" } });
    }
    revalidatePath(accountPath(store.slug));
    return success(undefined, parsed.data.marketing ? "Vous recevrez les offres de la boutique sur WhatsApp." : "Vous ne recevrez plus d'offres sur WhatsApp.");
  });
}

/**
 * « Supprimer mon compte » : sessions révoquées, consentement marketing retiré, demande visible du commerçant
 * (centre de notifications + journal d'audit) qui anonymise la fiche via deleteCustomer.
 */
export async function requestAccountDeletion(slug: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, buyer } = await requireBuyer(slug);
    const sid = store.id;
    const cid = buyer.customerId;
    await db.$transaction(async (tx) => {
      await revokeCustomerSessions(sid, cid, tx);
      const channels: ConsentChannel[] = ["WHATSAPP", "SMS", "EMAIL"];
      await tx.consent.createMany({ data: channels.map((channel) => ({ customerId: cid, channel, purpose: "MARKETING" as const, granted: false, source: "account" })) });
      await notifyStore(
        sid,
        {
          kind: "other",
          key: `account-deletion:${cid}:${dayPeriod()}`,
          title: "Demande de suppression de compte client",
          text: `${buyer.customer.name} demande la suppression de son compte. Ouvrez la fiche client pour anonymiser ses données.`,
          href: `/app/${sid}/clients/${cid}`,
        },
        tx,
      );
      await audit({ storeId: sid, action: "customer.deletion_requested", target: cid, metadata: { source: "account" } }, tx);
    });
    await destroyBuyerSession(sid, store.slug);
    redirect(`${accountPath(store.slug, "/connexion")}?suppression=1`);
  });
}

const emailSchema = z.object({ slug: zSlug, email: z.string().trim().max(254), code: zOptionalString });

/**
 * Vérification de l'e-mail depuis l'espace compte (permet ensuite la connexion par e-mail).
 * Sans `code` : envoie un code ; avec `code` : le vérifie. Un e-mail vérifié n'appartient qu'à une fiche par boutique.
 */
export async function verifyBuyerEmail(_prev: ActionResult<{ step: "code" | "done"; email: string }> | undefined, formData: FormData): Promise<ActionResult<{ step: "code" | "done"; email: string }>> {
  return guard<{ step: "code" | "done"; email: string }>(async () => {
    const parsed = parseForm(emailSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { store, buyer } = await requireBuyer(parsed.data.slug, { write: true });
    const id = parseIdentifier(parsed.data.email, "229");
    if (!id || id.kind !== "email") return fail("Adresse e-mail invalide.", { email: ["Adresse invalide"] });
    const sid = store.id;
    const cid = buyer.customerId;
    const ip = await clientIp();

    if (!parsed.data.code) {
      if (buyer.customer.emailVerifiedAt && buyer.customer.email?.toLowerCase() === id.destination) return success({ step: "done", email: id.destination }, "Cette adresse est déjà vérifiée.");
      // Plafond propre à la vérification d'e-mail (3 / jour / client, audit m2) en plus des débits d'émission.
      const rl = await rateLimitAll([...emailVerifyRules(cid), ...otpRequestRules(sid, id.destination, ip)]);
      if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));
      if (!(await isDestinationLocked(sid, id.destination))) issueAfterResponse(store, id, cid, ip);
      return success({ step: "code", email: id.destination }, `Un code vient d'être envoyé à ${maskDestination(id)}.`);
    }

    const rl = await rateLimitAll(otpVerifyRules(sid, ip));
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));
    if (await isDestinationLocked(sid, id.destination)) return fail(OTP_INVALID_MESSAGE, { code: [OTP_INVALID_MESSAGE] });
    const res = await consumeOtp(sid, id.destination, parsed.data.code, cid);
    if (!res.ok) return fail(res.error, { code: [res.error] });
    await db.$transaction(async (tx) => {
      await tx.customer.updateMany({
        where: { storeId: sid, id: { not: cid }, email: { equals: id.destination, mode: "insensitive" }, emailVerifiedAt: { not: null } },
        data: { emailVerifiedAt: null },
      });
      await tx.customer.updateMany({ where: { id: cid, storeId: sid }, data: { email: id.destination, emailVerifiedAt: new Date() } });
    });
    revalidatePath(accountPath(store.slug));
    return success({ step: "done", email: id.destination }, "Adresse e-mail vérifiée : vous pouvez l'utiliser pour vous connecter.");
  });
}

import "server-only";
import type { DomainCharge, DomainRegistration, Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { enqueue, queueNotification } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { SITE } from "@/config/site";
import { addDays, formatDate, randomToken } from "@/lib/utils";
import { ONE, isFresh, resolvePlatformRate, type FxRate } from "@/lib/currency/convert";
import { loadPlatformRates } from "@/lib/currency/rates";
import { nextInvoiceNumber } from "@/lib/billing/service";
import { DEFAULT_MARGIN, normalizeMargin, priceDomain, type DomainPrice, type MarginSettings } from "./pricing";
import { anonymizedContact, extensionVariants, parseDomain, domainErrorMessage, sanitizeRegistrarMessage, sellableTlds, type DomainContact } from "./names";
import { dnsTarget, getRegistrar } from "./registrar";
import { classifyRegistrarError } from "./registrar/types";

/**
 * Achat et renouvellement de noms de domaine (Axi revendeur Route 53). Détail : docs/DOMAINES.md.
 *
 * Invariants :
 *  - aucun appel `register` / `renew` sans facture plateforme PAYÉE (DomainCharge PAID, posé uniquement par
 *    confirmInvoicePayment) ;
 *  - une facture = une DomainCharge (invoiceId unique) ; transitions par updateMany conditionnel (idempotence) ;
 *  - toute lecture côté marchand est filtrée par storeId.
 */

type Db = Tx | typeof db;
const DAY_MS = 86_400_000;

export const MARGIN_SETTING_KEY = "domains.margin";
/** Facture d'achat : à régler sous 2 jours (le nom n'est pas réservé avant paiement). */
export const REGISTER_INVOICE_DUE_DAYS = 2;
/** Facture de renouvellement émise J-30, échéance J-7 ; impayée à J-7 ⇒ auto-renouvellement coupé chez le registrar. */
export const RENEW_INVOICE_DAYS_BEFORE = 30;
export const RENEW_DUE_DAYS_BEFORE = 7;
export const REMINDER_DAYS = [30, 7, 1] as const;
/** Suivi d'une opération registrar : relances espacées (2, 4, 8 … 30 min), abandon après ~3 jours. */
export const MAX_POLLS = 160;

/* ───────────────────────── Réglages (marge) ───────────────────────── */

export async function getDomainMargin(client: Db = db): Promise<MarginSettings> {
  const row = await client.platformSetting.findUnique({ where: { key: MARGIN_SETTING_KEY } });
  return row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? normalizeMargin(row.value as Partial<MarginSettings>) : DEFAULT_MARGIN;
}

/* ───────────────────────── Taux USD → devise ───────────────────────── */

/** 1 USD en unités majeures de `currency` (taux plateforme BCE, frais de moins de 72 h), ou null. */
export async function usdRate(currency: string, now = new Date(), client: Db = db): Promise<FxRate | null> {
  if (currency === "USD") return ONE;
  const rows = await loadPlatformRates({ client });
  const r = resolvePlatformRate("USD", currency, rows);
  if (!r || !isFresh(r, now)) return null;
  return r.rate;
}

export type QuoteResult = { ok: true; price: DomainPrice; wholesaleUsdCentsPerYear: number } | { ok: false; error: string };

/** Prix courant (achat ou renouvellement) dans la devise de la boutique. */
export async function quoteDomain(domain: string, currency: string, kind: "REGISTER" | "RENEW", years = 1, now = new Date(), client: Db = db): Promise<QuoteResult> {
  const tld = domain.split(".").pop() ?? "";
  const registrar = await getRegistrar();
  const prices = await registrar.prices(tld);
  if (!prices) return { ok: false, error: `Tarif indisponible pour l'extension .${tld}.` };
  const rate = await usdRate(currency, now, client);
  if (!rate) return { ok: false, error: `Taux de change USD → ${currency} indisponible pour le moment. Réessayez plus tard.` };
  const wholesale = kind === "REGISTER" ? prices.registerUsdCents : prices.renewUsdCents;
  const margin = await getDomainMargin(client);
  return { ok: true, wholesaleUsdCentsPerYear: wholesale, price: priceDomain({ wholesaleUsdCentsPerYear: wholesale, years, currency, rate, margin }) };
}

/* ───────────────────────── Recherche ───────────────────────── */

export type SearchItem = { domain: string; available: boolean; price: number | null; renewPrice: number | null; currency: string };
export type SearchResult = { ok: true; query: SearchItem; suggestions: SearchItem[] } | { ok: false; error: string };

export async function searchDomains(raw: string, currency: string, now = new Date()): Promise<SearchResult> {
  const allowed = sellableTlds();
  const parsed = parseDomain(raw.includes(".") ? raw : `${raw}.com`, allowed);
  if ("error" in parsed) return { ok: false, error: domainErrorMessage(parsed, allowed) };
  const registrar = await getRegistrar();
  const item = async (domain: string, known?: boolean): Promise<SearchItem> => {
    const available = known ?? (await registrar.checkAvailability(domain)) === "AVAILABLE";
    if (!available) return { domain, available, price: null, renewPrice: null, currency };
    const [reg, ren] = await Promise.all([quoteDomain(domain, currency, "REGISTER", 1, now), quoteDomain(domain, currency, "RENEW", 1, now)]);
    return { domain, available: reg.ok, price: reg.ok ? reg.price.price : null, renewPrice: ren.ok ? ren.price.price : null, currency };
  };
  const query = await item(parsed.ascii);
  let candidates: { domain: string; available?: boolean }[] = [];
  try {
    candidates = (await registrar.suggestions(parsed.ascii, 10)).filter((s) => s.available && allowed.includes(s.domain.split(".").pop() ?? "") && s.domain.split(".").length === 2);
  } catch {
    candidates = [];
  }
  if (candidates.length < 3) candidates.push(...extensionVariants(parsed, allowed, 4).map((domain) => ({ domain })));
  const seen = new Set([parsed.ascii]);
  const picked = candidates.filter((c) => (seen.has(c.domain) ? false : (seen.add(c.domain), true))).slice(0, 5);
  const suggestions = (await Promise.all(picked.map((c) => item(c.domain, c.available).catch(() => null)))).filter((s): s is SearchItem => !!s && s.available);
  return { ok: true, query, suggestions };
}

/* ───────────────────────── Commande (facture) ───────────────────────── */

const ACTIVE_STATUSES = ["AWAITING_PAYMENT", "PENDING", "REGISTERED"] as const;

export type PurchaseResult = { ok: true; invoiceId: string; registrationId: string; reused?: boolean } | { ok: false; error: string };

/**
 * Crée la facture d'achat (OPEN) + DomainRegistration (AWAITING_PAYMENT) + DomainCharge (OPEN), dans une transaction
 * sérialisée par nom (verrou consultatif). Le prix est recalculé ici, jamais repris du client.
 * Double clic / retour arrière : la commande en attente de la même boutique est réutilisée.
 */
export async function createDomainPurchase(p: { storeId: string; actorId: string | null; domain: string; years: number; contact: DomainContact; now?: Date }): Promise<PurchaseResult> {
  const now = p.now ?? new Date();
  const store = await db.store.findUnique({ where: { id: p.storeId }, select: { id: true, currency: true, subscription: { select: { id: true, planId: true } } } });
  if (!store?.subscription) return { ok: false, error: "Abonnement introuvable." };
  const allowed = sellableTlds();
  const parsed = parseDomain(p.domain, allowed);
  if ("error" in parsed) return { ok: false, error: domainErrorMessage(parsed, allowed) };
  const domain = parsed.ascii;

  const pending = await db.domainRegistration.findFirst({ where: { storeId: store.id, domainName: domain, status: "AWAITING_PAYMENT" }, include: { charges: { where: { kind: "REGISTER", status: "OPEN" }, take: 1 } } });
  // Réutilisée seulement à l'identique (double clic) ; durée ou titulaire différents : l'ancienne commande est annulée.
  const pendingCharge = pending?.charges[0];
  if (pending && pendingCharge?.invoiceId && pending.years === p.years && sameContact(pending.contact, p.contact)) {
    return { ok: true, invoiceId: pendingCharge.invoiceId, registrationId: pending.id, reused: true };
  }
  const superseded = pending ? { registrationId: pending.id, chargeId: pendingCharge?.id ?? null, invoiceId: pendingCharge?.invoiceId ?? null } : null;

  const registrar = await getRegistrar();
  if ((await registrar.checkAvailability(domain)) !== "AVAILABLE") return { ok: false, error: `${parsed.unicode} n'est plus disponible.` };
  const quote = await quoteDomain(domain, store.currency, "REGISTER", p.years, now);
  if (!quote.ok) return quote;
  const q = quote.price;
  const sub = store.subscription;

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`domain:${domain}`}))`;
    if (superseded) {
      const c = superseded.chargeId ? await tx.domainCharge.updateMany({ where: { id: superseded.chargeId, status: "OPEN" }, data: { status: "VOID" } }) : { count: 1 };
      if (c.count === 0) return { ok: false as const, error: "La commande précédente vient d'être payée : rechargez la page." };
      if (superseded.invoiceId) await tx.invoice.updateMany({ where: { id: superseded.invoiceId, status: "OPEN" }, data: { status: "VOID" } });
      await tx.domainRegistration.updateMany({ where: { id: superseded.registrationId, status: "AWAITING_PAYMENT" }, data: { status: "CANCELLED" } });
      await audit({ storeId: store.id, actorId: p.actorId, action: "domain.purchase_superseded", target: superseded.registrationId, metadata: { domain, invoiceId: superseded.invoiceId } }, tx);
    }
    const busy = await tx.domainRegistration.findFirst({ where: { domainName: domain, status: { in: [...ACTIVE_STATUSES] } }, select: { storeId: true, status: true } });
    if (busy) return { ok: false as const, error: busy.storeId === store.id ? "Ce domaine est déjà en cours d'achat ou enregistré pour votre boutique." : `${parsed.unicode} est en cours d'achat par un autre compte.` };
    const taken = await tx.domain.findFirst({ where: { hostname: { in: [domain, `www.${domain}`] }, storeId: { not: store.id }, verified: true }, select: { id: true } });
    if (taken) return { ok: false as const, error: "Ce domaine est déjà rattaché à une autre boutique." };

    const invoice = await tx.invoice.create({
      data: {
        subscriptionId: sub.id,
        number: await nextInvoiceNumber(tx, now.getFullYear()),
        planId: sub.planId,
        amount: q.price,
        currency: q.currency,
        status: "OPEN",
        periodStart: now,
        periodEnd: addYears(now, p.years),
        dueAt: addDays(now, REGISTER_INVOICE_DUE_DAYS),
      },
    });
    const reg = await tx.domainRegistration.create({
      data: {
        storeId: store.id,
        domainName: domain,
        years: p.years,
        status: "AWAITING_PAYMENT",
        wholesaleCostUsdCents: q.costUsdCents,
        price: q.price,
        currency: q.currency,
        margin: q.margin,
        contact: p.contact as Prisma.InputJsonValue,
        privacyProtection: true,
        autoRenew: true,
      },
    });
    await tx.domainCharge.create({
      data: {
        registrationId: reg.id,
        storeId: store.id,
        kind: "REGISTER",
        years: p.years,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        status: "OPEN",
        wholesaleCostUsdCents: q.costUsdCents,
        price: q.price,
        currency: q.currency,
        margin: q.margin,
        fxRate: q.fxRate,
        marginPercent: q.marginPercentBps,
      },
    });
    await audit({ storeId: store.id, actorId: p.actorId, action: "domain.purchase_requested", target: reg.id, metadata: { domain, years: p.years, invoiceId: invoice.id, number: invoice.number, price: q.price, currency: q.currency, costUsdCents: q.costUsdCents, marginUsdCents: q.marginUsdCents } }, tx);
    return { ok: true as const, invoiceId: invoice.id, registrationId: reg.id };
  });
}

/** Facture de renouvellement au prix courant (lifecycle J-30, ou « Renouveler maintenant »). Idempotente par échéance. */
export async function issueRenewalInvoice(registrationId: string, opts: { actorId?: string | null; now?: Date; years?: number } = {}): Promise<{ ok: true; invoiceId: string; reused?: boolean } | { ok: false; error: string }> {
  const now = opts.now ?? new Date();
  const reg = await db.domainRegistration.findUnique({ where: { id: registrationId }, include: { store: { select: { currency: true, subscription: { select: { id: true, planId: true } } } } } });
  if (!reg || reg.status !== "REGISTERED" || !reg.expiresAt || !reg.store || !reg.storeId) return { ok: false, error: "Domaine non renouvelable." };
  const storeId = reg.storeId;
  const sub = reg.store.subscription;
  if (!sub) return { ok: false, error: "Abonnement introuvable." };
  const open = await db.domainCharge.findFirst({ where: { registrationId: reg.id, kind: "RENEW", status: { in: ["OPEN", "PAID", "PROCESSING"] } } });
  if (open?.invoiceId) return { ok: true, invoiceId: open.invoiceId, reused: true };
  const years = opts.years ?? 1;
  // Devise de la boutique au moment du renouvellement (une boutique peut changer de devise).
  const quote = await quoteDomain(reg.domainName, reg.store.currency, "RENEW", years, now);
  if (!quote.ok) return quote;
  const q = quote.price;
  const expiresAt = reg.expiresAt;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`domain:${reg.domainName}`}))`;
    const again = await tx.domainCharge.findFirst({ where: { registrationId: reg.id, kind: "RENEW", status: { in: ["OPEN", "PAID", "PROCESSING"] } } });
    if (again?.invoiceId) return { ok: true as const, invoiceId: again.invoiceId, reused: true };
    const due = new Date(Math.max(expiresAt.getTime() - RENEW_DUE_DAYS_BEFORE * DAY_MS, now.getTime() + DAY_MS));
    const invoice = await tx.invoice.create({
      data: {
        subscriptionId: sub.id,
        number: await nextInvoiceNumber(tx, now.getFullYear()),
        planId: sub.planId,
        amount: q.price,
        currency: q.currency,
        status: "OPEN",
        periodStart: expiresAt,
        periodEnd: addYears(expiresAt, years),
        dueAt: due,
      },
    });
    await tx.domainCharge.create({
      data: {
        registrationId: reg.id,
        storeId,
        kind: "RENEW",
        years,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        status: "OPEN",
        wholesaleCostUsdCents: q.costUsdCents,
        price: q.price,
        currency: q.currency,
        margin: q.margin,
        fxRate: q.fxRate,
        marginPercent: q.marginPercentBps,
        expectedExpiry: expiresAt,
      },
    });
    await audit({ storeId, actorId: opts.actorId ?? null, action: "domain.renewal_issued", target: reg.id, metadata: { domain: reg.domainName, invoiceId: invoice.id, number: invoice.number, price: q.price, currency: q.currency } }, tx);
    return { ok: true as const, invoiceId: invoice.id };
  });
}

/* ───────────────────────── Paiement confirmé ───────────────────────── */

/** Factures de domaine parmi `invoiceIds` (pas des factures d'abonnement : ni dette, ni période de plan). */
export async function domainInvoiceIds(invoiceIds: string[], tx: Db = db): Promise<Set<string>> {
  if (invoiceIds.length === 0) return new Set();
  const rows = await tx.domainCharge.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { invoiceId: true } });
  return new Set(rows.map((r) => r.invoiceId).filter((id): id is string => !!id));
}

/**
 * Appelée par confirmInvoicePayment DANS sa transaction (facture déjà passée PAID). Retourne false si la facture
 * n'est pas une facture de domaine. Le job est mis en file dans la même transaction (outbox).
 */
export async function onDomainInvoicePaid(invoiceId: string, tx: Tx): Promise<boolean> {
  const charge = await tx.domainCharge.findUnique({ where: { invoiceId } });
  if (!charge) return false;
  const moved = await tx.domainCharge.updateMany({ where: { id: charge.id, status: { in: ["OPEN", "VOID"] } }, data: { status: "PAID" } });
  if (moved.count === 0) return true;
  if (charge.kind === "REGISTER") {
    await tx.domainRegistration.updateMany({ where: { id: charge.registrationId, status: { in: ["AWAITING_PAYMENT", "CANCELLED"] } }, data: { status: "PENDING", lastError: null } });
  }
  await enqueue(charge.kind === "REGISTER" ? "domain.register" : "domain.renew", { chargeId: charge.id }, { storeId: charge.storeId }, tx);
  return true;
}

/* ───────────────────────── Exécution chez le registrar (jobs) ───────────────────────── */

type ChargeWithReg = DomainCharge & { registration: DomainRegistration };

async function loadCharge(chargeId: string): Promise<ChargeWithReg | null> {
  return db.domainCharge.findUnique({ where: { id: chargeId }, include: { registration: true } });
}

function errMessage(e: unknown): string {
  const err = e as { name?: string; message?: string };
  return sanitizeRegistrarMessage(`${err.name && err.name !== "Error" ? `${err.name}: ` : ""}${err.message ?? String(e)}`);
}

async function markFailed(charge: ChargeWithReg, message: string) {
  const msg = sanitizeRegistrarMessage(message);
  await db.$transaction(async (tx) => {
    const r = await tx.domainCharge.updateMany({ where: { id: charge.id, status: { in: ["PAID", "PROCESSING"] } }, data: { status: "FAILED", lastError: msg } });
    if (r.count === 0) return;
    if (charge.kind === "REGISTER") await tx.domainRegistration.update({ where: { id: charge.registrationId }, data: { status: "FAILED", lastError: msg } });
    else await tx.domainRegistration.update({ where: { id: charge.registrationId }, data: { lastError: msg } });
    await audit({ storeId: charge.storeId, action: charge.kind === "REGISTER" ? "domain.register_failed" : "domain.renew_failed", target: charge.registrationId, metadata: { chargeId: charge.id, domain: charge.registration.domainName, error: msg } }, tx);
    if (!charge.storeId) return;
    const { notifyStore } = await import("@/lib/notifications/service");
    await notifyStore(
      charge.storeId,
      {
        kind: "other",
        key: `domain:failed:${charge.id}`,
        title: `Domaine ${charge.registration.domainName} : opération en attente`,
        text: "Votre paiement est bien reçu. L'opération chez le registre a échoué : notre équipe la relance et vous tient informé.",
        href: `/app/${charge.storeId}/domaine`,
      },
      tx,
    );
  });
}

function pollDelayMs(polls: number): number {
  return Math.min(2 ** Math.min(polls + 1, 5), 30) * 60_000;
}

export type ProcessOutcome = "applied" | "polling" | "failed" | "skipped";

/**
 * Traite une charge payée (job `domain.register` / `domain.renew`, ou `domain.poll`). Idempotent :
 *  - réclamation PAID → PROCESSING (claimedAt) par updateMany : un seul envoi par charge ;
 *  - appel facturé SANS rejeu (client à 1 tentative). Refus explicite (4xx) : FAILED ; limitation (429) : retour
 *    à PAID puis nouvelle tentative du job ; délai dépassé / réseau / 5xx : la charge RESTE PROCESSING sans
 *    opération et sera réconciliée au rejeu ;
 *  - réconciliation : ListOperations depuis claimedAt, puis état du domaine (présence / échéance). Rien trouvé :
 *    FAILED (automatique), ou nouvel envoi si la relance vient de l'admin (`resubmit`).
 */
export async function processDomainCharge(chargeId: string, polls = 0, now = new Date(), opts: { resubmit?: boolean } = {}): Promise<ProcessOutcome> {
  const charge = await loadCharge(chargeId);
  if (!charge) return "skipped";
  if (charge.status !== "PAID" && charge.status !== "PROCESSING") return "skipped";
  // Défense en profondeur : la facture DOIT être payée.
  const invoice = charge.invoiceId ? await db.invoice.findUnique({ where: { id: charge.invoiceId }, select: { status: true } }) : null;
  if (invoice?.status !== "PAID") return "skipped";
  const registrar = await getRegistrar();
  const domain = charge.registration.domainName;

  let operationId = charge.operationId;
  if (!operationId && charge.status === "PROCESSING") {
    const r = await reconcile(charge, now, !!opts.resubmit);
    if (r.outcome) return r.outcome;
    operationId = r.operationId;
  }
  if (!operationId) {
    const claimed = await db.domainCharge.updateMany({ where: { id: charge.id, status: "PAID", operationId: null }, data: { status: "PROCESSING", claimedAt: now } });
    if (claimed.count === 0) return "skipped"; // un autre exécutant vient de réclamer la charge
    try {
      if (charge.kind === "RENEW") {
        const detail = await registrar.getDetail(domain);
        if (!detail?.expiresAt) {
          await markFailed(charge, "Domaine absent du compte revendeur");
          return "failed";
        }
        if (charge.expectedExpiry && detail.expiresAt.getTime() > charge.expectedExpiry.getTime() + DAY_MS) {
          return (await finalizeRenewal(charge.id, detail.expiresAt)) ? "applied" : "failed";
        }
        operationId = (await registrar.renew({ domain, years: charge.years, currentExpiryYear: detail.expiresAt.getUTCFullYear() })).operationId;
      } else {
        operationId = (await registrar.register({ domain, years: charge.years, contact: charge.registration.contact as DomainContact, privacy: charge.registration.privacyProtection })).operationId;
      }
    } catch (e) {
      const kind = classifyRegistrarError(e);
      if (kind === "refused") {
        await markFailed(charge, errMessage(e));
        return "failed";
      }
      if (kind === "throttled") {
        await db.domainCharge.updateMany({ where: { id: charge.id, status: "PROCESSING", operationId: null }, data: { status: "PAID", claimedAt: null, lastError: errMessage(e) } });
        throw e;
      }
      // Résultat inconnu : NE PAS repasser PAID (un second envoi pourrait facturer deux fois). Réconciliation au rejeu.
      await db.domainCharge.update({ where: { id: charge.id }, data: { lastError: `Résultat inconnu, réconciliation : ${errMessage(e)}` } });
      throw e;
    }
    await db.domainCharge.update({ where: { id: charge.id }, data: { operationId, lastError: null } });
    if (charge.kind === "REGISTER") await db.domainRegistration.update({ where: { id: charge.registrationId }, data: { operationId, status: "PENDING" } });
  }
  if (!operationId) return "skipped";

  const op = await registrar.getOperation(operationId);
  if (op.status === "SUCCESSFUL") {
    if (charge.kind === "REGISTER") return (await finalizeRegistration(charge.id, now)) ? "applied" : "failed";
    const detail = await registrar.getDetail(domain);
    return (await finalizeRenewal(charge.id, detail?.expiresAt ?? null)) ? "applied" : "failed";
  }
  if (op.status === "FAILED" || op.status === "ERROR") {
    await markFailed(charge, op.message ? `Registrar : ${op.message}` : `Opération ${op.status}`);
    return "failed";
  }
  if (polls >= MAX_POLLS) {
    await markFailed(charge, "Opération toujours en cours après 3 jours : vérifiez dans la console Route 53.");
    return "failed";
  }
  await enqueue("domain.poll", { chargeId: charge.id, polls: polls + 1 }, { storeId: charge.storeId, runAt: new Date(now.getTime() + pollDelayMs(polls)) });
  return "polling";
}

/** Charge PROCESSING sans opération connue : retrouve l'opération soumise, ou constate qu'aucune ne l'a été. */
async function reconcile(charge: ChargeWithReg, now: Date, resubmit: boolean): Promise<{ outcome?: ProcessOutcome; operationId: string | null }> {
  const registrar = await getRegistrar();
  const domain = charge.registration.domainName;
  const since = charge.claimedAt ?? new Date(charge.updatedAt.getTime() - 3600_000);
  const found = await registrar.findOperation({ domain, kind: charge.kind, since });
  if (found) {
    await db.domainCharge.update({ where: { id: charge.id }, data: { operationId: found.operationId, lastError: null } });
    if (charge.kind === "REGISTER") await db.domainRegistration.update({ where: { id: charge.registrationId }, data: { operationId: found.operationId, status: "PENDING" } });
    await audit({ storeId: charge.storeId, action: "domain.operation_reconciled", target: charge.registrationId, metadata: { chargeId: charge.id, operationId: found.operationId } });
    return { operationId: found.operationId };
  }
  const detail = await registrar.getDetail(domain);
  if (charge.kind === "REGISTER" && detail) return { outcome: (await finalizeRegistration(charge.id, now)) ? "applied" : "failed", operationId: null };
  if (charge.kind === "RENEW" && detail?.expiresAt && charge.expectedExpiry && detail.expiresAt.getTime() > charge.expectedExpiry.getTime() + DAY_MS) {
    return { outcome: (await finalizeRenewal(charge.id, detail.expiresAt)) ? "applied" : "failed", operationId: null };
  }
  if (resubmit) {
    // Aucune opération depuis la réclamation et aucun effet constaté : un nouvel envoi est sûr (relance admin).
    const r = await db.domainCharge.updateMany({ where: { id: charge.id, status: "PROCESSING", operationId: null }, data: { status: "PAID", claimedAt: null } });
    if (r.count === 0) return { outcome: "skipped", operationId: null };
    return { outcome: await processDomainCharge(charge.id, 0, now), operationId: null };
  }
  await markFailed(charge, "Aucune opération retrouvée chez le registrar après un appel au résultat inconnu : relance depuis la console admin.");
  return { outcome: "failed", operationId: null };
}

function sameContact(a: unknown, b: DomainContact): boolean {
  const norm = (c: Record<string, unknown>) => JSON.stringify(Object.keys(c).filter((k) => c[k] != null && c[k] !== "").sort().map((k) => [k, c[k]]));
  return !!a && typeof a === "object" && norm(a as Record<string, unknown>) === norm(b as Record<string, unknown>);
}

/** Domaine enregistré : échéance, DNS, rattachement à la boutique (vérifié), charge APPLIED. */
export async function finalizeRegistration(chargeId: string, now = new Date()): Promise<boolean> {
  const charge = await loadCharge(chargeId);
  if (!charge) return false;
  if (charge.status === "APPLIED") return true;
  const registrar = await getRegistrar();
  const domain = charge.registration.domainName;
  const detail = await registrar.getDetail(domain);
  const expiresAt = detail?.expiresAt ?? addYears(now, charge.years);

  const storeId = charge.storeId;
  const done = await db.$transaction(async (tx) => {
    const r = await tx.domainCharge.updateMany({ where: { id: charge.id, status: { in: ["PAID", "PROCESSING", "FAILED"] } }, data: { status: "APPLIED", appliedAt: now, lastError: null } });
    if (r.count === 0) return false;
    // Le titulaire n'est plus utile une fois le domaine enregistré (il est chez le registre) : anonymisé ici.
    await tx.domainRegistration.update({ where: { id: charge.registrationId }, data: { status: "REGISTERED", registeredAt: now, expiresAt, lastError: null, contact: anonymizedContact(charge.registration.contact as { country?: unknown }) } });
    await audit({ storeId, action: "domain.registered", target: charge.registrationId, metadata: { domain, expiresAt, chargeId: charge.id } }, tx);
    if (!storeId) return true; // boutique supprimée entre-temps : domaine conservé, non rattaché
    await attachHostnames(tx, storeId, charge.registrationId, domain);
    const { notifyStore } = await import("@/lib/notifications/service");
    await notifyStore(storeId, { kind: "other", key: `domain:registered:${charge.registrationId}`, title: `Domaine ${domain} enregistré`, text: "Votre boutique sera accessible à cette adresse (HTTPS inclus) dès la propagation DNS, en général sous une heure.", href: `/app/${charge.storeId}/domaine` }, tx);
    const to = await ownerEmail(storeId, tx);
    if (to) {
      await queueNotification(storeId, "email", to, "domain.registered", {
        subject: `Votre domaine ${domain} est enregistré`,
        text: `Bonjour,\n\nLe nom de domaine ${domain} est enregistré à votre nom jusqu'au ${formatDate(expiresAt)}. Nous avons configuré ses DNS : votre boutique y sera accessible en HTTPS dès la propagation (en général moins d'une heure).\n\nGérer : ${SITE.url}/app/${charge.storeId}/domaine\n\nL'équipe ${SITE.name}`,
      }, tx);
      await enqueue("notification.send", {}, { storeId }, tx);
    }
    return true;
  });
  if (done) {
    // AutoRenew AWS toujours désactivé (déjà demandé à l'enregistrement ; réaffirmé, sans bloquer).
    await registrar.setAutoRenew(domain, false).catch(() => undefined);
    await configureDns(charge.registrationId).catch(() => undefined);
  }
  return done;
}

/** Rattache apex et www à la boutique (domaines vérifiés : la preuve de possession est l'achat lui-même). */
async function attachHostnames(tx: Tx, storeId: string, registrationId: string, domain: string) {
  const hasPrimary = (await tx.domain.count({ where: { storeId, verified: true, isPrimary: true } })) > 0;
  for (const hostname of [domain, `www.${domain}`]) {
    const existing = await tx.domain.findUnique({ where: { hostname } });
    if (existing && existing.storeId !== storeId) {
      if (existing.verified) continue; // ne jamais voler un domaine vérifié d'une autre boutique
      await tx.domain.delete({ where: { id: existing.id } });
    }
    await tx.domain.upsert({
      where: { hostname },
      create: { storeId, hostname, verified: true, verifyToken: `axi-verify-${randomToken(16)}`, isPrimary: !hasPrimary && hostname === domain, registrationId },
      update: { verified: true, registrationId },
    });
  }
  await tx.integration.upsert({
    where: { storeId_kind: { storeId, kind: "custom_domain" } },
    create: { storeId, kind: "custom_domain", status: "active", config: { hostname: domain } },
    update: { status: "active", config: { hostname: domain }, lastError: null },
  });
}

/** Zone hébergée + enregistrements A/AAAA vers la plateforme. Rejouée par le cycle de vie tant qu'elle échoue. */
export async function configureDns(registrationId: string): Promise<boolean> {
  const reg = await db.domainRegistration.findUnique({ where: { id: registrationId } });
  if (!reg || reg.status !== "REGISTERED") return false;
  const target = dnsTarget();
  if (!target) {
    await db.domainRegistration.update({ where: { id: reg.id }, data: { lastError: "DNS non configuré : DOMAINS_TARGET_IPV4 absent" } });
    return false;
  }
  try {
    const { hostedZoneId } = await (await getRegistrar()).ensureDns(reg.domainName, target);
    await db.domainRegistration.update({ where: { id: reg.id }, data: { hostedZoneId, dnsConfiguredAt: new Date(), lastError: null } });
    return true;
  } catch (e) {
    await db.domainRegistration.update({ where: { id: reg.id }, data: { lastError: `DNS : ${errMessage(e)}` } });
    return false;
  }
}

export async function finalizeRenewal(chargeId: string, newExpiry: Date | null): Promise<boolean> {
  const charge = await loadCharge(chargeId);
  if (!charge) return false;
  if (charge.status === "APPLIED") return true;
  const expiresAt = newExpiry ?? addYears(charge.expectedExpiry ?? charge.registration.expiresAt ?? new Date(), charge.years);
  return db.$transaction(async (tx) => {
    const r = await tx.domainCharge.updateMany({ where: { id: charge.id, status: { in: ["PAID", "PROCESSING", "FAILED"] } }, data: { status: "APPLIED", appliedAt: new Date(), lastError: null } });
    if (r.count === 0) return false;
    await tx.domainRegistration.update({ where: { id: charge.registrationId }, data: { status: "REGISTERED", expiresAt, lastError: null } });
    await audit({ storeId: charge.storeId, action: "domain.renewed", target: charge.registrationId, metadata: { domain: charge.registration.domainName, expiresAt, chargeId: charge.id } }, tx);
    if (!charge.storeId) return true;
    const { notifyStore } = await import("@/lib/notifications/service");
    await notifyStore(charge.storeId, { kind: "other", key: `domain:renewed:${charge.id}`, title: `Domaine ${charge.registration.domainName} renouvelé`, text: `Nouvelle échéance : ${formatDate(expiresAt)}.`, href: `/app/${charge.storeId}/domaine` }, tx);
    return true;
  });
}

/* ───────────────────────── Auto-renouvellement ───────────────────────── */

/**
 * Drapeau Axi : génère (ou non) la facture de renouvellement à J-30. Ne touche JAMAIS AWS : l'auto-renouvellement
 * Route 53 reste désactivé en permanence, seul un renouvellement payé appelle RenewDomain.
 */
export async function applyAutoRenew(registrationId: string, enabled: boolean, meta: { actorId?: string | null; reason: string }): Promise<void> {
  const reg = await db.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } });
  await db.$transaction(async (tx) => {
    await tx.domainRegistration.update({ where: { id: reg.id }, data: { autoRenew: enabled } });
    await audit({ storeId: reg.storeId, actorId: meta.actorId ?? null, action: enabled ? "domain.autorenew_enabled" : "domain.autorenew_disabled", target: reg.id, metadata: { domain: reg.domainName, reason: meta.reason } }, tx);
  });
}

/* ───────────────────────── Outils ───────────────────────── */

export function addYears(d: Date, years: number): Date {
  const x = new Date(d);
  x.setUTCFullYear(x.getUTCFullYear() + years);
  return x;
}

export async function ownerEmail(storeId: string, client: Db = db): Promise<string | null> {
  const store = await client.store.findUnique({ where: { id: storeId }, select: { contactEmail: true } });
  if (store?.contactEmail) return store.contactEmail;
  const owner = await client.membership.findFirst({ where: { storeId, role: "OWNER" }, include: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" } });
  return owner?.user.email ?? null;
}


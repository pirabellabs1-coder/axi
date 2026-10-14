import "server-only";
import type { PaymentAttemptStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { decryptSecret } from "@/lib/crypto";
import { SITE } from "@/config/site";
import { createHash, randomBytes } from "node:crypto";
import { getGateway, gatewayCredentials } from "./gateways";
import type { WebhookContext } from "./provider";
import { confirmationHasAmount, gatewayStatusOutcome } from "@/lib/billing/rules";
import { emitDomainEvent } from "@/lib/webhooks/emit";
import { orderEventData } from "@/lib/commerce/domain-events";

/** Traces de webhooks à signature invalide : au plus N par fenêtre et par fournisseur (m14). */
const INVALID_WEBHOOK_MAX = 20;
const INVALID_WEBHOOK_WINDOW_MS = 10 * 60_000;

/** Durée de conservation des traces de webhooks fournisseur (journal technique, purge dans /api/jobs/run). */
export const PROVIDER_EVENT_RETENTION_DAYS = 90;

/**
 * m3 : AUCUN corps brut n'est conservé. Un corps non authentifié peut contenir le téléphone, l'e-mail, voire
 * des données de carte du client : seules sa taille et son empreinte sont gardées (diagnostic, déduplication).
 */
export async function recordInvalidWebhook(provider: string, raw: string, error: string, paymentAttemptId?: string | null): Promise<void> {
  try {
    const recent = await db.providerEvent.count({ where: { provider, signatureValid: false, receivedAt: { gte: new Date(Date.now() - INVALID_WEBHOOK_WINDOW_MS) } } });
    if (recent >= INVALID_WEBHOOK_MAX) return;
    await db.providerEvent.create({
      data: {
        provider,
        eventId: `invalid:${Date.now()}:${randomBytes(4).toString("hex")}`,
        type: "invalid_signature",
        payload: { size: raw.length, sha256: createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32) },
        signatureValid: false,
        error: error.slice(0, 200),
        paymentAttemptId: paymentAttemptId ?? null,
      },
    });
  } catch {
    // Journalisation best effort : ne doit jamais faire échouer la réponse au fournisseur.
  }
}

/** Purge du journal technique des webhooks fournisseur (aucune valeur au-delà du rapprochement). */
export async function purgeProviderEvents(days = PROVIDER_EVENT_RETENTION_DAYS): Promise<{ deleted: number }> {
  const r = await db.providerEvent.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
  return { deleted: r.count };
}

/**
 * Projection conservée d'un webhook AUTHENTIFIÉ : juste de quoi rapprocher un paiement. Jamais le corps brut
 * du fournisseur (nom, téléphone, e-mail, parfois données de carte selon la passerelle).
 */
export function providerEventProjection(v: { type: string; providerRef?: string | null; status: string; amount?: number | null; currency?: string | null }): Prisma.InputJsonValue {
  return {
    event: v.type.slice(0, 60),
    reference: v.providerRef ? String(v.providerRef).slice(0, 120) : null,
    status: v.status,
    amount: typeof v.amount === "number" && Number.isFinite(v.amount) ? v.amount : null,
    currency: v.currency ? String(v.currency).toUpperCase().slice(0, 8) : null,
  };
}

/**
 * Service paiement — machine d'états PaymentAttempt distincte de la commande.
 * CREATED → PENDING → INITIATED → CONFIRMED | FAILED | EXPIRED
 */

/** Montant restant à payer hors tenders (null = commande antérieure au lot 1 : le total). */
function dueOf(order: { total: number; amountDue: number | null }): number {
  return order.amountDue ?? order.total;
}

/** Émission des cartes cadeaux achetées, dans la transaction qui confirme le paiement (équipe C). */
async function enqueueGiftCardsIfAny(tx: Prisma.TransactionClient, storeId: string, orderId: string) {
  const hasGiftCard = await tx.orderItem.count({ where: { orderId, isGiftCard: true } });
  if (hasGiftCard === 0) return;
  const { enqueueGiftCardIssueTx } = await import("@/lib/giftcards/service");
  await enqueueGiftCardIssueTx(tx, storeId, orderId);
}

/** Confirmation manuelle par le marchand (MoMo / virement / espèces). Jamais automatique. */
export async function confirmManualPayment(params: { orderId: string; storeId: string; actorId: string; actorLabel: string; note?: string }) {
  const { orderId, storeId, actorId, actorLabel, note } = params;
  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, storeId } });
    if (!order) throw new Error("Commande introuvable");
    if (order.paymentStatus === "PAID") return order;

    // Concurrence : passage à PAID CONDITIONNEL, avant tout effet de bord (même motif que `transitionOrderTx`).
    // Deux confirmations simultanées (double clic, deux membres) : la seconde voit `count === 0` et sort sans
    // créer de seconde tentative CONFIRMED, sans second job `payment.succeeded` ni second `order.paid`
    // (deux eventId différents ne seraient pas dédoublonnés chez le destinataire du webhook).
    const moved = await tx.order.updateMany({ where: { id: orderId, storeId, paymentStatus: { not: "PAID" } }, data: { paymentStatus: "PAID" } });
    const updated = await tx.order.findFirstOrThrow({ where: { id: orderId, storeId } });
    if (moved.count === 0) return updated;

    // Tentative du reste à payer (les tenders internes, déjà CONFIRMED, ne sont jamais repris ici).
    let attempt = await tx.paymentAttempt.findFirst({ where: { orderId, status: { in: ["CREATED", "PENDING", "INITIATED"] } }, orderBy: { createdAt: "desc" } });
    if (!attempt) {
      attempt = await tx.paymentAttempt.create({ data: { orderId, provider: "manual", status: "PENDING", amount: dueOf(order), currency: order.currency } });
    }
    await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "CONFIRMED", verifiedBy: actorId, verifiedAt: new Date(), metadata: note ? { note } : undefined } });
    await tx.orderEvent.create({ data: { orderId, actorId, actorLabel, type: "payment_changed", fromValue: order.paymentStatus, toValue: "PAID", message: note ?? "Paiement confirmé manuellement" } });
    await audit({ storeId, actorId, action: "payment.confirmed_manual", target: orderId }, tx);
    await enqueue("payment.succeeded", { orderId, attemptId: attempt.id }, { storeId }, tx);
    await enqueueGiftCardsIfAny(tx, storeId, orderId);
    // Lot 2 (webhooks) : une seule émission par passage à PAID (retour anticipé ci-dessus si déjà payée).
    await emitDomainEvent(tx, storeId, "order.paid", orderEventData(updated));
    return updated;
  });
}

export async function markPaymentFailed(params: { orderId: string; storeId: string; actorId: string; actorLabel: string; reason: string }) {
  const { orderId, storeId, actorId, actorLabel, reason } = params;
  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, storeId } });
    if (!order) throw new Error("Commande introuvable");
    await tx.paymentAttempt.updateMany({ where: { orderId, status: { in: ["CREATED", "PENDING", "INITIATED"] } }, data: { status: "FAILED", failureReason: reason } });
    await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "FAILED" } });
    await tx.orderEvent.create({ data: { orderId, actorId, actorLabel, type: "payment_changed", fromValue: order.paymentStatus, toValue: "FAILED", message: reason } });
    await audit({ storeId, actorId, action: "payment.marked_failed", target: orderId, metadata: { reason } }, tx);
    await enqueue("payment.failed", { orderId }, { storeId }, tx);
  });
}

export type RefundDestination = "original" | "store_credit";

/**
 * Remboursement : la transaction verrouille la ligne `Order` PUIS la ligne `Store` (avoir fiscal, compteur de
 * numérotation). Les remboursements d'une même boutique se sérialisent donc : mêmes délais que les émissions de
 * documents (`src/lib/tax/invoice.ts`), pour attendre plutôt qu'échouer sur le maxWait Prisma de 2 s par défaut.
 */
const REFUND_TX_OPTS = { maxWait: 10_000, timeout: 15_000 };

export type RefundBreakdown = {
  /** Part du paiement externe rendue en argent (destination original) ou en avoir (destination store_credit). */
  external: number;
  /** Cartes cadeaux utilisées pour payer, recréditées (REVERSAL rattaché au Refund). */
  giftCards: number;
  /** Avoir utilisé pour payer, recrédité (REVERSAL rattaché au Refund). */
  storeCredit: number;
  /** Part externe créditée en avoir (destination store_credit, REFUND_TO_CREDIT). */
  toStoreCredit: number;
  /** Solde retiré des cartes cadeaux ACHETÉES par la commande (ADJUST), part du remboursement qui porte sur elles. */
  purchasedGiftCards: number;
};

/**
 * Enregistre un remboursement (partiel ou total), statut DONE (le virement externe reste à faire par le marchand).
 *
 * Plafond : `refundableRemaining` (src/lib/commerce/refunds.ts), source unique partagée avec les retours,
 * l'annulation et la fiche commande : total − remboursements − recrédits d'annulation − retours résolus en
 * avoir/échange (ou réservés) − valeur dépensée des cartes achetées.
 *
 * `destination` (lot 1, §3 « Remboursements ») :
 *  - `original` (défaut) : (1) paiement externe à hauteur du payé hors tenders non encore rendu, (2) cartes cadeaux
 *    utilisées (REVERSAL au prorata), (3) avoir utilisé (REVERSAL) ;
 *  - `store_credit` : les tenders retournent D'ABORD vers leurs instruments (cartes, avoir), seule la part externe
 *    est créditée en avoir (`REFUND_TO_CREDIT`) : jamais deux fois la même valeur.
 * Chaque REVERSAL porte `refund:<id>` dans sa note (rattachement au Refund). Commande avec cartes cadeaux achetées :
 * le remboursement porte d'abord sur le reste de la commande ; au-delà, le solde non dépensé des cartes est retiré
 * (ADJUST, carte désactivée à 0) ; refusé tant que toutes les cartes ne sont pas émises.
 */
export async function requestRefund(params: {
  orderId: string;
  storeId: string;
  actorId: string;
  actorLabel: string;
  amount: number;
  reason?: string;
  destination?: RefundDestination;
  returnId?: string | null;
}) {
  const { orderId, storeId, actorId, actorLabel, amount, reason } = params;
  const destination: RefundDestination = params.destination ?? "original";
  return db.$transaction(async (tx) => {
    // Verrou de la commande : remboursements, retours et annulation concurrents sont sérialisés.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} AND "storeId" = ${storeId} FOR UPDATE`;
    const order = await tx.order.findFirst({ where: { id: orderId, storeId } });
    if (!order) throw new Error("Commande introuvable");
    if (order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIALLY_REFUNDED") throw new Error("Seule une commande payée peut être remboursée");
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Montant de remboursement invalide");

    const { refundableRemaining, externalRefunded, refundNote } = await import("@/lib/commerce/refunds");
    const r = await refundableRemaining(tx, order, { excludeReturnId: params.returnId ?? null });
    if (amount > r.remaining) throw new Error(`Montant de remboursement supérieur au remboursable (${r.remaining} ${order.currency})`);

    // Cartes cadeaux achetées : part du remboursement qui excède le reste de la commande.
    const { purchasedGiftCardsState, neutralizePurchasedGiftCardsTx, reverseGiftCardsTx } = await import("@/lib/giftcards/service");
    const purchased = await purchasedGiftCardsState(tx, storeId, orderId);
    let purchasedPart = 0;
    if (purchased.units > 0) {
      if (purchased.issued < purchased.units) throw new Error("Les cartes cadeaux de cette commande ne sont pas encore toutes émises : réessayez dans quelques minutes.");
      const otherRoom = Math.max(0, r.remaining - purchased.balance);
      purchasedPart = Math.max(0, amount - otherRoom);
      if (purchasedPart > purchased.balance) throw new Error("La part remboursée dépasse le solde non utilisé des cartes cadeaux achetées.");
    }

    const breakdown: RefundBreakdown = { external: 0, giftCards: 0, storeCredit: 0, toStoreCredit: 0, purchasedGiftCards: 0 };
    const refund = await tx.refund.create({ data: { orderId, amount, reason, status: "DONE", actorId, doneAt: new Date(), method: destination, returnId: params.returnId ?? null } });
    const note = refundNote(refund.id);
    if (purchasedPart > 0) {
      const n = await neutralizePurchasedGiftCardsTx(tx, storeId, orderId, { amount: purchasedPart, actorId, note });
      if (n.debited !== purchasedPart) throw new Error("Le solde d'une carte cadeau achetée vient de changer. Réessayez.");
      breakdown.purchasedGiftCards = n.debited;
    }

    const externalPaid = order.amountDue ?? order.total;
    const externalRoom = Math.max(0, externalPaid - externalRefunded(r.ledger));
    const reverseTenders = async (max: number) => {
      let left = max;
      if (left > 0 && r.ledger.outstanding.giftCards > 0) {
        const g = await reverseGiftCardsTx(tx, storeId, orderId, { amount: Math.min(left, r.ledger.outstanding.giftCards), actorId, note, returnId: params.returnId ?? null });
        breakdown.giftCards = g.total;
        left -= g.total;
      }
      if (left > 0 && r.ledger.outstanding.storeCredit > 0) {
        const { reverseStoreCreditTx } = await import("@/lib/store-credit/service");
        const c = await reverseStoreCreditTx(tx, storeId, orderId, { amount: Math.min(left, r.ledger.outstanding.storeCredit), actorId, note, returnId: params.returnId ?? null });
        breakdown.storeCredit = c.total;
        left -= c.total;
      }
      return left;
    };

    if (destination === "store_credit") {
      if (!order.customerId) throw new Error("Aucune fiche client sur cette commande : remboursement en avoir impossible.");
      const rest = await reverseTenders(amount);
      if (rest > externalRoom) throw new Error("Montant supérieur à ce qui reste remboursable sur cette commande");
      if (rest > 0) {
        const { grantTx } = await import("@/lib/store-credit/service");
        await grantTx(tx, { storeId, customerId: order.customerId, amount: rest, kind: "REFUND_TO_CREDIT", orderId, returnId: params.returnId ?? null, actorId, note: `${reason ? `Remboursement : ${reason}` : "Remboursement de commande"} (${"refund:"}${refund.id})`.slice(0, 300) });
      }
      breakdown.external = rest;
      breakdown.toStoreCredit = rest;
    } else {
      breakdown.external = Math.min(amount, externalRoom);
      const rest = await reverseTenders(amount - breakdown.external);
      if (rest > 0) throw new Error("Montant supérieur à ce qui reste remboursable sur cette commande");
    }

    const remainingAfter = r.remaining - amount;
    const paymentStatus = remainingAfter <= 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";
    const updatedOrder = await tx.order.update({ where: { id: orderId }, data: { paymentStatus, ...(paymentStatus === "REFUNDED" && order.status === "DELIVERED" ? { status: "REFUNDED" } : {}) } });
    const parts = [
      breakdown.external > 0 ? `${destination === "store_credit" ? "crédité en avoir" : "paiement externe"} ${breakdown.external}` : null,
      breakdown.giftCards > 0 ? `cartes cadeaux recréditées ${breakdown.giftCards}` : null,
      breakdown.storeCredit > 0 ? `avoir recrédité ${breakdown.storeCredit}` : null,
      breakdown.purchasedGiftCards > 0 ? `solde retiré des cartes achetées ${breakdown.purchasedGiftCards}` : null,
    ].filter(Boolean);
    await tx.orderEvent.create({
      data: { orderId, actorId, actorLabel, type: "payment_changed", fromValue: order.paymentStatus, toValue: paymentStatus, message: `Remboursement de ${amount} ${order.currency}${parts.length ? ` (${parts.join(", ")})` : ""}${reason ? ` — ${reason}` : ""}`.slice(0, 500) },
    });
    await audit({ storeId, actorId, action: "payment.refunded", target: orderId, metadata: { amount, reason, destination, returnId: params.returnId ?? null, refundId: refund.id, breakdown } }, tx);
    // Lot 2 (W) : webhook, sans motif libre ni coordonnées.
    await emitDomainEvent(tx, storeId, "order.refunded", { ...orderEventData(updatedOrder), refundId: refund.id, amount, destination, returnId: params.returnId ?? null });
    // Lot 2 (T) : avoir fiscal dans la même transaction (sans facture : rien, aucun numéro consommé).
    // EN DERNIER : il verrouille la ligne `Store` (compteur de numérotation) ; le verrou n'est donc tenu
    // que le temps du commit, pas pendant les recrédits de tenders et les écritures de la commande.
    const { issueCreditNoteForRefundTx } = await import("@/lib/tax/invoice");
    await issueCreditNoteForRefundTx(tx, { storeId, refundId: refund.id, actorId });
    return Object.assign(refund, { breakdown });
  }, REFUND_TX_OPTS).then(async (refund) => {
    // Lot 1 bis : part « paiement externe » rendue chez le fournisseur quand son API le permet (après commit).
    if (destination === "original" && refund.breakdown.external > 0) {
      await refundExternalAtGateway({ storeId, orderId, refundId: refund.id, amount: refund.breakdown.external, actorId, actorLabel, reason: reason ?? null });
    }
    // Remboursement total : retrait des points de fidélité gagnés sur la commande.
    const o = await db.order.findUnique({ where: { id: orderId }, select: { paymentStatus: true } });
    if (o?.paymentStatus === "REFUNDED") {
      try {
        const { revokeLoyaltyForOrder } = await import("@/lib/loyalty/service");
        await revokeLoyaltyForOrder(orderId);
      } catch (e) {
        console.error("[loyalty]", e);
      }
    }
    return refund;
  });
}

/**
 * Remboursement chez le fournisseur (lot 1 bis : Paystack, pawaPay) de la part « paiement externe » d'un
 * remboursement DÉJÀ enregistré. Appelé hors transaction (aucun appel réseau sous verrou) et jamais
 * bloquant : succès ou échec sont tracés (OrderEvent + audit) ; un échec ou une passerelle sans API de
 * remboursement laisse le virement à faire à la main, comme avant, avec une notification au marchand.
 */
export async function refundExternalAtGateway(p: { storeId: string; orderId: string; refundId: string; amount: number; actorId: string; actorLabel: string; reason?: string | null }): Promise<{ attempted: boolean; ok?: boolean; error?: string }> {
  try {
    const attempt = await db.paymentAttempt.findFirst({
      where: { orderId: p.orderId, status: "CONFIRMED", providerRef: { not: null }, order: { storeId: p.storeId }, paymentMethodId: { not: null } },
      include: { paymentMethod: true },
      orderBy: { verifiedAt: "desc" },
    });
    const method = attempt?.paymentMethod;
    if (!attempt?.providerRef || !method || method.kind !== "GATEWAY" || !method.provider) return { attempted: false };
    if ((attempt.metadata as { duplicate?: unknown } | null)?.duplicate) return { attempted: false };
    const gateway = getGateway(method.provider);
    if (!gateway?.refund) return { attempted: false };
    const amount = Math.min(p.amount, attempt.amount);
    const creds = gatewayCredentials(method.credentialsEncrypted ? decryptSecret(method.credentialsEncrypted) : null);
    const r = await gateway
      .refund({ providerRef: attempt.providerRef, amount, currency: attempt.currency, refundId: p.refundId, reason: p.reason ?? null }, creds)
      .catch((e: unknown) => ({ ok: false as const, error: (e as Error)?.message ?? "erreur inattendue" }));
    const message = r.ok
      ? `Remboursement de ${amount} ${attempt.currency} demandé à ${gateway.label} (réf. ${r.providerRefundRef || "en attente"}) : le client est recrédité selon les délais de l'opérateur.`
      : `Remboursement automatique ${gateway.label} refusé (${r.error}). Remboursez ${amount} ${attempt.currency} au client depuis votre compte ${gateway.label} ou par Mobile Money.`;
    await db.orderEvent.create({ data: { orderId: p.orderId, actorId: p.actorId, actorLabel: p.actorLabel, type: r.ok ? "refund_gateway_requested" : "refund_gateway_failed", message: message.slice(0, 500) } });
    await audit({ storeId: p.storeId, actorId: p.actorId, action: r.ok ? "payment.refund_gateway_requested" : "payment.refund_gateway_failed", target: p.orderId, metadata: { refundId: p.refundId, provider: gateway.id, amount, ...(r.ok ? { providerRefundRef: r.providerRefundRef } : { error: r.error.slice(0, 200) }) } });
    if (!r.ok) {
      const owner = await db.membership.findFirst({ where: { storeId: p.storeId, role: "OWNER" }, include: { user: { select: { email: true } } } });
      await db.notification.create({
        data: { storeId: p.storeId, channel: "inapp", recipient: owner?.user.email ?? "store", template: "payment.refund_manual", status: "SENT", sentAt: new Date(), payload: { title: "Remboursement à effectuer à la main", text: message, orderId: p.orderId } },
      });
    }
    return r.ok ? { attempted: true, ok: true } : { attempted: true, ok: false, error: r.error };
  } catch (e) {
    console.error("[payments] refundExternalAtGateway", e);
    return { attempted: true, ok: false, error: "erreur inattendue" };
  }
}

/** URL de retour / d'annulation / de notification : HTTPS (ou localhost en développement) et notre origine. */
function sameSiteUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.origin === new URL(SITE.url).origin;
  } catch {
    return false;
  }
}

/**
 * Initie un paiement en ligne via une passerelle (redirection). Les clés sont déchiffrées côté serveur uniquement.
 */
export async function initiateGatewayPayment(params: { orderId: string; storeId: string; returnUrl: string; cancelUrl: string; callbackUrl: string }) {
  // m7 : la commande doit appartenir à la boutique de l'appelant, et les trois URL avoir NOTRE origine.
  // `callbackUrl` est transmise à certaines passerelles comme URL de notification (CinetPay `notify_url`) :
  // une URL tierce détournerait les notifications de paiement.
  if (!sameSiteUrl(params.returnUrl) || !sameSiteUrl(params.cancelUrl) || !sameSiteUrl(params.callbackUrl)) {
    return { ok: false as const, error: "URL de paiement invalide." };
  }
  const order = await db.order.findFirst({ where: { id: params.orderId, storeId: params.storeId }, include: { store: true, paymentAttempts: { where: { paymentMethodId: { not: null } }, orderBy: { createdAt: "desc" }, take: 1, include: { paymentMethod: true } } } });
  if (!order) return { ok: false as const, error: "Commande introuvable" };
  const attempt = order.paymentAttempts[0];
  const method = attempt?.paymentMethod;
  if (!attempt || !method || method.kind !== "GATEWAY" || !method.provider) return { ok: false as const, error: "Aucun paiement en ligne à initier" };
  const gateway = getGateway(method.provider);
  if (!gateway) return { ok: false as const, error: "Passerelle inconnue" };
  const creds = gatewayCredentials(method.credentialsEncrypted ? decryptSecret(method.credentialsEncrypted) : null);
  if (order.paymentStatus === "PAID") return { ok: false as const, error: "Cette commande est déjà payée." };

  // M6 : jamais de seconde session pour une tentative déjà initiée (risque de double débit).
  let target: { id: string } = attempt;
  if (attempt.status === "INITIATED" && attempt.providerRef) {
    const s = await gateway.fetchStatus(attempt.providerRef, creds, { initiatedAt: attempt.updatedAt }).catch(() => "UNKNOWN" as const);
    if (s === "CONFIRMED") {
      await applyAttemptStatus(attempt.id, "CONFIRMED", attempt.providerRef);
      return { ok: false as const, error: "Paiement déjà reçu pour cette commande." };
    }
    if (s === "PENDING" || s === "UNKNOWN") {
      const previousUrl = (attempt.metadata as { redirectUrl?: unknown } | null)?.redirectUrl;
      if (typeof previousUrl === "string" && previousUrl.startsWith("https://")) return { ok: true as const, redirectUrl: previousUrl, providerRef: attempt.providerRef };
      return { ok: false as const, error: "Un paiement est déjà en cours pour cette commande. Terminez-le ou réessayez dans quelques minutes." };
    }
    // Session échouée ou expirée : on la clôt et on ouvre une nouvelle tentative.
    await applyAttemptStatus(attempt.id, s, attempt.providerRef);
    target = await db.paymentAttempt.create({ data: { orderId: order.id, paymentMethodId: method.id, provider: attempt.provider, status: "PENDING", amount: dueOf(order), currency: order.currency, channel: attempt.channel, payerPhone: attempt.payerPhone } });
  } else if (attempt.status === "INITIATED" || attempt.status === "CONFIRMED") {
    return { ok: false as const, error: "Un paiement est déjà en cours ou reçu pour cette commande." };
  } else if (attempt.status === "FAILED" || attempt.status === "EXPIRED") {
    target = await db.paymentAttempt.create({ data: { orderId: order.id, paymentMethodId: method.id, provider: attempt.provider, status: "PENDING", amount: dueOf(order), currency: order.currency, channel: attempt.channel, payerPhone: attempt.payerPhone } });
  }
  // Verrou : une seule initiation concurrente par tentative.
  const claimed = await db.paymentAttempt.updateMany({ where: { id: target.id, status: { in: ["CREATED", "PENDING"] } }, data: { status: "INITIATED" } });
  if (claimed.count === 0) return { ok: false as const, error: "Un paiement est déjà en cours pour cette commande." };

  const res = await gateway.initiate(
    {
      attemptId: target.id,
      orderReference: order.reference,
      amount: dueOf(order),
      currency: order.currency,
      customer: { name: order.customerName, phone: order.customerPhone, email: order.customerEmail },
      returnUrl: params.returnUrl,
      cancelUrl: params.cancelUrl,
      callbackUrl: params.callbackUrl,
      description: `Commande ${order.reference} — ${order.store.name}`,
      // Lot 1 bis : pays, portefeuilles autorisés et, s'ils sont connus, portefeuille et numéro du client.
      country: order.store.country,
      channels: method.channels ?? [],
      channel: attempt.channel ?? null,
      payerPhone: attempt.payerPhone ?? null,
    },
    creds,
  ).catch((e: unknown) => ({ ok: false as const, error: `${gateway.label} : ${(e as Error)?.message ?? "erreur inattendue"}`.slice(0, 200) }));
  if (!res.ok) {
    await db.paymentAttempt.update({ where: { id: target.id }, data: { status: "PENDING", failureReason: res.error } });
    return res;
  }
  await db.paymentAttempt.update({
    where: { id: target.id },
    data: { status: "INITIATED", providerRef: res.providerRef, metadata: { redirectUrl: res.redirectUrl, ...(res.metadata ?? {}), ...(res.pushed ? { pushed: true } : {}) } },
  });
  return res;
}

/**
 * Traite un webhook fournisseur : vérifie la signature, enregistre l'événement (idempotent),
 * puis applique le statut à la tentative et à la commande. Tolère les événements désordonnés
 * (un CONFIRMED n'est jamais rétrogradé par un PENDING tardif).
 */
/**
 * m9 : réponse UNIQUE aux webhooks refusés (tentative inconnue, signature invalide, relecture impossible).
 * Un corps ou un code distinct renseignerait l'appelant sur l'existence d'une tentative. 202 : le fournisseur
 * n'enchaîne pas les relances pour un événement que nous n'appliquerons jamais.
 */
const REJECTED = { status: 202, body: "accepted" } as const;

export async function handleGatewayWebhook(providerId: string, rawBody: string, headers: Headers): Promise<{ status: number; body: string }> {
  const gateway = getGateway(providerId);
  if (!gateway) return { status: 404, body: "unknown provider" };

  // Identifier la tentative : on lit les références du payload SANS leur faire confiance avant vérification.
  const payload = parseWebhookPayload(rawBody);
  if (!payload) return { status: 400, body: "invalid body" };
  let providerRefHint: string | null = null;
  let attemptIdHint: string | null = null;
  if (gateway.extractWebhookRefs) {
    const refs = gateway.extractWebhookRefs(payload);
    providerRefHint = refs.providerRef ?? null;
    attemptIdHint = refs.attemptId ?? null;
  } else {
    attemptIdHint = findKey(payload, ["attemptId", "client_reference_id"]);
    providerRefHint = findKey(payload, ["transactionId", "id", "token"]);
  }

  const attempt = await findWebhookAttempt(providerId, attemptIdHint, providerRefHint, !!gateway.extractWebhookRefs);
  // Les clés de vérification sont celles de la boutique propriétaire de la tentative, et de ce fournisseur.
  // m9 : même réponse réseau que pour une signature invalide (aucun oracle d'existence) ; le motif est
  // conservé dans ProviderEvent.error, consultable côté Axi.
  if (!attempt?.paymentMethod || attempt.paymentMethod.provider !== providerId) {
    await recordInvalidWebhook(providerId, rawBody, "no matching attempt", null);
    return REJECTED;
  }
  const creds = gatewayCredentials(attempt.paymentMethod.credentialsEncrypted ? decryptSecret(attempt.paymentMethod.credentialsEncrypted) : null);
  const ctx: WebhookContext = {
    attemptId: attempt.id,
    providerRef: attempt.providerRef,
    amount: attempt.amount,
    currency: attempt.currency,
    metadata: attempt.metadata && typeof attempt.metadata === "object" && !Array.isArray(attempt.metadata) ? (attempt.metadata as Record<string, unknown>) : null,
  };
  const v = await gateway.verifyWebhook(rawBody, headers, creds, ctx).catch((e: unknown) => ({ ok: false as const, error: `Vérification impossible : ${(e as Error)?.message ?? "erreur"}`.slice(0, 200) }));

  if (!v.ok) {
    // Corps non authentifié : jamais stocké (m14, m3). Réponse réseau neutre et identique (m9) : le motif
    // détaillé reste dans ProviderEvent.error.
    await recordInvalidWebhook(providerId, rawBody, v.error, attempt.id);
    return REJECTED;
  }
  const eventId = v.eventId;
  try {
    await db.providerEvent.create({
      data: { provider: providerId, eventId, type: v.type, payload: providerEventProjection(v), signatureValid: true, paymentAttemptId: attempt.id },
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") return { status: 200, body: "duplicate" };
    throw e;
  }

  // m12 : un CONFIRMED sans montant ou sans devise n'est jamais appliqué.
  if (!confirmationHasAmount(v)) {
    await db.providerEvent.updateMany({ where: { provider: providerId, eventId }, data: { processedAt: new Date(), error: "confirmed without amount/currency" } });
    return { status: 200, body: "missing amount recorded" };
  }
  // Montant / devise doivent correspondre
  if ((v.amount != null && v.amount !== attempt.amount) || (v.currency && v.currency.toUpperCase() !== attempt.currency.toUpperCase())) {
    await db.providerEvent.updateMany({ where: { provider: providerId, eventId }, data: { error: "amount/currency mismatch" } });
    // Jamais silencieux : la passerelle ne relancera pas (200), le marchand doit vérifier et trancher.
    await flagAmountMismatch(attempt, { amount: v.amount ?? null, currency: v.currency ?? null }, eventId).catch((e) =>
      console.error("[payments] alerte écart montant", (e as Error).message),
    );
    return { status: 200, body: "mismatch recorded" };
  }

  await applyAttemptStatus(attempt.id, v.status, v.providerRef);
  await db.providerEvent.updateMany({ where: { provider: providerId, eventId }, data: { processedAt: new Date() } });
  return { status: 200, body: "ok" };
}

/** Corps de webhook : JSON, ou formulaire URL-encodé (certains fournisseurs) ; null si illisible. */
export function parseWebhookPayload(rawBody: string): Record<string, unknown> | null {
  try {
    const j: unknown = JSON.parse(rawBody);
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    if (!/^[\w%.+-]+=/.test(rawBody)) return null;
    return Object.fromEntries(new URLSearchParams(rawBody));
  }
}

/**
 * Tentative visée par un webhook, toujours bornée au fournisseur de l'URL appelée.
 * Adaptateurs déclarant leurs références (lot 1 bis) : la référence fournisseur (unique, posée par
 * nous à l'initiation) prime ; l'indice attemptId ne sert qu'en repli.
 */
async function findWebhookAttempt(providerId: string, attemptIdHint: string | null, providerRefHint: string | null, refFirst: boolean) {
  const include = { paymentMethod: true, order: true } as const;
  const byRef = async () => (providerRefHint ? db.paymentAttempt.findFirst({ where: { provider: providerId, providerRef: providerRefHint }, include }) : null);
  const byId = async () => (attemptIdHint ? db.paymentAttempt.findFirst({ where: { id: attemptIdHint, provider: providerId }, include }) : null);
  return refFirst ? ((await byRef()) ?? (await byId())) : ((await byId()) ?? (await byRef()));
}

/**
 * Applique un statut fournisseur à une tentative. Tolère le désordre (un CONFIRMED n'est jamais
 * rétrogradé) et signale tout DOUBLE encaissement (M6) : tentative déjà confirmée sous une autre
 * référence, ou commande déjà payée par une autre tentative : OrderEvent + notification au marchand.
 */
export async function applyAttemptStatus(attemptId: string, status: "CONFIRMED" | "FAILED" | "PENDING" | "EXPIRED", providerRef?: string) {
  await db.$transaction(async (tx) => {
    // Verrou de ligne : deux webhooks simultanés pour la même tentative sont sérialisés.
    await tx.$queryRaw`SELECT id FROM "PaymentAttempt" WHERE id = ${attemptId} FOR UPDATE`;
    const attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId }, include: { order: true } });
    if (!attempt) return;
    const outcome = gatewayStatusOutcome({ status: attempt.status as PaymentAttemptStatus, providerRef: attempt.providerRef }, attempt.order.paymentStatus, { status, providerRef });
    if (outcome === "ignore") return;
    if (outcome === "duplicate") {
      await flagDuplicatePayment(tx, attempt, providerRef ?? null);
      return;
    }
    await tx.paymentAttempt.update({ where: { id: attemptId }, data: { status, providerRef: providerRef ?? attempt.providerRef, verifiedAt: status === "CONFIRMED" ? new Date() : null } });
    const orderStatusMap = { CONFIRMED: "PAID", FAILED: "FAILED", EXPIRED: "FAILED", PENDING: "PENDING" } as const;
    const next = orderStatusMap[status];
    if (attempt.order.paymentStatus !== next && attempt.order.paymentStatus !== "PAID") {
      const updatedOrder = await tx.order.update({ where: { id: attempt.orderId }, data: { paymentStatus: next } });
      await tx.orderEvent.create({ data: { orderId: attempt.orderId, actorLabel: "Passerelle", type: "payment_changed", fromValue: attempt.order.paymentStatus, toValue: next, message: `Statut fournisseur : ${status}` } });
      if (status === "CONFIRMED") {
        await enqueue("payment.succeeded", { orderId: attempt.orderId, attemptId }, { storeId: attempt.order.storeId }, tx);
        await enqueueGiftCardsIfAny(tx, attempt.order.storeId, attempt.orderId);
        await emitDomainEvent(tx, attempt.order.storeId, "order.paid", orderEventData(updatedOrder)); // Lot 2 (W)
      }
      if (status === "FAILED" || status === "EXPIRED") await enqueue("payment.failed", { orderId: attempt.orderId, attemptId }, { storeId: attempt.order.storeId }, tx);
    }
  });
}

type AttemptWithOrder = Prisma.PaymentAttemptGetPayload<{ include: { order: true } }>;

/**
 * Écart montant/devise entre la passerelle et la tentative : la commande n'est PAS marquée payée (la
 * passerelle pourrait être compromise ou mal normalisée), mais le marchand est prévenu pour vérifier
 * dans son espace fournisseur et confirmer manuellement si l'encaissement est légitime. Idempotent par
 * événement fournisseur.
 */
async function flagAmountMismatch(
  attempt: { id: string; orderId: string; amount: number; currency: string; provider: string },
  got: { amount: number | null; currency: string | null },
  eventId: string,
) {
  const ref = eventId.slice(0, 190);
  const order = await db.order.findUnique({ where: { id: attempt.orderId }, select: { storeId: true, reference: true } });
  if (!order) return;
  const already = await db.orderEvent.findFirst({ where: { orderId: attempt.orderId, type: "payment_mismatch", toValue: ref }, select: { id: true } });
  if (already) return;
  const message = `Paiement à vérifier : ${attempt.provider} annonce ${got.amount ?? "?"} ${got.currency ?? "?"} pour la commande ${order.reference}, alors que ${attempt.amount} ${attempt.currency} étaient attendus. La commande n'a pas été marquée payée : vérifiez dans votre espace ${attempt.provider} et confirmez manuellement si l'encaissement est correct.`;
  await db.orderEvent.create({ data: { orderId: attempt.orderId, actorLabel: "Passerelle", type: "payment_mismatch", toValue: ref, message } });
  const owner = await db.membership.findFirst({ where: { storeId: order.storeId, role: "OWNER" }, include: { user: { select: { email: true } } } });
  await db.notification.create({
    data: {
      storeId: order.storeId,
      channel: "inapp",
      recipient: owner?.user.email ?? "store",
      template: "payment.mismatch",
      status: "SENT",
      sentAt: new Date(),
      payload: { title: `Paiement à vérifier : commande ${order.reference}`, text: message, orderId: attempt.orderId },
    },
  });
  await audit({ storeId: order.storeId, action: "payment.amount_mismatch", target: attempt.orderId, metadata: { attemptId: attempt.id, provider: attempt.provider, expected: `${attempt.amount} ${attempt.currency}`, received: `${got.amount ?? "?"} ${got.currency ?? "?"}` } });
}

/** Double encaissement : jamais silencieux, le marchand doit rembourser le client. */
async function flagDuplicatePayment(tx: Prisma.TransactionClient, attempt: AttemptWithOrder, providerRef: string | null) {
  const ref = providerRef ?? "inconnue";
  const already = await tx.orderEvent.findFirst({ where: { orderId: attempt.orderId, type: "payment_duplicate", toValue: ref }, select: { id: true } });
  if (already) return;
  const message = `Paiement en double à rembourser : ${attempt.amount} ${attempt.currency} reçus via ${attempt.provider} (référence ${ref}) alors que la commande ${attempt.order.reference} était déjà payée.`;
  // La tentative a bien été encaissée : son état le reflète (les rejeux suivants sont ignorés).
  if (attempt.status !== "CONFIRMED") {
    await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "CONFIRMED", providerRef: providerRef ?? attempt.providerRef, verifiedAt: new Date(), metadata: { duplicate: true } } });
  }
  await tx.orderEvent.create({ data: { orderId: attempt.orderId, actorLabel: "Passerelle", type: "payment_duplicate", fromValue: attempt.providerRef, toValue: ref, message } });
  const owner = await tx.membership.findFirst({ where: { storeId: attempt.order.storeId, role: "OWNER" }, include: { user: { select: { email: true } } } });
  await tx.notification.create({
    data: {
      storeId: attempt.order.storeId,
      channel: "inapp",
      recipient: owner?.user.email ?? "store",
      template: "payment.duplicate",
      status: "SENT",
      sentAt: new Date(),
      payload: { title: `Paiement en double : commande ${attempt.order.reference}`, text: message, orderId: attempt.orderId, providerRef: ref },
    },
  });
  await audit({ storeId: attempt.order.storeId, action: "payment.duplicate_detected", target: attempt.orderId, metadata: { attemptId: attempt.id, provider: attempt.provider, providerRef: ref, previousRef: attempt.providerRef } }, tx);
}

/** Rapprochement : interroge le fournisseur pour les tentatives INITIATED anciennes (webhooks manqués). */
export async function reconcilePendingAttempts(olderThanMinutes = 10, limit = 50) {
  const since = new Date(Date.now() - olderThanMinutes * 60_000);
  const attempts = await db.paymentAttempt.findMany({ where: { status: "INITIATED", updatedAt: { lt: since }, providerRef: { not: null } }, include: { paymentMethod: true }, take: limit });
  let updated = 0;
  for (const a of attempts) {
    const gateway = a.paymentMethod?.provider ? getGateway(a.paymentMethod.provider) : null;
    if (!gateway || !a.providerRef) continue;
    const creds = gatewayCredentials(a.paymentMethod?.credentialsEncrypted ? decryptSecret(a.paymentMethod.credentialsEncrypted) : null);
    const s = await gateway.fetchStatus(a.providerRef, creds, { initiatedAt: a.updatedAt }).catch(() => "UNKNOWN" as const);
    if (s === "UNKNOWN" || s === "PENDING") continue;
    await applyAttemptStatus(a.id, s, a.providerRef);
    updated++;
  }
  return { checked: attempts.length, updated };
}

function findKey(obj: unknown, keys: string[], depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const r = findKey(v, keys, depth + 1);
    if (r) return r;
  }
  return null;
}

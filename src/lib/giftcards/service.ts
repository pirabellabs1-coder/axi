import "server-only";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { sendMail } from "@/lib/email";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { waLink } from "@/lib/whatsapp";
import { SITE } from "@/config/site";
import { formatGiftCardCode, generateGiftCardCode, giftCardLast4, hashGiftCardCode, normalizeGiftCardCode } from "./code";
import {
  GIFT_CARD_INVALID_MESSAGE,
  MAX_GIFT_CARDS_PER_CHECKOUT,
  allocateGiftCardTenders,
  giftCardExpiry,
  giftCardUsabilityProblem,
  prorata,
  readGiftCardRecipient,
  type GiftCardStatusValue,
} from "./state";
import { GiftCardError } from "./errors";
import { GIFTCARDS_SUSPENDED_MESSAGE, getGiftCardsKillSwitch } from "./kill-switch";
import { recordInvalidGiftCardAttempt } from "./abuse";

/**
 * Services serveur des cartes cadeaux (spécification lot 1, §3 et §0.4).
 *
 * Contrat avec l'équipe B (createOrder, transitionOrder, requestRefund) — fonctions transactionnelles `*Tx` :
 *  1. `lockGiftCardsTx(tx, storeId, codes, { currency })` : verrouille (FOR UPDATE) et valide les cartes, renvoie leurs
 *     soldes à passer au pipeline (`PipelineInput` « cartes cadeaux (soldes verrouillés) ») ;
 *  2. création de la commande ;
 *  3. `redeemGiftCardsTx(tx, storeId, codes, maxAmount, { orderId })` : débit conditionnel dans l'ordre normatif
 *     (expiration la plus proche, puis plus petit solde), journal REDEEM et PaymentAttempt `gift_card` CONFIRMED.
 *     `maxAmount` = assiette des tenders (total − lignes carte cadeau). Le résultat est identique à la répartition
 *     du pipeline puisque les soldes sont verrouillés depuis l'étape 1 ;
 *  4. annulation : `reverseGiftCardsTx(tx, storeId, orderId)` (idempotent : ne recrédite que le net encore débité).
 * Erreurs : `GiftCardError` (message lisible, à convertir en `CheckoutError`).
 * Émission : `enqueueGiftCardIssueTx(tx, storeId, orderId)` après paiement confirmé (payment.succeeded,
 * confirmManualPayment) ; le job appelle `issueGiftCardsForOrder` (idempotent, `@@unique([sourceOrderItemId, sequence])`).
 */

export type LockedGiftCard = {
  id: string;
  last4: string;
  balance: number;
  currency: string;
  expiresAt: Date | null;
  status: GiftCardStatusValue;
  /** Code normalisé saisi (renvoyé pour que l'appelant puisse le réutiliser à l'étape 3). */
  code: string;
};

export type GiftCardTenderLine = {
  giftCardId: string;
  last4: string;
  amount: number;
  balanceBefore: number;
  remainingAfter: number;
  expiresAt: Date | null;
};

export type GiftCardRedeemResult = { total: number; lines: GiftCardTenderLine[] };

type LoadOpts = { currency?: string; now?: Date; lock?: boolean; client?: Tx | typeof db };

async function storeCurrency(client: Tx | typeof db, storeId: string): Promise<string> {
  const store = await client.store.findUnique({ where: { id: storeId }, select: { currency: true } });
  if (!store) throw new GiftCardError(GIFT_CARD_INVALID_MESSAGE, "invalid");
  return store.currency;
}

/** Normalise et dédoublonne ; erreurs lisibles. Exporté pour le composant de saisie et les tests. */
export function parseGiftCardCodes(codes: unknown[]): string[] {
  const normalized: string[] = [];
  for (const raw of codes) {
    if (typeof raw === "string" && raw.trim() === "") continue;
    const code = normalizeGiftCardCode(raw);
    if (!code) throw new GiftCardError(GIFT_CARD_INVALID_MESSAGE, "invalid");
    if (!normalized.includes(code)) normalized.push(code);
  }
  if (normalized.length > MAX_GIFT_CARDS_PER_CHECKOUT) throw new GiftCardError(`${MAX_GIFT_CARDS_PER_CHECKOUT} cartes cadeaux maximum par commande.`, "too_many");
  return normalized;
}

async function loadGiftCards(client: Tx | typeof db, storeId: string, codes: string[], opts: LoadOpts): Promise<LockedGiftCard[]> {
  const kill = await getGiftCardsKillSwitch(client);
  if (kill.enabled) throw new GiftCardError(kill.message || GIFTCARDS_SUSPENDED_MESSAGE, "suspended");
  let normalized: string[];
  try {
    normalized = parseGiftCardCodes(codes);
  } catch (e) {
    if (e instanceof GiftCardError && e.code === "invalid") await recordInvalidGiftCardAttempt(storeId);
    throw e;
  }
  if (normalized.length === 0) return [];
  const currency = opts.currency ?? (await storeCurrency(client, storeId));
  const now = opts.now ?? new Date();
  const hashes = normalized.map((c) => hashGiftCardCode(storeId, c));
  if (opts.lock) {
    // Verrou des lignes avant lecture du solde (§0.4), ordre stable par id pour éviter les interblocages.
    await client.$queryRaw`SELECT "id" FROM "GiftCard" WHERE "storeId" = ${storeId} AND "codeHash" IN (${Prisma.join(hashes)}) ORDER BY "id" FOR UPDATE`;
  }
  const rows = await client.giftCard.findMany({
    where: { storeId, codeHash: { in: hashes } },
    select: { id: true, codeHash: true, last4: true, balance: true, currency: true, expiresAt: true, status: true },
  });
  const cards: LockedGiftCard[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const row = rows.find((r) => r.codeHash === hashes[i]);
    const problem = row ? giftCardUsabilityProblem(row, { currency, now }) : "status";
    if (!row || (problem && problem !== "empty")) {
      await recordInvalidGiftCardAttempt(storeId);
      throw new GiftCardError(GIFT_CARD_INVALID_MESSAGE, "invalid");
    }
    // Carte vide : même message unique qu'un code invalide (aucune information sur le solde d'un code tiers).
    if (problem === "empty") throw new GiftCardError(GIFT_CARD_INVALID_MESSAGE, "empty");
    cards.push({ id: row.id, last4: row.last4, balance: row.balance, currency: row.currency, expiresAt: row.expiresAt, status: row.status, code: normalized[i] });
  }
  return cards;
}

/**
 * Verrouille (SELECT … FOR UPDATE) et valide les cartes saisies au checkout : ACTIVE, non expirées, devise de la
 * boutique, solde > 0. Au plus 3 codes (dédoublonnés). Lève GiftCardError. Respecte l'arrêt d'urgence plateforme.
 */
export async function lockGiftCardsTx(tx: Tx, storeId: string, codes: string[], opts: { currency?: string; now?: Date } = {}): Promise<LockedGiftCard[]> {
  return loadGiftCards(tx, storeId, codes, { ...opts, lock: true });
}

/**
 * Lecture sans verrou pour `previewTotals` : mêmes contrôles et même répartition que le débit réel.
 * Renvoie `[{ last4, applied, remainingAfter }]` (le solde n'est visible que par qui connaît le code).
 */
export async function previewGiftCardTenders(
  storeId: string,
  codes: string[],
  maxAmount: number,
  opts: { currency?: string; now?: Date; client?: Tx | typeof db } = {},
): Promise<{ total: number; cards: { last4: string; applied: number; remainingAfter: number }[] }> {
  const cards = await loadGiftCards(opts.client ?? db, storeId, codes, opts);
  const alloc = allocateGiftCardTenders(cards, maxAmount);
  return { total: alloc.reduce((s, a) => s + a.amount, 0), cards: alloc.map((a) => ({ last4: a.card.last4, applied: a.amount, remainingAfter: a.remainingAfter })) };
}

/**
 * Débite les cartes au checkout, dans la transaction de createOrder (§3 « createOrder » 1 à 5) :
 * verrou, contrôles, débit conditionnel `balance >= montant`, `GiftCardTransaction REDEEM` (`balanceAfter`) et, si
 * `opts.orderId` est fourni, `PaymentAttempt { provider: "gift_card", status: CONFIRMED }` par carte débitée.
 * `maxAmount` : assiette des tenders (total − lignes carte cadeau) ; une carte ne paie jamais une carte.
 */
export async function redeemGiftCardsTx(
  tx: Tx,
  storeId: string,
  codes: string[],
  maxAmount: number,
  opts: { orderId?: string; currency?: string; now?: Date; actorId?: string | null } = {},
): Promise<GiftCardRedeemResult> {
  let currency = opts.currency;
  if (opts.orderId) {
    const order = await tx.order.findFirst({ where: { id: opts.orderId, storeId }, select: { id: true, currency: true } });
    if (!order) throw new Error("Commande introuvable pour le débit des cartes cadeaux");
    currency = order.currency;
  }
  const cards = await lockGiftCardsTx(tx, storeId, codes, { currency, now: opts.now });
  if (cards.length === 0) return { total: 0, lines: [] };
  const lines: GiftCardTenderLine[] = [];
  for (const { card, amount } of allocateGiftCardTenders(cards, maxAmount)) {
    if (amount <= 0) {
      lines.push({ giftCardId: card.id, last4: card.last4, amount: 0, balanceBefore: card.balance, remainingAfter: card.balance, expiresAt: card.expiresAt });
      continue;
    }
    const debited = await tx.giftCard.updateMany({
      where: { id: card.id, storeId, status: "ACTIVE", balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (debited.count !== 1) throw new GiftCardError("Le solde d'une carte cadeau vient de changer. Vérifiez votre commande et réessayez.", "insufficient");
    const after = await tx.giftCard.findUnique({ where: { id: card.id }, select: { balance: true } });
    const balanceAfter = after?.balance ?? card.balance - amount;
    const journal = await tx.giftCardTransaction.create({
      data: { storeId, giftCardId: card.id, kind: "REDEEM", amount: -amount, balanceAfter, orderId: opts.orderId ?? null, actorId: opts.actorId ?? null },
    });
    if (opts.orderId) {
      await tx.paymentAttempt.create({
        data: {
          orderId: opts.orderId,
          provider: "gift_card",
          providerRef: journal.id,
          status: "CONFIRMED",
          amount,
          currency: card.currency,
          verifiedAt: opts.now ?? new Date(),
          metadata: { giftCardId: card.id, last4: card.last4 },
        },
      });
    }
    lines.push({ giftCardId: card.id, last4: card.last4, amount, balanceBefore: card.balance, remainingAfter: balanceAfter, expiresAt: card.expiresAt });
  }
  return { total: lines.reduce((s, l) => s + l.amount, 0), lines };
}

export type GiftCardReversalLine = { giftCardId: string; last4: string; amount: number; balanceAfter: number };

/**
 * Recrédite les cartes débitées pour une commande (`REVERSAL`), dans la transaction appelante.
 *  - sans `amount` : tout le net encore débité (annulation) ;
 *  - avec `amount` : remboursement partiel, réparti au prorata des montants débités (plus fort reste).
 * Idempotent : le net est recalculé depuis le journal (REDEEM − REVERSAL), un second appel ne recrédite rien.
 * Le statut de la carte n'est pas modifié (une carte expirée recréditée reste expirée, prolongeable).
 */
export async function reverseGiftCardsTx(
  tx: Tx,
  storeId: string,
  orderId: string,
  opts: { amount?: number; actorId?: string | null; note?: string; returnId?: string | null } = {},
): Promise<{ total: number; lines: GiftCardReversalLine[] }> {
  const rows = await tx.giftCardTransaction.findMany({
    where: { storeId, orderId, kind: { in: ["REDEEM", "REVERSAL"] } },
    select: { giftCardId: true, amount: true },
  });
  const outstanding = new Map<string, number>();
  for (const r of rows) outstanding.set(r.giftCardId, (outstanding.get(r.giftCardId) ?? 0) - r.amount);
  const ids = [...outstanding.keys()].filter((id) => (outstanding.get(id) ?? 0) > 0).sort();
  if (ids.length === 0) return { total: 0, lines: [] };
  const weights = ids.map((id) => outstanding.get(id)!);
  const totalOutstanding = weights.reduce((s, w) => s + w, 0);
  const target = Math.min(totalOutstanding, Math.max(0, Math.floor(opts.amount ?? totalOutstanding)));
  if (target <= 0) return { total: 0, lines: [] };
  const amounts = target === totalOutstanding ? weights : prorata(target, weights);

  await tx.$queryRaw`SELECT "id" FROM "GiftCard" WHERE "storeId" = ${storeId} AND "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
  const lines: GiftCardReversalLine[] = [];
  for (let i = 0; i < ids.length; i++) {
    const amount = amounts[i];
    if (amount <= 0) continue;
    const updated = await tx.giftCard.updateMany({ where: { id: ids[i], storeId }, data: { balance: { increment: amount } } });
    if (updated.count !== 1) continue; // carte supprimée avec la boutique : rien à recréditer
    const card = await tx.giftCard.findUnique({ where: { id: ids[i] }, select: { balance: true, last4: true } });
    const balanceAfter = card?.balance ?? amount;
    await tx.giftCardTransaction.create({
      data: {
        storeId,
        giftCardId: ids[i],
        kind: "REVERSAL",
        amount,
        balanceAfter,
        orderId,
        returnId: opts.returnId ?? null,
        actorId: opts.actorId ?? null,
        note: opts.note ?? (opts.amount == null ? "Annulation de commande" : "Remboursement"),
      },
    });
    lines.push({ giftCardId: ids[i], last4: card?.last4 ?? "", amount, balanceAfter });
  }
  return { total: lines.reduce((s, l) => s + l.amount, 0), lines };
}

/* ─────────────── Cartes achetées par une commande : annulation et remboursement ─────────────── */

export type PurchasedGiftCardsState = {
  /** Unités carte cadeau commandées. */
  units: number;
  /** Cartes déjà émises. */
  issued: number;
  /** Solde restant (non dépensé) des cartes émises. */
  balance: number;
};

export async function purchasedGiftCardsState(tx: Tx, storeId: string, orderId: string): Promise<PurchasedGiftCardsState> {
  const [items, cards] = await Promise.all([
    tx.orderItem.findMany({ where: { orderId, isGiftCard: true }, select: { quantity: true } }),
    tx.giftCard.findMany({ where: { storeId, sourceOrderId: orderId }, select: { balance: true } }),
  ]);
  return { units: items.reduce((s, i) => s + i.quantity, 0), issued: cards.length, balance: cards.reduce((s, c) => s + Math.max(0, c.balance), 0) };
}

/**
 * Débite (ADJUST négatif) les cartes ACHETÉES par une commande, à hauteur de `amount` (ou de tout leur solde si
 * `amount` est absent), et DÉSACTIVE chaque carte dont le solde tombe à 0 (ou toutes si `disableAll`). Utilisé par
 * l'annulation (tout le solde) et par requestRefund (la part du remboursement qui porte sur les cartes).
 * La valeur déjà dépensée n'est jamais remboursable (voir refundableRemaining). Renvoie le montant débité.
 */
export async function neutralizePurchasedGiftCardsTx(
  tx: Tx,
  storeId: string,
  orderId: string,
  opts: { amount?: number; actorId?: string | null; note: string; disableAll?: boolean },
): Promise<{ debited: number; disabled: number }> {
  const cards = await tx.giftCard.findMany({ where: { storeId, sourceOrderId: orderId }, select: { id: true }, orderBy: { id: "asc" } });
  if (cards.length === 0) return { debited: 0, disabled: 0 };
  await tx.$queryRaw`SELECT "id" FROM "GiftCard" WHERE "storeId" = ${storeId} AND "id" IN (${Prisma.join(cards.map((c) => c.id))}) ORDER BY "id" FOR UPDATE`;
  const rows = await tx.giftCard.findMany({ where: { storeId, sourceOrderId: orderId }, select: { id: true, balance: true, status: true }, orderBy: { id: "asc" } });
  let left = opts.amount == null ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(opts.amount));
  let debited = 0;
  let disabled = 0;
  for (const c of rows) {
    const take = Math.min(Math.max(0, c.balance), left);
    if (take > 0) {
      const done = await tx.giftCard.updateMany({ where: { id: c.id, storeId, balance: { gte: take } }, data: { balance: { decrement: take } } });
      if (done.count !== 1) throw new GiftCardError("Le solde d'une carte cadeau vient de changer. Réessayez.", "insufficient");
      await tx.giftCardTransaction.create({ data: { storeId, giftCardId: c.id, kind: "ADJUST", amount: -take, balanceAfter: c.balance - take, orderId, actorId: opts.actorId ?? null, note: opts.note.slice(0, 300) } });
      left -= take;
      debited += take;
    }
    const after = c.balance - take;
    if (c.status !== "DISABLED" && (after <= 0 || opts.disableAll)) {
      await tx.giftCard.updateMany({ where: { id: c.id, storeId }, data: { status: "DISABLED", disabledReason: opts.note.slice(0, 200) } });
      await tx.giftCardTransaction.create({ data: { storeId, giftCardId: c.id, kind: "ADJUST", amount: 0, balanceAfter: Math.max(0, after), orderId, actorId: opts.actorId ?? null, note: `Désactivée : ${opts.note}`.slice(0, 300) } });
      disabled++;
    }
    if (left <= 0 && !opts.disableAll) break;
  }
  return { debited, disabled };
}

/* ───────────────────────── Émission et envoi ───────────────────────── */

/** À appeler dans la transaction qui confirme le paiement (payment.succeeded, confirmManualPayment). */
export async function enqueueGiftCardIssueTx(tx: Tx, storeId: string, orderId: string) {
  return enqueue("giftcard.issue", { orderId }, { storeId }, tx);
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Crée une carte avec un code neuf (nouvel essai en cas de collision de codeHash, improbable à 80 bits). */
export async function createGiftCardRecord(
  tx: Tx,
  data: Omit<Prisma.GiftCardUncheckedCreateInput, "codeHash" | "codeEnc" | "last4" | "balance"> & { initialValue: number },
  journal: { actorId?: string | null; note?: string | null; orderId?: string | null },
): Promise<{ id: string; code: string; last4: string }> {
  const code = generateGiftCardCode();
  const card = await tx.giftCard.create({
    data: { ...data, codeHash: hashGiftCardCode(data.storeId, code), codeEnc: encryptSecret(code), last4: giftCardLast4(code), balance: data.initialValue },
    select: { id: true, last4: true },
  });
  await tx.giftCardTransaction.create({
    data: { storeId: data.storeId, giftCardId: card.id, kind: "ISSUE", amount: data.initialValue, balanceAfter: data.initialValue, orderId: journal.orderId ?? null, actorId: journal.actorId ?? null, note: journal.note ?? null },
  });
  // Lot 2 (W) : webhook dans la transaction d'émission. Jamais le code ; destinataire non transmis.
  const { emitDomainEvent } = await import("@/lib/webhooks/emit");
  await emitDomainEvent(tx, data.storeId, "giftcard.issued", {
    gift_card_id: card.id,
    last4: card.last4,
    initial_value: data.initialValue,
    currency: data.currency ?? null,
    expires_at: data.expiresAt ? new Date(data.expiresAt).toISOString() : null,
    order_id: journal.orderId ?? null,
    source: journal.orderId ? "order" : "manual",
  });
  return { id: card.id, code, last4: card.last4 };
}

function parseSendAt(raw: string | null | undefined, now: Date): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) return null;
  // Au plus un an de différé.
  return d.getTime() - now.getTime() > 366 * 86_400_000 ? null : d;
}

/**
 * Émet les cartes d'une commande payée : une carte par unité des lignes `isGiftCard`, idempotent par
 * `(sourceOrderItemId, sequence)`. Jamais avant paiement confirmé (`paymentStatus = PAID`). Programme l'envoi.
 */
export async function issueGiftCardsForOrder(orderId: string, opts: { now?: Date } = {}): Promise<{ issued: number; skipped: number; reason?: string }> {
  const now = opts.now ?? new Date();
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, storeId: true, customerId: true, currency: true, paymentStatus: true, status: true, customerName: true, items: { select: { id: true, productId: true, unitPrice: true, quantity: true, isGiftCard: true, options: true } } },
  });
  if (!order) return { issued: 0, skipped: 0, reason: "not_found" };
  if (order.paymentStatus !== "PAID") return { issued: 0, skipped: 0, reason: "unpaid" };
  if (order.status === "CANCELLED" || order.status === "REFUNDED") return { issued: 0, skipped: 0, reason: "cancelled" };
  const lines = order.items.filter((i) => i.isGiftCard);
  if (lines.length === 0) return { issued: 0, skipped: 0, reason: "no_gift_card" };
  const productIds = [...new Set(lines.map((l) => l.productId).filter((v): v is string => !!v))];
  const products = productIds.length
    ? await db.product.findMany({ where: { id: { in: productIds }, storeId: order.storeId }, select: { id: true, giftCardValidityDays: true } })
    : [];

  let issued = 0;
  let skipped = 0;
  for (const line of lines) {
    const recipient = readGiftCardRecipient(line.options);
    const validity = products.find((p) => p.id === line.productId)?.giftCardValidityDays ?? null;
    for (let sequence = 0; sequence < line.quantity; sequence++) {
      const exists = await db.giftCard.findFirst({ where: { sourceOrderItemId: line.id, sequence }, select: { id: true } });
      if (exists) {
        skipped++;
        continue;
      }
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        try {
          const emitted = await db.$transaction(async (tx) => {
            // Revérification sous verrou : une annulation ou un remboursement concurrent empêche l'émission.
            await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
            const fresh = await tx.order.findUnique({ where: { id: order.id }, select: { status: true, paymentStatus: true } });
            if (!fresh || fresh.paymentStatus !== "PAID" || fresh.status === "CANCELLED" || fresh.status === "REFUNDED") return false;
            const sendAt = parseSendAt(recipient.sendAt, now);
            const card = await createGiftCardRecord(
              tx,
              {
                storeId: order.storeId,
                currency: order.currency,
                initialValue: line.unitPrice,
                status: "ACTIVE",
                source: "PURCHASE",
                expiresAt: giftCardExpiry(now, validity),
                customerId: order.customerId,
                sourceOrderId: order.id,
                sourceOrderItemId: line.id,
                sequence,
                recipientName: recipient.recipientName ?? null,
                recipientPhone: recipient.recipientPhone ?? null,
                recipientEmail: recipient.recipientEmail ?? null,
                message: recipient.message ?? null,
                sendAt,
              },
              { orderId: order.id, note: "Achat" },
            );
            await audit({ storeId: order.storeId, actorId: null, action: "giftcard.issued", target: card.id, metadata: { orderId: order.id, last4: card.last4, value: line.unitPrice } }, tx);
            await enqueue("giftcard.deliver", { giftCardId: card.id }, { storeId: order.storeId, runAt: sendAt ?? now }, tx);
            return true;
          });
          if (!emitted) return { issued, skipped, reason: "cancelled" };
          issued++;
          done = true;
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          // Unicité (sourceOrderItemId, sequence) : émise par un autre worker ; sinon collision de code, on recommence.
          if (await db.giftCard.findFirst({ where: { sourceOrderItemId: line.id, sequence }, select: { id: true } })) {
            skipped++;
            done = true;
          }
        }
      }
      if (!done) throw new Error("Émission de carte cadeau impossible (collisions répétées)");
    }
  }
  return { issued, skipped };
}

export function giftCardStoreUrl(slug: string): string {
  return `${SITE.url.replace(/\/+$/, "")}/s/${slug}`;
}

/** Texte remis au destinataire (contient le code : jamais stocké dans Notification ni journalisé). */
export function giftCardMessageText(p: {
  storeName: string;
  slug: string;
  code: string;
  value: number;
  balance: number;
  currency: string;
  expiresAt: Date | null;
  recipientName?: string | null;
  senderName?: string | null;
  message?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`Bonjour${p.recipientName ? ` ${p.recipientName}` : ""},`);
  lines.push("");
  lines.push(`${p.senderName ? `${p.senderName} vous offre` : "Vous recevez"} une carte cadeau de ${formatMoney(p.value, p.currency)} chez ${p.storeName}.`);
  if (p.balance !== p.value) lines.push(`Solde disponible : ${formatMoney(p.balance, p.currency)}.`);
  if (p.message) lines.push("", `Message : « ${p.message} »`);
  lines.push("", `Code : ${formatGiftCardCode(p.code)}`);
  if (p.expiresAt) lines.push(`Valable jusqu'au ${formatDate(p.expiresAt, { day: "numeric", month: "long", year: "numeric" })}.`);
  lines.push("", `Utilisez-la au paiement sur ${giftCardStoreUrl(p.slug)} (champ « Carte cadeau »).`);
  lines.push(`Vérifier le solde : ${giftCardStoreUrl(p.slug)}/carte-cadeau`);
  lines.push("", "Gardez ce code secret : toute personne qui le connaît peut utiliser la carte.");
  return lines.join("\n");
}

export type DeliveryChannel = "email" | "link" | "none";

/**
 * Envoi au destinataire (job giftcard.deliver ou « Renvoyer »).
 *  - e-mail du destinataire : envoi direct (`sendMail`, le code ne passe pas par la table Notification) ;
 *  - sinon : canal « lien » — un lien wa.me prérempli est proposé à l'acheteur (/merci) ou au commerçant
 *    (« Renvoyer », révélation auditée). L'envoi par l'API WhatsApp Cloud de la boutique est un point
 *    d'intégration : aucun expéditeur réel n'existe encore côté plateforme (cf. src/lib/inbox/service.ts).
 * `deliveredAt` n'est posé qu'après un envoi effectif.
 */
export async function deliverGiftCard(giftCardId: string, opts: { force?: boolean } = {}): Promise<{ channel: DeliveryChannel }> {
  const card = await db.giftCard.findUnique({
    where: { id: giftCardId },
    select: {
      id: true, storeId: true, codeEnc: true, status: true, initialValue: true, balance: true, currency: true, expiresAt: true,
      recipientName: true, recipientEmail: true, recipientPhone: true, message: true, deliveredAt: true, sourceOrderId: true,
      store: { select: { name: true, slug: true } },
    },
  });
  if (!card || card.status !== "ACTIVE") return { channel: "none" };
  if (card.deliveredAt && !opts.force) return { channel: "none" };
  if (!card.recipientEmail) return { channel: card.recipientPhone ? "link" : "none" };
  let senderName: string | null = null;
  if (card.sourceOrderId) {
    const order = await db.order.findFirst({ where: { id: card.sourceOrderId, storeId: card.storeId }, select: { customerName: true } });
    senderName = order?.customerName ?? null;
  }
  const code = decryptSecret(card.codeEnc);
  const res = await sendMail({
    to: card.recipientEmail,
    subject: `Votre carte cadeau ${card.store.name}`,
    text: giftCardMessageText({ storeName: card.store.name, slug: card.store.slug, code, value: card.initialValue, balance: card.balance, currency: card.currency, expiresAt: card.expiresAt, recipientName: card.recipientName, senderName, message: card.message }),
  });
  if (!res.ok) throw new Error(`Envoi de la carte cadeau impossible : ${res.error ?? "erreur inconnue"}`);
  await db.giftCard.update({ where: { id: card.id }, data: { deliveredAt: new Date() } });
  return { channel: "email" };
}

/** Lien wa.me prérempli vers le destinataire (le code y figure : à ne produire que pour un ayant droit). */
export async function giftCardWhatsappLink(giftCardId: string, storeId: string): Promise<string | null> {
  const card = await db.giftCard.findFirst({
    where: { id: giftCardId, storeId },
    select: { codeEnc: true, initialValue: true, balance: true, currency: true, expiresAt: true, recipientName: true, recipientPhone: true, message: true, store: { select: { name: true, slug: true } } },
  });
  if (!card?.recipientPhone) return null;
  const code = decryptSecret(card.codeEnc);
  return waLink(card.recipientPhone, giftCardMessageText({ storeName: card.store.name, slug: card.store.slug, code, value: card.initialValue, balance: card.balance, currency: card.currency, expiresAt: card.expiresAt, recipientName: card.recipientName, message: card.message }));
}

/**
 * Cartes émises pour une commande, vues par l'acheteur (/merci, /suivi : l'appelant a prouvé la possession
 * par le jeton de suivi). Dernier groupe de 4 caractères uniquement ; `shareLink` (wa.me avec le code) seulement
 * si la carte n'a pas pu être envoyée par e-mail.
 */
export async function listOrderGiftCardsForBuyer(storeId: string, orderId: string): Promise<{ id: string; last4: string; value: number; currency: string; delivered: boolean; recipientName: string | null; shareLink: string | null }[]> {
  const cards = await db.giftCard.findMany({
    where: { storeId, sourceOrderId: orderId },
    select: { id: true, last4: true, initialValue: true, currency: true, deliveredAt: true, recipientName: true, recipientPhone: true },
    orderBy: { createdAt: "asc" },
  });
  const out = [];
  for (const c of cards) {
    out.push({
      id: c.id,
      last4: c.last4,
      value: c.initialValue,
      currency: c.currency,
      delivered: !!c.deliveredAt,
      recipientName: c.recipientName,
      shareLink: !c.deliveredAt && c.recipientPhone ? await giftCardWhatsappLink(c.id, storeId) : null,
    });
  }
  return out;
}

/* ───────────────────────── Balayages quotidiens ───────────────────────── */

/** ACTIVE → EXPIRED pour les cartes dont `expiresAt ≤ now` (transition conditionnelle, journal EXPIRE, audit). */
export async function expireGiftCards(now = new Date(), batch = 200): Promise<{ expired: number }> {
  let expired = 0;
  for (let round = 0; round < 50; round++) {
    const due = await db.giftCard.findMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, select: { id: true, storeId: true, balance: true, last4: true }, take: batch, orderBy: { expiresAt: "asc" } });
    if (due.length === 0) break;
    for (const card of due) {
      await db.$transaction(async (tx) => {
        const res = await tx.giftCard.updateMany({ where: { id: card.id, status: "ACTIVE", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
        if (res.count !== 1) return;
        await tx.giftCardTransaction.create({ data: { storeId: card.storeId, giftCardId: card.id, kind: "EXPIRE", amount: 0, balanceAfter: card.balance, note: "Expiration" } });
        await audit({ storeId: card.storeId, actorId: null, action: "giftcard.expired", target: card.id, metadata: { last4: card.last4, balance: card.balance } }, tx);
        expired++;
      });
    }
    if (due.length < batch) break;
  }
  return { expired };
}

/** Filet de sécurité : commandes payées (30 derniers jours) contenant des cartes non émises → job d'émission. */
export async function enqueueMissingGiftCardIssues(now = new Date()): Promise<{ enqueued: number }> {
  const orders = await db.order.findMany({
    where: { paymentStatus: "PAID", createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) }, items: { some: { isGiftCard: true } } },
    select: { id: true, storeId: true, items: { where: { isGiftCard: true }, select: { quantity: true } } },
    take: 500,
  });
  let enqueued = 0;
  for (const o of orders) {
    const expected = o.items.reduce((s, i) => s + i.quantity, 0);
    const count = await db.giftCard.count({ where: { storeId: o.storeId, sourceOrderId: o.id } });
    if (count < expected) {
      await enqueue("giftcard.issue", { orderId: o.id }, { storeId: o.storeId });
      enqueued++;
    }
  }
  return { enqueued };
}

/**
 * Commandes impayées depuis plus de 72 h alors qu'une carte ou un avoir a été débité : notification au commerçant
 * (idempotente par commande). Pas d'annulation automatique au lot 1.
 */
export async function notifyUnpaidTenderOrders(now = new Date()): Promise<{ notified: number }> {
  const { notifyStore } = await import("@/lib/notifications/service");
  const orders = await db.order.findMany({
    where: {
      createdAt: { lte: new Date(now.getTime() - 72 * 3_600_000), gte: new Date(now.getTime() - 60 * 86_400_000) },
      paymentStatus: { in: ["UNPAID", "PENDING", "FAILED"] },
      status: { notIn: ["CANCELLED", "REFUNDED"] },
      OR: [{ giftCardAmount: { gt: 0 } }, { storeCreditAmount: { gt: 0 } }],
    },
    select: { id: true, storeId: true, reference: true, giftCardAmount: true, storeCreditAmount: true, currency: true, amountDue: true },
    take: 500,
  });
  let notified = 0;
  for (const o of orders) {
    const created = await notifyStore(o.storeId, {
      kind: "payment.verify",
      key: `tenders-unpaid:${o.id}`,
      title: `Commande ${o.reference} impayée depuis plus de 72 h`,
      text: `${formatMoney(o.giftCardAmount + o.storeCreditAmount, o.currency)} déjà réglés par carte cadeau ou avoir ; reste dû ${formatMoney(o.amountDue ?? 0, o.currency)}. Relancez le client ou annulez la commande (recrédit automatique).`,
      href: `/app/${o.storeId}/commandes/${o.id}`,
    });
    if (created) notified++;
  }
  return { notified };
}

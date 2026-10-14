import "server-only";
import type { InvoiceKind, Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { loadTaxSettings, storeCollectsTax, TAX_STORE_SELECT } from "./settings";
import { parseTaxRegistration } from "./registration";
import { buildCreditNoteSnapshot, buildInvoiceSnapshot, creditNoteTaxes, formatInvoiceNumber, parseInvoiceSnapshot, yearInTimeZone, type InvoiceSnapshot } from "./snapshot";

/**
 * Émission des factures et avoirs (spécification lot 2, §2 et §8).
 *
 * Invariants :
 *  - numérotation séquentielle SANS TROU par boutique et par type : le compteur (Store.invoiceCounter /
 *    creditNoteCounter) est incrémenté sous verrou de ligne DANS la transaction qui crée le document ;
 *    un échec annule l'incrément (aucun numéro consommé sans document) ; unicité (storeId, number) en base ;
 *  - une seule facture par commande, un seul avoir par remboursement : vérifiés sous le verrou de la commande ;
 *  - ordre des verrous : Order puis Store (le même que requestRefund, qui verrouille déjà Order) : pas d'interblocage ;
 *  - documents immuables : ce module n'expose ni mise à jour ni suppression d'OrderInvoice.
 */

export class InvoiceError extends Error {}

const INVOICEABLE_PAYMENT = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);

export type IssuedDocument = { id: string; number: string; kind: InvoiceKind; created: boolean };

async function lockOrder(tx: Tx, storeId: string, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} AND "storeId" = ${storeId} FOR UPDATE`;
}

/** Réserve le prochain numéro : verrou de la ligne Store puis incrément, dans la transaction appelante. */
export async function nextDocumentNumber(tx: Tx, storeId: string, kind: InvoiceKind, issuedAt: Date): Promise<string> {
  await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
  const s = await tx.store.update({
    where: { id: storeId },
    data: kind === "INVOICE" ? { invoiceCounter: { increment: 1 } } : { creditNoteCounter: { increment: 1 } },
    select: { invoiceCounter: true, creditNoteCounter: true, timezone: true },
  });
  const n = kind === "INVOICE" ? s.invoiceCounter : s.creditNoteCounter;
  return formatInvoiceNumber(kind, yearInTimeZone(issuedAt, s.timezone || "Africa/Porto-Novo"), n);
}

/** Émet la facture d'une commande payée (idempotent : renvoie la facture existante). À appeler dans une transaction. */
export async function issueInvoiceTx(tx: Tx, p: { storeId: string; orderId: string; actorId?: string | null; now?: Date }): Promise<IssuedDocument> {
  await lockOrder(tx, p.storeId, p.orderId);
  const existing = await tx.orderInvoice.findFirst({ where: { storeId: p.storeId, orderId: p.orderId, kind: "INVOICE" }, select: { id: true, number: true } });
  if (existing) return { ...existing, kind: "INVOICE", created: false };

  const order = await tx.order.findFirst({
    where: { id: p.orderId, storeId: p.storeId },
    include: { items: { orderBy: { id: "asc" }, include: { product: { select: { taxable: true, taxCategory: true } } } } },
  });
  if (!order) throw new InvoiceError("Commande introuvable");
  if (!INVOICEABLE_PAYMENT.has(order.paymentStatus)) throw new InvoiceError("Seule une commande payée peut être facturée.");

  const store = await tx.store.findUnique({
    where: { id: p.storeId },
    select: { name: true, address: true, city: true, contactPhone: true, contactEmail: true, taxesEnabled: true, taxRegistration: true },
  });
  if (!store) throw new InvoiceError("Boutique introuvable");
  const settings = await loadTaxSettings(p.storeId, tx);
  const issuedAt = p.now ?? new Date();
  const number = await nextDocumentNumber(tx, p.storeId, "INVOICE", issuedAt);
  const snapshot = buildInvoiceSnapshot({ number, issuedAt, order, store, registration: parseTaxRegistration(store.taxRegistration), settings });

  const created = await tx.orderInvoice.create({
    data: {
      storeId: p.storeId,
      orderId: order.id,
      kind: "INVOICE",
      number,
      amount: snapshot.totals.inclTax,
      taxTotal: snapshot.totals.tax,
      currency: order.currency,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      issuedAt,
      issuedById: p.actorId ?? null,
    },
    select: { id: true, number: true },
  });
  await tx.orderEvent.create({ data: { orderId: order.id, actorId: p.actorId ?? null, actorLabel: p.actorId ? "Équipe" : "Système", type: "note", message: `Facture ${number} émise` } });
  await audit({ storeId: p.storeId, actorId: p.actorId ?? null, action: "invoice.issued", target: order.id, metadata: { invoiceId: created.id, number, amount: snapshot.totals.inclTax, taxTotal: snapshot.totals.tax } }, tx);

  // Remboursements antérieurs à la facture : avoirs émis dans la même transaction.
  await issueMissingCreditNotesTx(tx, { storeId: p.storeId, orderId: order.id, actorId: p.actorId ?? null, now: issuedAt });
  return { ...created, kind: "INVOICE", created: true };
}

/**
 * Avoir fiscal d'un remboursement (idempotent par remboursement). Aucun avoir si la commande n'a pas de facture :
 * renvoie null. À appeler dans une transaction (y compris celle de requestRefund, voir la doc de l'équipe).
 */
export async function issueCreditNoteForRefundTx(tx: Tx, p: { storeId: string; refundId: string; actorId?: string | null; now?: Date }): Promise<IssuedDocument | null> {
  const refund = await tx.refund.findUnique({ where: { id: p.refundId }, select: { id: true, orderId: true, amount: true, reason: true, status: true } });
  if (!refund) throw new InvoiceError("Remboursement introuvable");
  const owner = await tx.order.findFirst({ where: { id: refund.orderId, storeId: p.storeId }, select: { id: true } });
  if (!owner) throw new InvoiceError("Remboursement introuvable");
  if (refund.status !== "DONE") return null;

  await lockOrder(tx, p.storeId, refund.orderId);
  const existing = await tx.orderInvoice.findFirst({ where: { storeId: p.storeId, orderId: refund.orderId, kind: "CREDIT_NOTE", refundId: refund.id }, select: { id: true, number: true } });
  if (existing) return { ...existing, kind: "CREDIT_NOTE", created: false };

  const invoice = await tx.orderInvoice.findFirst({ where: { storeId: p.storeId, orderId: refund.orderId, kind: "INVOICE" } });
  if (!invoice) return null;
  const invSnap = parseInvoiceSnapshot(invoice.snapshot);
  if (!invSnap) throw new InvoiceError("Facture illisible");

  const previousRows = await tx.orderInvoice.findMany({ where: { storeId: p.storeId, orderId: refund.orderId, kind: "CREDIT_NOTE" }, select: { amount: true, snapshot: true } });
  const previous = previousRows.map((r) => ({ amount: r.amount, taxLines: parseInvoiceSnapshot(r.snapshot)?.taxLines ?? [] }));
  const taxes = creditNoteTaxes({ invoiceTotal: invoice.amount, invoiceTaxLines: invSnap.taxLines, refundAmount: refund.amount, previous });

  const issuedAt = p.now ?? new Date();
  const number = await nextDocumentNumber(tx, p.storeId, "CREDIT_NOTE", issuedAt);
  const snapshot = buildCreditNoteSnapshot({ number, issuedAt, invoice: { id: invoice.id, number: invoice.number, snapshot: invSnap }, refund: { id: refund.id, amount: refund.amount, reason: refund.reason }, taxes });
  const created = await tx.orderInvoice.create({
    data: {
      storeId: p.storeId,
      orderId: refund.orderId,
      kind: "CREDIT_NOTE",
      number,
      amount: refund.amount,
      taxTotal: taxes.tax,
      currency: invoice.currency,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      refundId: refund.id,
      issuedAt,
      issuedById: p.actorId ?? null,
    },
    select: { id: true, number: true },
  });
  await audit({ storeId: p.storeId, actorId: p.actorId ?? null, action: "invoice.credit_note_issued", target: refund.orderId, metadata: { invoiceId: created.id, number, refundId: refund.id, amount: refund.amount, taxTotal: taxes.tax } }, tx);
  return { ...created, kind: "CREDIT_NOTE", created: true };
}

/** Avoirs manquants (remboursements DONE sans avoir) d'une commande facturée, dans l'ordre chronologique. */
export async function issueMissingCreditNotesTx(tx: Tx, p: { storeId: string; orderId: string; actorId?: string | null; now?: Date }): Promise<IssuedDocument[]> {
  const order = await tx.order.findFirst({ where: { id: p.orderId, storeId: p.storeId }, select: { id: true } });
  if (!order) return [];
  // Requêtes séquentielles : une transaction interactive Prisma n'utilise qu'une connexion.
  const refunds = await tx.refund.findMany({ where: { orderId: p.orderId, status: "DONE" }, select: { id: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  const notes = await tx.orderInvoice.findMany({ where: { storeId: p.storeId, orderId: p.orderId, kind: "CREDIT_NOTE" }, select: { refundId: true } });
  const done = new Set(notes.map((n) => n.refundId));
  const out: IssuedDocument[] = [];
  for (const r of [...refunds].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (done.has(r.id)) continue;
    const doc = await issueCreditNoteForRefundTx(tx, { storeId: p.storeId, refundId: r.id, actorId: p.actorId, now: p.now });
    if (doc) out.push(doc);
  }
  return out;
}

/**
 * Les émissions d'une même boutique se sérialisent sur le verrou de la ligne Store : en rafale, elles attendent
 * une connexion du pool. maxWait relevé (défaut Prisma : 2 s) pour attendre plutôt qu'échouer.
 */
const TX_OPTS = { maxWait: 10_000, timeout: 15_000 };

export function issueInvoice(p: { storeId: string; orderId: string; actorId?: string | null }) {
  return db.$transaction((tx) => issueInvoiceTx(tx, p), TX_OPTS);
}

export function issueCreditNote(p: { storeId: string; refundId: string; actorId?: string | null }) {
  return db.$transaction((tx) => issueCreditNoteForRefundTx(tx, p), TX_OPTS);
}

export function issueMissingCreditNotes(p: { storeId: string; orderId: string; actorId?: string | null }) {
  return db.$transaction((tx) => issueMissingCreditNotesTx(tx, p), TX_OPTS);
}

/**
 * Émission automatique au passage PAID (job `payment.succeeded`). Exige une ACTIVATION EXPLICITE : sans
 * identité fiscale enregistrée, `autoIssueInvoices` vaut `false` (voir `parseTaxRegistration`) et aucune
 * facture immuable n'est émise à l'insu du commerçant ; l'écran /parametres/taxes pose `true` à la première
 * configuration. Sans effet non plus si le plan n'inclut pas les factures, si la boutique ne collecte pas la
 * taxe (taxes désactivées, régime TPS ou plan sans `taxes`) ou si la commande n'est plus payée.
 * L'émission MANUELLE (bouton « Émettre la facture ») reste disponible dans tous ces cas.
 */
export async function autoIssueInvoiceForOrder(orderId: string): Promise<IssuedDocument | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, storeId: true, paymentStatus: true, store: { select: TAX_STORE_SELECT } },
  });
  if (!order || !INVOICEABLE_PAYMENT.has(order.paymentStatus)) return null;
  if (!PLANS[effectivePlanId(order.store.subscription)].features.invoices) return null;
  if (!storeCollectsTax(order.store)) return null;
  if (!parseTaxRegistration(order.store.taxRegistration).autoIssueInvoices) return null;
  return issueInvoice({ storeId: order.storeId, orderId: order.id, actorId: null });
}

export type InvoiceRow = { id: string; kind: InvoiceKind; number: string; amount: number; taxTotal: number; currency: string; issuedAt: Date; refundId: string | null; snapshot: InvoiceSnapshot };

function toRows(rows: { id: string; kind: InvoiceKind; number: string; amount: number; taxTotal: number; currency: string; issuedAt: Date; refundId: string | null; snapshot: unknown }[]): InvoiceRow[] {
  return rows.flatMap((r) => {
    const snapshot = parseInvoiceSnapshot(r.snapshot);
    return snapshot ? [{ ...r, snapshot }] : [];
  });
}

const ROW_SELECT = { id: true, kind: true, number: true, amount: true, taxTotal: true, currency: true, issuedAt: true, refundId: true, snapshot: true } as const;

/** Documents d'une commande, filtrés par boutique (l'appelant a vérifié l'appartenance du membre). */
export async function listOrderDocuments(storeId: string, orderId: string): Promise<InvoiceRow[]> {
  const rows = await db.orderInvoice.findMany({ where: { storeId, orderId }, select: ROW_SELECT, orderBy: { issuedAt: "asc" } });
  return toRows(rows).sort((a, b) => (a.kind === b.kind ? a.issuedAt.getTime() - b.issuedAt.getTime() : a.kind === "INVOICE" ? -1 : 1));
}

/** Accès acheteur par jeton de suivi (même règle que la page de suivi : jeton valide et non expiré). */
export async function documentsForTrackingToken(token: string): Promise<{ status: "not_found" | "expired" } | { status: "ok"; storeName: string; reference: string; documents: InvoiceRow[] }> {
  if (!/^[0-9a-f]{16,128}$/.test(token)) return { status: "not_found" };
  const order = await db.order.findUnique({ where: { trackingToken: token }, select: { id: true, storeId: true, reference: true, trackingExpiresAt: true, store: { select: { name: true } } } });
  if (!order) return { status: "not_found" };
  if (order.trackingExpiresAt.getTime() < Date.now()) return { status: "expired" };
  return { status: "ok", storeName: order.store.name, reference: order.reference, documents: await listOrderDocuments(order.storeId, order.id) };
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Factures et avoirs (lot 2, §2 et §8) : numérotation séquentielle sans trou sous verrou, concurrence,
 * avoirs, immutabilité, accès par jeton de suivi, isolation entre boutiques et contrôle de plan.
 *
 * La base factice est enveloppée : chaque transaction reçoit son propre `tx` dont les `SELECT … FOR UPDATE`
 * prennent un verrou exclusif (file d'attente par ligne) libéré à la fin de la transaction, et une transaction
 * seule en cours est annulée (restauration des tables) si elle échoue. Cela reproduit la sémantique Postgres
 * utile ici ; la vérification sur la vraie base est décrite dans docs/vague2/T-taxes-factures.md.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({
  fake: null as any,
  wrapped: null as any,
  locking: true,
  member: "store_AAAAAAAA" as string,
  planId: "BUSINESS" as string,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.wrapped;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireStore: vi.fn(async (storeId: string) => {
      if (storeId !== state.member) throw new AuthError("Boutique introuvable ou accès refusé");
      const store = state.fake.tables.store.find((s: any) => s.id === storeId);
      return { user: { id: "user_A" }, store, role: "OWNER", planId: state.planId, can: () => true };
    }),
  };
});

import { issueInvoice, issueCreditNote, listOrderDocuments, documentsForTrackingToken, autoIssueInvoiceForOrder, InvoiceError } from "@/lib/tax/invoice";
import { issueInvoiceAction, upsertTaxRate, deleteTaxRate, updateProductTax, updateTaxSettings, issueMissingCreditNotesAction } from "@/lib/tax/actions";
import { yearInTimeZone } from "@/lib/tax/snapshot";

const A = "store_AAAAAAAA";
const B = "store_BBBBBBBB";
const Y = yearInTimeZone(new Date(), "Africa/Porto-Novo");
const F = (n: number) => `F-${Y}-${String(n).padStart(6, "0")}`;
const AV = (n: number) => `A-${Y}-${String(n).padStart(6, "0")}`;

/** Enveloppe transactionnelle avec verrous de ligne et annulation (voir en-tête). */
function withLocks(fake: any) {
  const queues = new Map<string, Promise<void>>();
  let active = 0;
  return new Proxy(fake.db, {
    get(target: any, prop: string) {
      if (prop !== "$transaction") return target[prop];
      return async (fn: (tx: any) => Promise<unknown>) => {
        const releases: (() => void)[] = [];
        const held = new Set<string>();
        const backup = active === 0 ? structuredClone(fake.tables) : null;
        active++;
        const tx = new Proxy(target, {
          get(t: any, p: string) {
            if (p !== "$queryRaw") return t[p];
            return async (sql: TemplateStringsArray, ...values: unknown[]) => {
              const text = sql.join("?");
              if (state.locking && /FOR UPDATE/.test(text)) {
                const key = `${/"Store"/.test(text) ? "store" : "order"}:${String(values[0])}`;
                if (!held.has(key)) {
                  const prev = queues.get(key) ?? Promise.resolve();
                  let release!: () => void;
                  const mine = new Promise<void>((r) => (release = r));
                  queues.set(key, prev.then(() => mine));
                  await prev;
                  held.add(key);
                  releases.push(release);
                }
              }
              return [];
            };
          },
        });
        try {
          return await fn(tx);
        } catch (e) {
          if (backup && active === 1) {
            for (const k of Object.keys(fake.tables)) delete fake.tables[k];
            Object.assign(fake.tables, backup);
          }
          throw e;
        } finally {
          active--;
          releases.forEach((r) => r());
        }
      };
    },
  });
}

const future = new Date(Date.now() + 30 * 86_400_000);
const reg = { legalName: "Boutique A SARL", taxId: "IFU 3201", rccm: "RB/COT/26", address: "Cotonou", regime: "TVA", exemptionMention: "", autoIssueInvoices: true };

function paidOrder(id: string, storeId = A, extra: Record<string, unknown> = {}) {
  return {
    id, storeId, reference: `AX-${id.slice(-6).toUpperCase()}`, trackingToken: `${id.replace(/[^a-f0-9]/g, "").padEnd(16, "a")}${"0".repeat(16)}`.slice(0, 32), trackingExpiresAt: future,
    status: "CONFIRMED", paymentStatus: "PAID", fulfillmentType: "DELIVERY", createdAt: new Date(), currency: "XOF",
    subtotal: 11_800, discount: 0, deliveryFee: 0, total: 11_800, deliveryZoneName: null, deliveryAddress: "Akpakpa",
    customerName: "Awa", customerPhone: "22997000000", customerEmail: null, buyerCompany: null, buyerTaxId: null,
    paymentMethodLabel: "MTN MoMo", paymentReference: null, giftCardAmount: 0, storeCreditAmount: 0,
    taxTotal: 0, taxesIncluded: true, taxLines: null, ...extra,
  };
}

function seed(orders = 20) {
  const orderRows = [...Array.from({ length: orders }, (_, i) => paidOrder(`order_a${String(i + 1).padStart(3, "0")}`)), paidOrder("order_b001", B), paidOrder("order_unpaid", A, { paymentStatus: "UNPAID" })];
  state.fake = createFakeDb({
    store: [
      { id: A, name: "Boutique A", country: "BJ", timezone: "Africa/Porto-Novo", address: "Rue 1", city: "Cotonou", contactPhone: null, contactEmail: null, taxesEnabled: true, pricesIncludeTax: true, taxRegistration: reg, invoiceCounter: 0, creditNoteCounter: 0 },
      { id: B, name: "Boutique B", country: "SN", timezone: "Africa/Dakar", address: null, city: null, contactPhone: null, contactEmail: null, taxesEnabled: false, pricesIncludeTax: true, taxRegistration: null, invoiceCounter: 0, creditNoteCounter: 0 },
    ],
    subscription: [{ id: "sub_A", storeId: A, planId: "BUSINESS", status: "ACTIVE", currentPeriodEnd: future, trialEndsAt: null }],
    taxRate: [
      { id: "rate_A_std", storeId: A, name: "TVA", country: "BJ", regionKey: "*", taxCategory: "standard", rateBps: 1800, appliesToShipping: true, active: true },
      { id: "rate_B_std", storeId: B, name: "TVA", country: "SN", regionKey: "*", taxCategory: "standard", rateBps: 1800, appliesToShipping: true, active: true },
    ],
    product: [
      { id: "prod_A_1", storeId: A, name: "Sac", taxable: true, taxCategory: "standard" },
      { id: "prod_B_1", storeId: B, name: "Pagne", taxable: true, taxCategory: "standard" },
    ],
    order: orderRows,
    orderItem: orderRows.map((o, i) => ({ id: `item_${String(i).padStart(4, "0")}`, orderId: o.id, productId: o.storeId === A ? "prod_A_1" : "prod_B_1", name: "Sac", variantName: null, quantity: 1, unitPrice: 11_800, lineTotal: 11_800, discountAllocated: 0, isGiftCard: false, taxAmount: 0, taxRateBps: null })),
    orderInvoice: [],
    orderEvent: [],
    refund: [],
  });
  state.wrapped = withLocks(state.fake);
}

const tables = () => state.fake.tables;
const storeRow = (id: string) => tables().store.find((s: any) => s.id === id);
const invoicesOf = (orderId: string) => tables().orderInvoice.filter((i: any) => i.orderId === orderId);
const addRefund = (id: string, orderId: string, amount: number, at = new Date()) => tables().refund.push({ id, orderId, amount, reason: "Article abîmé", status: "DONE", createdAt: at });
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  state.locking = true;
  state.member = A;
  state.planId = "BUSINESS";
  seed();
});

describe("numérotation des factures", () => {
  it("séquentielle par boutique : F-AAAA-000001, 000002…", async () => {
    const a = await issueInvoice({ storeId: A, orderId: "order_a001" });
    const b = await issueInvoice({ storeId: A, orderId: "order_a002" });
    expect([a.number, b.number]).toEqual([F(1), F(2)]);
    expect(storeRow(A).invoiceCounter).toBe(2);
    const inv = invoicesOf("order_a001")[0];
    expect(inv).toMatchObject({ kind: "INVOICE", amount: 11_800, taxTotal: 1_800, currency: "XOF" });
    expect(inv.snapshot.taxLines).toEqual([{ name: "TVA", rateBps: 1800, base: 10_000, amount: 1_800 }]);
  });

  it("concurrence : 20 émissions simultanées → 1..20 sans trou ni doublon", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `order_a${String(i + 1).padStart(3, "0")}`);
    const docs = await Promise.all(ids.map((orderId) => issueInvoice({ storeId: A, orderId })));
    const numbers = docs.map((d) => d.number).sort();
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => F(i + 1)));
    expect(new Set(tables().orderInvoice.map((i: any) => i.number)).size).toBe(20);
    expect(storeRow(A).invoiceCounter).toBe(20);
  });

  it("concurrence sur la même commande : une seule facture, un seul numéro consommé", async () => {
    const docs = await Promise.all(Array.from({ length: 10 }, () => issueInvoice({ storeId: A, orderId: "order_a001" })));
    expect(new Set(docs.map((d) => d.number))).toEqual(new Set([F(1)]));
    expect(docs.filter((d) => d.created)).toHaveLength(1);
    expect(invoicesOf("order_a001")).toHaveLength(1);
    expect(storeRow(A).invoiceCounter).toBe(1);
  });

  it("contrôle : sans verrou, le même scénario produit des doublons (le test détecte bien la course)", async () => {
    state.locking = false;
    await Promise.all(Array.from({ length: 5 }, () => issueInvoice({ storeId: A, orderId: "order_a001" })));
    expect(invoicesOf("order_a001").length).toBeGreaterThan(1);
  });

  it("échec : aucun numéro consommé (commande impayée, ou erreur après l'incrément)", async () => {
    await expect(issueInvoice({ storeId: A, orderId: "order_unpaid" })).rejects.toBeInstanceOf(InvoiceError);
    expect(storeRow(A).invoiceCounter).toBe(0);

    const model = state.fake.db.orderInvoice;
    const original = model.create;
    model.create = async () => {
      throw new Error("panne d'écriture");
    };
    await expect(issueInvoice({ storeId: A, orderId: "order_a001" })).rejects.toThrow("panne");
    model.create = original;
    expect(storeRow(A).invoiceCounter).toBe(0);
    expect((await issueInvoice({ storeId: A, orderId: "order_a001" })).number).toBe(F(1));
  });

  it("compteurs indépendants entre boutiques", async () => {
    await issueInvoice({ storeId: A, orderId: "order_a001" });
    const b = await issueInvoice({ storeId: B, orderId: "order_b001" });
    expect(b.number).toBe(F(1));
    expect(storeRow(B).invoiceCounter).toBe(1);
    // Boutique B : taxes désactivées → aucune TVA, mention d'exonération.
    const snap = invoicesOf("order_b001")[0].snapshot;
    expect(snap.totals.tax).toBe(0);
    expect(snap.mentions).toContain("TVA non applicable");
  });
});

describe("avoirs", () => {
  it("un avoir par remboursement, compteur A distinct, idempotent", async () => {
    await issueInvoice({ storeId: A, orderId: "order_a001" });
    addRefund("refund_0001", "order_a001", 5_900);
    const c1 = await issueCreditNote({ storeId: A, refundId: "refund_0001" });
    const again = await issueCreditNote({ storeId: A, refundId: "refund_0001" });
    expect(c1?.number).toBe(AV(1));
    expect(again).toMatchObject({ number: AV(1), created: false });
    expect(storeRow(A).creditNoteCounter).toBe(1);
    expect(storeRow(A).invoiceCounter).toBe(1);
    const note = invoicesOf("order_a001").find((i: any) => i.kind === "CREDIT_NOTE");
    expect(note).toMatchObject({ amount: 5_900, taxTotal: 900, refundId: "refund_0001" });
    expect(note.snapshot.creditNote.invoiceNumber).toBe(F(1));
  });

  it("remboursements partiels jusqu'au total : Σ TVA des avoirs = TVA de la facture", async () => {
    await issueInvoice({ storeId: A, orderId: "order_a001" });
    addRefund("refund_0001", "order_a001", 3_000);
    addRefund("refund_0002", "order_a001", 8_800);
    await issueCreditNote({ storeId: A, refundId: "refund_0001" });
    await issueCreditNote({ storeId: A, refundId: "refund_0002" });
    const notes = invoicesOf("order_a001").filter((i: any) => i.kind === "CREDIT_NOTE");
    expect(notes.reduce((s: number, n: any) => s + n.taxTotal, 0)).toBe(1_800);
    expect(notes.map((n: any) => n.number).sort()).toEqual([AV(1), AV(2)]);
  });

  it("avoirs concurrents sur deux remboursements : A1 et A2, sans trou", async () => {
    await issueInvoice({ storeId: A, orderId: "order_a001" });
    addRefund("refund_0001", "order_a001", 1_000);
    addRefund("refund_0002", "order_a001", 1_000);
    const docs = await Promise.all([issueCreditNote({ storeId: A, refundId: "refund_0001" }), issueCreditNote({ storeId: A, refundId: "refund_0002" })]);
    expect(docs.map((d) => d?.number).sort()).toEqual([AV(1), AV(2)]);
  });

  it("pas de facture : pas d'avoir et aucun numéro consommé ; la facture émise ensuite régularise les avoirs", async () => {
    addRefund("refund_0001", "order_a001", 1_000, new Date(Date.now() - 2000));
    addRefund("refund_0002", "order_a001", 2_000, new Date(Date.now() - 1000));
    expect(await issueCreditNote({ storeId: A, refundId: "refund_0001" })).toBeNull();
    expect(storeRow(A).creditNoteCounter).toBe(0);
    await issueInvoice({ storeId: A, orderId: "order_a001" });
    const notes = invoicesOf("order_a001").filter((i: any) => i.kind === "CREDIT_NOTE");
    expect(notes.map((n: any) => [n.refundId, n.number])).toEqual([
      ["refund_0001", AV(1)],
      ["refund_0002", AV(2)],
    ]);
  });

  it("isolation : un remboursement de A ne peut pas produire d'avoir dans B", async () => {
    await issueInvoice({ storeId: A, orderId: "order_a001" });
    addRefund("refund_0001", "order_a001", 1_000);
    await expect(issueCreditNote({ storeId: B, refundId: "refund_0001" })).rejects.toBeInstanceOf(InvoiceError);
    expect(storeRow(B).creditNoteCounter).toBe(0);
  });
});

describe("immutabilité", () => {
  it("l'instantané ne bouge pas quand la boutique, le taux ou la commande changent", async () => {
    await issueInvoice({ storeId: A, orderId: "order_a001" });
    const before = structuredClone((await listOrderDocuments(A, "order_a001"))[0].snapshot);
    Object.assign(storeRow(A), { name: "Nouveau nom", taxRegistration: { ...reg, taxId: "AUTRE" } });
    tables().taxRate[0].rateBps = 2000;
    Object.assign(tables().order.find((o: any) => o.id === "order_a001"), { customerName: "Modifié", total: 1 });
    const after = (await listOrderDocuments(A, "order_a001"))[0].snapshot;
    expect(after).toEqual(before);
    expect(after.seller).toMatchObject({ name: "Boutique A", taxId: "IFU 3201" });
    // Ré-émission : renvoie la facture existante, sans la recalculer.
    expect(await issueInvoice({ storeId: A, orderId: "order_a001" })).toMatchObject({ number: F(1), created: false });
  });

  it("aucun chemin de code ne modifie ni ne supprime un OrderInvoice", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && /orderInvoice\.(update|updateMany|upsert|delete|deleteMany)\b/.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    walk(join(__dirname, "..", "src"));
    expect(offenders).toEqual([]);
  }, 60_000);
});

describe("accès aux factures", () => {
  it("jeton de suivi : format invalide, inconnu, expiré, valide", async () => {
    await issueInvoice({ storeId: A, orderId: "order_a001" });
    await issueInvoice({ storeId: A, orderId: "order_a002" });
    const o1 = tables().order.find((o: any) => o.id === "order_a001");
    expect(await documentsForTrackingToken("../etc")).toEqual({ status: "not_found" });
    expect(await documentsForTrackingToken("f".repeat(32))).toEqual({ status: "not_found" });
    const ok = await documentsForTrackingToken(o1.trackingToken);
    expect(ok.status).toBe("ok");
    if (ok.status === "ok") expect(ok.documents.map((d) => d.number)).toEqual([F(1)]);
    o1.trackingExpiresAt = new Date(Date.now() - 1000);
    expect(await documentsForTrackingToken(o1.trackingToken)).toEqual({ status: "expired" });
  });

  it("isolation : les documents d'une commande de A ne sont jamais listés pour B", async () => {
    await issueInvoice({ storeId: A, orderId: "order_a001" });
    expect(await listOrderDocuments(B, "order_a001")).toEqual([]);
    await expect(issueInvoice({ storeId: B, orderId: "order_a002" })).rejects.toBeInstanceOf(InvoiceError);
    expect(storeRow(B).invoiceCounter).toBe(0);
  });
});

describe("actions : isolation, rôles et plan", () => {
  it("émission manuelle : membre de A seulement, commande de A seulement, plan avec factures", async () => {
    expect(await issueInvoiceAction(B, "order_b001")).toMatchObject({ ok: false });
    expect(await issueInvoiceAction(A, "order_b001")).toMatchObject({ ok: false, error: "Commande introuvable" });
    state.planId = "FREE";
    expect(await issueInvoiceAction(A, "order_a001")).toMatchObject({ ok: false });
    state.planId = "BUSINESS";
    expect(await issueInvoiceAction(A, "order_a001")).toMatchObject({ ok: true, data: { number: F(1) } });
    expect(await issueMissingCreditNotesAction(A, "order_b001")).toMatchObject({ ok: true, data: { count: 0 } });
    expect(storeRow(B).creditNoteCounter).toBe(0);
  });

  it("taux : un id de B est introuvable depuis A ; suppression croisée refusée", async () => {
    const r = await upsertTaxRate(undefined, fd({ storeId: A, rateId: "rate_B_std", name: "TVA", country: "SN", taxCategory: "standard", rate: "5", appliesToShipping: "on", active: "on" }));
    expect(r).toMatchObject({ ok: false, error: "Taux introuvable" });
    expect(tables().taxRate.find((x: any) => x.id === "rate_B_std").rateBps).toBe(1800);
    expect(await deleteTaxRate(A, "rate_B_std")).toMatchObject({ ok: false });
    expect(tables().taxRate.some((x: any) => x.id === "rate_B_std")).toBe(true);
  });

  it("taux : saisie « 19,25 » → 1925 points de base ; plan sans taxes refusé", async () => {
    const ok = await upsertTaxRate(undefined, fd({ storeId: A, rateId: "rate_A_std", name: "TVA", country: "bj", taxCategory: "standard", rate: "19,25", appliesToShipping: "on", active: "on" }));
    expect(ok).toMatchObject({ ok: true });
    expect(tables().taxRate.find((x: any) => x.id === "rate_A_std")).toMatchObject({ rateBps: 1925, country: "BJ" });
    state.planId = "FREE";
    expect(await upsertTaxRate(undefined, fd({ storeId: A, name: "TVA", country: "BJ", taxCategory: "reduced", rate: "10" }))).toMatchObject({ ok: false });
  });

  it("produit : champs fiscaux limités à la boutique du membre", async () => {
    expect(await updateProductTax(A, "prod_B_1", { taxable: false, taxCategory: "exempt" })).toMatchObject({ ok: false });
    expect(tables().product.find((p: any) => p.id === "prod_B_1")).toMatchObject({ taxable: true, taxCategory: "standard" });
    expect(await updateProductTax(A, "prod_A_1", { taxable: true, taxCategory: "reduced" })).toMatchObject({ ok: true });
    expect(await updateProductTax(A, "prod_A_1", { taxable: true, taxCategory: "luxe" })).toMatchObject({ ok: false });
  });

  it("réglages : TVA sans numéro fiscal refusée ; plan sans taxes ne peut pas les activer", async () => {
    const base = { storeId: A, pricesIncludeTax: "true", regime: "TVA", legalName: "", rccm: "", address: "", exemptionMention: "" };
    Object.assign(storeRow(A), { taxesEnabled: false });
    expect(await updateTaxSettings(undefined, fd({ ...base, taxesEnabled: "on", taxId: "" }))).toMatchObject({ ok: false });
    state.planId = "FREE";
    expect(await updateTaxSettings(undefined, fd({ ...base, taxesEnabled: "on", taxId: "IFU 1" }))).toMatchObject({ ok: false });
    state.planId = "BUSINESS";
    expect(await updateTaxSettings(undefined, fd({ ...base, taxesEnabled: "on", taxId: "IFU 1", autoIssueInvoices: "on" }))).toMatchObject({ ok: true });
    expect(storeRow(A)).toMatchObject({ taxesEnabled: true, pricesIncludeTax: true });
    expect(storeRow(A).taxRegistration).toMatchObject({ taxId: "IFU 1", autoIssueInvoices: true });
    state.member = B;
    expect(await updateTaxSettings(undefined, fd({ ...base, storeId: A, taxesEnabled: "on", taxId: "X" }))).toMatchObject({ ok: false });
  });
});

describe("émission automatique au passage PAID", () => {
  it("émet si le plan inclut les factures et que l'option est active ; sinon rien", async () => {
    expect((await autoIssueInvoiceForOrder("order_a001"))?.number).toBe(F(1));
    expect(await autoIssueInvoiceForOrder("order_b001")).toBeNull(); // B : plan gratuit
    expect(await autoIssueInvoiceForOrder("order_unpaid")).toBeNull();
    storeRow(A).taxRegistration = { ...reg, autoIssueInvoices: false };
    expect(await autoIssueInvoiceForOrder("order_a002")).toBeNull();
    expect(storeRow(A).invoiceCounter).toBe(1);
  });

  // Une boutique Starter+ qui n'a JAMAIS ouvert /parametres/taxes ne doit pas se mettre à émettre des
  // documents immuables numérotés à chaque paiement : l'activation est explicite.
  it("aucune identité fiscale enregistrée : pas d'émission automatique (activation explicite)", async () => {
    storeRow(A).taxRegistration = null;
    expect(await autoIssueInvoiceForOrder("order_a001")).toBeNull();
    expect(storeRow(A).invoiceCounter).toBe(0);
    expect(tables().orderInvoice).toHaveLength(0);
  });

  it("boutique qui ne collecte pas la taxe (régime TPS, ou taxes désactivées) : pas d'émission automatique", async () => {
    storeRow(A).taxRegistration = { ...reg, regime: "TPS" };
    expect(await autoIssueInvoiceForOrder("order_a001")).toBeNull();
    storeRow(A).taxRegistration = reg;
    storeRow(A).taxesEnabled = false;
    expect(await autoIssueInvoiceForOrder("order_a002")).toBeNull();
    expect(storeRow(A).invoiceCounter).toBe(0);
    // L'émission MANUELLE reste possible (obligation d'émettre une facture, mention « TVA non applicable »).
    expect((await issueInvoice({ storeId: A, orderId: "order_a001", actorId: "user_A" })).number).toBe(F(1));
  });
});

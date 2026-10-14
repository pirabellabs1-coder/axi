import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac, createHash } from "node:crypto";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Webhooks des agrégateurs Wave / Orange Money (lot 1 bis) de bout en bout sur une base factice :
 * idempotence (ProviderEvent), isolation entre boutiques, bornage au fournisseur, contrôle du montant,
 * relecture du statut chez le fournisseur (fetch simulé).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const state = vi.hoisted(() => ({ fake: null as any }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})), queueNotification: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: (s: string) => `enc:${s}`, decryptSecret: (s: string) => s.replace(/^enc:/, "") }));

import { handleGatewayWebhook, initiateGatewayPayment, refundExternalAtGateway } from "@/lib/payments/service";
import { pawapay, pawapayDepositId } from "@/lib/payments/adapters/pawapay";

const A = "store_a";
const B = "store_b";
const SECRET_A = "sk_test_secret_store_a";
const SECRET_B = "sk_test_secret_store_b";
const DEPOSIT = "8917c345-4791-4285-a416-62f24b6982db";
const NOTIFY = "382a2329ae0647f896fa70283fa087cc";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function order(id: string, storeId: string, total = 5000) {
  return { id, storeId, reference: `AX-${id}`, total, amountDue: total, currency: "XOF", paymentStatus: "PENDING", status: "PENDING", customerName: "Awa Koné", customerPhone: "2250700000001", customerEmail: null };
}

function seed() {
  state.fake = createFakeDb({
    store: [
      { id: A, slug: "a", name: "Boutique A", country: "CI", currency: "XOF" },
      { id: B, slug: "b", name: "Boutique B", country: "CI", currency: "XOF" },
    ],
    order: [order("o_a", A), order("o_b", B), order("o_cp", A), order("o_pp", A)],
    paymentMethod: [
      { id: "pm_a", storeId: A, kind: "GATEWAY", provider: "paystack", channels: ["wave", "orange_money"], credentialsEncrypted: `enc:${JSON.stringify({ secretKey: SECRET_A })}` },
      { id: "pm_b", storeId: B, kind: "GATEWAY", provider: "paystack", channels: ["wave"], credentialsEncrypted: `enc:${JSON.stringify({ secretKey: SECRET_B })}` },
      { id: "pm_cp", storeId: A, kind: "GATEWAY", provider: "cinetpay", channels: ["wave"], credentialsEncrypted: `enc:${JSON.stringify({ apiKey: "sk_test_k", apiPassword: "pw", country: "CI" })}` },
      { id: "pm_pp", storeId: A, kind: "GATEWAY", provider: "pawapay", channels: ["wave"], credentialsEncrypted: `enc:${JSON.stringify({ apiToken: "tok", mode: "sandbox" })}` },
    ],
    paymentAttempt: [
      { id: "att_a", orderId: "o_a", paymentMethodId: "pm_a", provider: "paystack", providerRef: "att_a.aaaaaa", status: "INITIATED", amount: 5000, currency: "XOF", metadata: null, updatedAt: new Date() },
      { id: "att_b", orderId: "o_b", paymentMethodId: "pm_b", provider: "paystack", providerRef: "att_b.bbbbbb", status: "INITIATED", amount: 5000, currency: "XOF", metadata: null, updatedAt: new Date() },
      { id: "att_cp", orderId: "o_cp", paymentMethodId: "pm_cp", provider: "cinetpay", providerRef: "att_cp-1a2b", status: "INITIATED", amount: 5000, currency: "XOF", metadata: { notifyTokenHash: sha(NOTIFY) }, updatedAt: new Date() },
      { id: "att_pp", orderId: "o_pp", paymentMethodId: "pm_pp", provider: "pawapay", providerRef: DEPOSIT, status: "INITIATED", amount: 5000, currency: "XOF", metadata: null, updatedAt: new Date() },
    ],
    providerEvent: [],
    orderEvent: [],
    orderItem: [],
    membership: [],
    notification: [],
  });
  // Contrainte unique (provider, eventId) de ProviderEvent, comme en base.
  const pe = state.fake.db.providerEvent;
  const create = pe.create;
  pe.create = async (args: any) => {
    if (state.fake.tables.providerEvent.some((e: any) => e.provider === args.data.provider && e.eventId === args.data.eventId)) throw Object.assign(new Error("unique"), { code: "P2002" });
    return create(args);
  };
}

const t = (name: string) => state.fake.tables[name] as any[];
const attempt = (id: string) => t("paymentAttempt").find((x) => x.id === id);
const ord = (id: string) => t("order").find((x) => x.id === id);

function paystackEvent(reference: string, amountMinor = 500000, secret = SECRET_A) {
  const body = JSON.stringify({ event: "charge.success", data: { id: 42, status: "success", reference, amount: amountMinor, currency: "XOF" } });
  const sig = createHmac("sha512", secret).update(body).digest("hex");
  return { body, headers: new Headers({ "x-paystack-signature": sig, "content-type": "application/json" }) };
}

type Route = (url: string, init?: RequestInit) => { status?: number; json: unknown } | null;
let routes: Route[] = [];
const fetchMock = vi.fn(async (input: any, init?: RequestInit) => {
  const url = String(input);
  for (const r of routes) {
    const res = r(url, init);
    if (res) return new Response(JSON.stringify(res.json), { status: res.status ?? 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ status: false, message: "not mocked" }), { status: 404 });
});

beforeEach(() => {
  seed();
  routes = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Paystack : webhook signé", () => {
  it("confirme la tentative et la commande ; le rejeu est idempotent", async () => {
    // API verify injoignable : le corps signé fait foi.
    const e = paystackEvent("att_a.aaaaaa");
    const r1 = await handleGatewayWebhook("paystack", e.body, e.headers);
    expect(r1).toEqual({ status: 200, body: "ok" });
    expect(attempt("att_a").status).toBe("CONFIRMED");
    expect(ord("o_a").paymentStatus).toBe("PAID");
    const r2 = await handleGatewayWebhook("paystack", e.body, e.headers);
    expect(r2).toEqual({ status: 200, body: "duplicate" });
    expect(t("providerEvent").filter((x) => x.signatureValid)).toHaveLength(1);
    // m3 : projection de rapprochement, JAMAIS le corps brut du fournisseur (coordonnées, données de carte).
    const stored = t("providerEvent")[0];
    expect(stored.payload).toEqual({ event: stored.type, reference: "att_a.aaaaaa", status: "CONFIRMED", amount: 5000, currency: "XOF" });
    expect(Object.keys(stored.payload).sort()).toEqual(["amount", "currency", "event", "reference", "status"]); // ni `data`, ni corps brut
  });

  it("le statut relu via /transaction/verify prime sur le corps", async () => {
    routes.push((url) => (url.includes("/transaction/verify/") ? { json: { status: true, data: { status: "abandoned", amount: 500000, currency: "XOF" } } } : null));
    const e = paystackEvent("att_a.aaaaaa");
    await handleGatewayWebhook("paystack", e.body, e.headers);
    expect(attempt("att_a").status).toBe("INITIATED");
    expect(ord("o_a").paymentStatus).toBe("PENDING");
  });

  it("isolation : un événement signé avec la clé de la boutique B ne touche jamais la boutique A", async () => {
    const forged = paystackEvent("att_a.aaaaaa", 500000, SECRET_B);
    const r = await handleGatewayWebhook("paystack", forged.body, forged.headers);
    expect(r).toEqual({ status: 202, body: "accepted" }); // m9 : réponse neutre, motif dans ProviderEvent
    expect(attempt("att_a").status).toBe("INITIATED");
    expect(ord("o_a").paymentStatus).toBe("PENDING");
    expect(attempt("att_b").status).toBe("INITIATED");
    expect(t("providerEvent")[0]).toMatchObject({ signatureValid: false, paymentAttemptId: "att_a" });
  });

  it("chaque boutique est vérifiée avec SA clé : B confirmée, A inchangée", async () => {
    const e = paystackEvent("att_b.bbbbbb", 500000, SECRET_B);
    expect((await handleGatewayWebhook("paystack", e.body, e.headers)).status).toBe(200);
    expect(ord("o_b").paymentStatus).toBe("PAID");
    expect(ord("o_a").paymentStatus).toBe("PENDING");
  });

  it("montant falsifié : enregistré, jamais appliqué", async () => {
    const e = paystackEvent("att_a.aaaaaa", 100);
    expect(await handleGatewayWebhook("paystack", e.body, e.headers)).toEqual({ status: 200, body: "mismatch recorded" });
    expect(ord("o_a").paymentStatus).toBe("PENDING");
  });

  it("bornage au fournisseur : une référence Paystack envoyée sur l'URL CinetPay ne trouve rien", async () => {
    const e = paystackEvent("att_a.aaaaaa");
    const body = JSON.stringify({ merchant_transaction_id: "att_a.aaaaaa", transaction_id: "x", notify_token: "y" });
    // m9 : tentative inconnue et signature invalide donnent la MÊME réponse (aucun oracle d'existence).
    expect(await handleGatewayWebhook("cinetpay", body, e.headers)).toEqual({ status: 202, body: "accepted" });
    expect(ord("o_a").paymentStatus).toBe("PENDING");
  });
});

describe("CinetPay : notify_token puis statut canonique", () => {
  const notif = (token = NOTIFY) => JSON.stringify({ notify_token: token, merchant_transaction_id: "att_cp-1a2b", transaction_id: "cp_tx_1" });
  beforeEach(() => {
    routes.push((url) => (url.endsWith("/v1/oauth/login") ? { json: { code: 200, status: "OK", access_token: "jwt" } } : null));
  });

  it("jeton de notification invalide : refus neutre, aucun appel d'API", async () => {
    const r = await handleGatewayWebhook("cinetpay", notif("mauvais_jeton_0000000000000000000"), new Headers());
    expect(r).toEqual({ status: 202, body: "accepted" });
    // m3 : aucun corps non authentifié conservé (taille et empreinte seulement).
    const bad = t("providerEvent").at(-1);
    expect(bad).toMatchObject({ signatureValid: false });
    expect(Object.keys(bad.payload).sort()).toEqual(["sha256", "size"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ord("o_cp").paymentStatus).toBe("PENDING");
  });

  it("SUCCESS relu chez CinetPay avec le montant : commande payée", async () => {
    routes.push((url) => (url.includes("/v1/payment/att_cp-1a2b") ? { json: { code: 100, status: "SUCCESS", merchant_transaction_id: "att_cp-1a2b", transaction_id: "cp_tx_1", amount: "5000", currency: "XOF" } } : null));
    expect(await handleGatewayWebhook("cinetpay", notif(), new Headers())).toEqual({ status: 200, body: "ok" });
    expect(ord("o_cp").paymentStatus).toBe("PAID");
  });

  // m1 : sans montant dans la réponse d'API, le contrôle « montant reçu = montant attendu » serait tautologique
  // (un encaissement partiel passerait la commande en PAID). Le CONFIRMED n'est donc jamais appliqué.
  it("SUCCESS sans montant : jamais appliqué, trace conservée", async () => {
    routes.push((url) => (url.includes("/v1/payment/att_cp-1a2b") ? { json: { code: 100, status: "SUCCESS", merchant_transaction_id: "att_cp-1a2b", transaction_id: "cp_tx_1" } } : null));
    expect(await handleGatewayWebhook("cinetpay", notif(), new Headers())).toEqual({ status: 200, body: "missing amount recorded" });
    expect(ord("o_cp").paymentStatus).toBe("PENDING");
    expect(attempt("att_cp").status).toBe("INITIATED");
    expect(t("providerEvent").at(-1)).toMatchObject({ error: "confirmed without amount/currency" });
  });

  it("identifiants incohérents avec la notification : refus", async () => {
    routes.push((url) => (url.includes("/v1/payment/") ? { json: { code: 100, status: "SUCCESS", merchant_transaction_id: "att_cp-1a2b", transaction_id: "AUTRE" } } : null));
    expect(await handleGatewayWebhook("cinetpay", notif(), new Headers())).toEqual({ status: 202, body: "accepted" });
    expect(ord("o_cp").paymentStatus).toBe("PENDING");
  });
});

describe("pawaPay : le callback n'est qu'un déclencheur", () => {
  const callback = JSON.stringify({ depositId: DEPOSIT, status: "COMPLETED", amount: "999999" });

  it("statut et montant relus via GET /v2/deposits", async () => {
    routes.push((url) => (url.endsWith(`/v2/deposits/${DEPOSIT}`) ? { json: { status: "FOUND", data: { depositId: DEPOSIT, status: "COMPLETED", amount: "5000.00", currency: "XOF" } } } : null));
    expect(await handleGatewayWebhook("pawapay", callback, new Headers())).toEqual({ status: 200, body: "ok" });
    expect(ord("o_pp").paymentStatus).toBe("PAID");
    expect(fetchMock.mock.calls[0][0]).toContain("api.sandbox.pawapay.io");
  });

  it("callback « COMPLETED » mais dépôt en cours chez pawaPay : rien n'est confirmé", async () => {
    routes.push((url) => (url.includes("/v2/deposits/") ? { json: { status: "FOUND", data: { depositId: DEPOSIT, status: "PROCESSING", amount: "5000", currency: "XOF" } } } : null));
    await handleGatewayWebhook("pawapay", callback, new Headers());
    expect(ord("o_pp").paymentStatus).toBe("PENDING");
  });

  it("API injoignable : refus tracé, commande inchangée", async () => {
    expect(await handleGatewayWebhook("pawapay", callback, new Headers())).toEqual({ status: 202, body: "accepted" });
    expect(ord("o_pp").paymentStatus).toBe("PENDING");
  });
});

// M : `depositId` DÉTERMINISTE par tentative — sans cela, une initiation rejouée après un délai réseau crée un
// SECOND dépôt chez pawaPay (deux push USSD, client débité deux fois) au lieu de retomber sur DUPLICATE_IGNORED.
describe("pawaPay : identifiant de dépôt idempotent par tentative", () => {
  const creds = { apiToken: "tok", mode: "sandbox" } as any;
  const input = {
    attemptId: "att_pp", orderReference: "AX-1", amount: 5000, currency: "XOF",
    customer: { name: "Awa", phone: "22997000000", email: null },
    returnUrl: "http://localhost:3000/s/a/merci/t", cancelUrl: "http://localhost:3000/s/a", callbackUrl: "http://localhost:3000/api/webhooks/payments/pawapay",
    description: "Commande AX-1", country: "BJ", channels: ["mtn_momo"], channel: "mtn_momo", payerPhone: "22997000000",
  } as any;

  it("deux initiations de la même tentative envoient le même depositId", async () => {
    const sent: string[] = [];
    routes.push((url, init) => {
      if (!url.endsWith("/v2/deposits")) return null;
      sent.push(JSON.parse(String(init?.body)).depositId);
      return { json: { status: sent.length === 1 ? "ACCEPTED" : "DUPLICATE_IGNORED" } };
    });
    const r1 = await pawapay.initiate(input, creds);
    const r2 = await pawapay.initiate(input, creds);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(sent[1]);
    expect(sent[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Le doublon est accepté comme succès : aucune nouvelle demande de paiement n'est poussée au client.
    expect(r1).toMatchObject({ ok: true, providerRef: sent[0], pushed: true });
    expect(r2).toMatchObject({ ok: true, providerRef: sent[0] });
  });

  it("une autre tentative a un autre depositId (dérivé, non aléatoire)", () => {
    expect(pawapayDepositId("att_pp")).toBe(pawapayDepositId("att_pp"));
    expect(pawapayDepositId("att_pp")).not.toBe(pawapayDepositId("att_other"));
  });
});

const URLS = {
  returnUrl: "http://localhost:3000/s/b/merci/t",
  cancelUrl: "http://localhost:3000/s/b/merci/t?paiement=annule",
  callbackUrl: "http://localhost:3000/api/webhooks/payments/paystack",
};

describe("Initiation et remboursement", () => {
  it("Paystack : montant ×100, portefeuilles en mobile_money, référence propre à l'appel", async () => {
    t("paymentAttempt").push({ id: "att_new", orderId: "o_b", paymentMethodId: "pm_b", provider: "paystack", providerRef: null, status: "PENDING", amount: 5000, currency: "XOF", createdAt: new Date(Date.now() + 1000) });
    const loaded = async (args: any) => (args?.where?.storeId && args.where.storeId !== B ? null : { ...ord("o_b"), store: t("store")[1], paymentAttempts: [{ ...t("paymentAttempt").at(-1), paymentMethod: t("paymentMethod")[1] }] });
    state.fake.db.order.findFirst = loaded;
    state.fake.db.order.findUnique = loaded;
    let sent: any = null;
    routes.push((url, init) => {
      if (!url.endsWith("/transaction/initialize")) return null;
      sent = JSON.parse(String(init?.body));
      return { json: { status: true, data: { authorization_url: "https://checkout.paystack.com/abc", reference: sent.reference } } };
    });
    const r = await initiateGatewayPayment({ orderId: "o_b", storeId: B, ...URLS });
    expect(r).toMatchObject({ ok: true, redirectUrl: "https://checkout.paystack.com/abc" });
    expect(sent).toMatchObject({ amount: 500000, currency: "XOF", channels: ["mobile_money"] });
    expect(sent.reference).toMatch(/^att_new\.[0-9a-f]{6}$/);
    expect(attempt("att_new")).toMatchObject({ status: "INITIATED", providerRef: sent.reference });
  });

  // m7 : la commande doit appartenir à la boutique de l'appelant, et les trois URL venir de notre origine
  // (`callbackUrl` est transmise à certaines passerelles comme URL de notification).
  it("refus d'un orderId d'une autre boutique et d'une URL de rappel étrangère", async () => {
    t("paymentAttempt").push({ id: "att_new2", orderId: "o_b", paymentMethodId: "pm_b", provider: "paystack", providerRef: null, status: "PENDING", amount: 5000, currency: "XOF", createdAt: new Date(Date.now() + 1000) });
    expect(await initiateGatewayPayment({ orderId: "o_b", storeId: A, ...URLS })).toEqual({ ok: false, error: "Commande introuvable" });
    expect(await initiateGatewayPayment({ orderId: "o_b", storeId: B, ...URLS, callbackUrl: "https://attaquant.example/notify" })).toEqual({ ok: false, error: "URL de paiement invalide." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("remboursement Paystack demandé après commit ; échec tracé et notifié", async () => {
    attempt("att_a").status = "CONFIRMED";
    routes.push((url) => (url.endsWith("/refund") ? { json: { status: true, data: { id: 77, status: "pending" } } } : null));
    expect(await refundExternalAtGateway({ storeId: A, orderId: "o_a", refundId: "rf_1", amount: 2000, actorId: "u", actorLabel: "Test" })).toEqual({ attempted: true, ok: true });
    expect(t("orderEvent").at(-1)).toMatchObject({ type: "refund_gateway_requested" });

    routes = [(url) => (url.endsWith("/refund") ? { status: 400, json: { status: false, message: "Refund not supported" } } : null)];
    const r = await refundExternalAtGateway({ storeId: A, orderId: "o_a", refundId: "rf_2", amount: 2000, actorId: "u", actorLabel: "Test" });
    expect(r).toMatchObject({ attempted: true, ok: false });
    expect(t("notification").at(-1)).toMatchObject({ template: "payment.refund_manual", storeId: A });
  });

  it("isolation : jamais de remboursement sur la tentative d'une autre boutique", async () => {
    attempt("att_a").status = "CONFIRMED";
    expect(await refundExternalAtGateway({ storeId: B, orderId: "o_a", refundId: "rf_x", amount: 2000, actorId: "u", actorLabel: "Test" })).toEqual({ attempted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

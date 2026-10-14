import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => null) }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => null }));

process.env.APP_SECRET = "test-secret-0123456789-0123456789-abcdef";

import { encryptSecret } from "@/lib/crypto";
import { encodeKeyring } from "@/lib/webhooks/keyring";
import { verifySignature } from "@/lib/webhooks/sign";
import { roleHas } from "@/lib/auth/permissions";
import { ALLOWED_DATA_KEYS, canManageWebhooks, canViewCustomers, MAX_ATTEMPTS, RETRY_DELAYS_MS, buildWebhookBody, redactForEvent, redactPersonalData, retryDelayMs, shouldDisableEndpoint } from "@/lib/webhooks/policy";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { orderEventData } from "@/lib/commerce/domain-events";
import { customerEventData } from "@/lib/customers/events";
import { deliverWebhook, fanoutEvent } from "@/lib/webhooks/service";
import type { SendResult } from "@/lib/webhooks/deliver";

const SECRET = "whsec_" + "S".repeat(43);
const NOW = new Date("2026-10-11T12:00:00Z");

describe("calendrier de relances", () => {
  it("1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h puis DEAD (8 tentatives)", () => {
    expect(RETRY_DELAYS_MS.map((ms) => ms / 60_000)).toEqual([1, 5, 30, 120, 360, 720, 1440]);
    expect(MAX_ATTEMPTS).toBe(8);
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(7)).toBe(24 * 3_600_000);
    expect(retryDelayMs(8)).toBeNull();
  });

  it("désactivation : 50 échecs consécutifs ET plus de 72 h", () => {
    const old = new Date(NOW.getTime() - 73 * 3_600_000);
    const recent = new Date(NOW.getTime() - 10 * 3_600_000);
    expect(shouldDisableEndpoint(50, old, NOW)).toBe(true);
    expect(shouldDisableEndpoint(49, old, NOW)).toBe(false);
    expect(shouldDisableEndpoint(80, recent, NOW)).toBe(false);
    expect(shouldDisableEndpoint(80, null, NOW)).toBe(false);
  });
});

describe("rôles (miroir de permissions.ts, sans dépendance Next pour le worker)", () => {
  it.each(["OWNER", "MANAGER", "STAFF", "SUPPORT"] as const)("%s", (role) => {
    expect(canManageWebhooks(role)).toBe(roleHas(role, "integrations.manage"));
    expect(canViewCustomers(role)).toBe(roleHas(role, "customers.view"));
  });
});

describe("données personnelles : liste blanche par événement (m8)", () => {
  const ORDER_SAMPLE = {
    id: "o1", reference: "AX-1", status: "CONFIRMED", paymentStatus: "PAID", currency: "XOF", subtotal: 10_000,
    discount: 0, deliveryFee: 0, total: 10_000, channel: "STORE", fulfillmentType: "PICKUP", createdAt: new Date(),
  };

  it("tout événement du catalogue déclare sa liste de clés", () => {
    const missing = WEBHOOK_EVENTS.filter((e) => !ALLOWED_DATA_KEYS[e]);
    expect(missing).toEqual([]);
  });

  it("les charges émises n'utilisent que des clés déclarées (échoue si une clé inconnue apparaît)", () => {
    const check = (event: string, data: Record<string, unknown>) => Object.keys(data).filter((k) => !ALLOWED_DATA_KEYS[event].includes(k));
    expect(check("order.created", orderEventData(ORDER_SAMPLE as never))).toEqual([]);
    expect(check("order.paid", orderEventData(ORDER_SAMPLE as never))).toEqual([]);
    expect(check("order.refunded", { ...orderEventData(ORDER_SAMPLE as never), refundId: "rf_1", amount: 1000, destination: "original", returnId: null })).toEqual([]);
    expect(check("customer.created", customerEventData({ id: "c1", name: "Aïcha", phone: "229" }, { source: "checkout" }))).toEqual([]);
  });

  it("une clé NON déclarée est retirée, même inconnue de la liste noire", () => {
    const data = { id: "o1", total: 5000, customer_phone: "229", nouveau_champ_perso: "Aïcha, Akpakpa" };
    expect(redactForEvent("order.created", data)).toEqual({ id: "o1", total: 5000 });
    // Motif libre d'un changement de statut : jamais transmis sans droit aux données personnelles.
    expect(redactForEvent("order.status_changed", { id: "o1", from: "NEW", to: "CANCELLED", reason: "client joignable au 97…" })).toEqual({ id: "o1", from: "NEW", to: "CANCELLED" });
    // `customer` : réduit à son identifiant.
    expect(redactForEvent("customer.created", customerEventData({ id: "c1", name: "Aïcha", phone: "229" }, { source: "checkout" }))).toEqual({ customer_id: "c1", customer: { id: "c1" }, source: "checkout" });
  });

  it("événement sans liste déclarée : repli sur la liste noire (la charge n'est pas perdue)", () => {
    expect(redactForEvent("digital.delivered", { order_id: "o1", grant_id: "g1", email: "a@x.bj" })).toEqual({ order_id: "o1", grant_id: "g1" });
  });
});

describe("données personnelles", () => {
  it("retirées par défaut (clés connues et objet customer réduit à son id), conservées si autorisé", () => {
    const data = { id: "o1", total: 5000, customer_name: "Aïcha", phone: "22997000000", customer: { id: "c1", name: "Aïcha", email: "a@x.bj" }, items: [{ name: "Gâteau", email: "x" }] };
    expect(redactPersonalData(data)).toEqual({ id: "o1", total: 5000, customer: { id: "c1" }, items: [{ name: "Gâteau" }] });
    expect(buildWebhookBody({ eventId: "e", event: "order.created", createdAt: "t", storeId: "s", data, includePersonalData: true }).data).toEqual(data);
  });
});

function seed(opts: { includePersonalData?: boolean; role?: string; plan?: string; consecutiveFailures?: number; deliveryCreatedAt?: Date } = {}) {
  state.fake = createFakeDb({
    store: [{ id: "store_a", status: "PUBLISHED", contactEmail: "a@x.bj", name: "A" }, { id: "store_b", status: "PUBLISHED", name: "B" }],
    subscription: [
      { storeId: "store_a", planId: opts.plan ?? "SCALE", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
      { storeId: "store_b", planId: "SCALE", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
    ],
    membership: [{ userId: "u1", storeId: "store_a", role: opts.role ?? "OWNER", expiresAt: null }],
    webhookEndpoint: [
      { id: "ep_a_orders", storeId: "store_a", url: "https://hooks.exemple.com/a", secretEnc: encryptSecret(encodeKeyring({ current: SECRET })), events: ["order.created"], active: true, includePersonalData: opts.includePersonalData ?? false, createdById: "u1", consecutiveFailures: opts.consecutiveFailures ?? 0, lastSuccessAt: null, createdAt: NOW },
      { id: "ep_a_products", storeId: "store_a", url: "https://hooks.exemple.com/p", secretEnc: "x", events: ["product.created"], active: true, includePersonalData: false, createdById: "u1", consecutiveFailures: 0 },
      { id: "ep_b_orders", storeId: "store_b", url: "https://hooks.exemple.com/b", secretEnc: "x", events: ["order.created"], active: true, includePersonalData: true, createdById: "u2", consecutiveFailures: 0 },
    ],
    webhookDelivery: [],
    job: [],
  });
}

describe("fan-out", () => {
  beforeEach(() => seed());

  it("une livraison par point actif ABONNÉ de la boutique, rien pour une autre boutique", async () => {
    const r = await fanoutEvent({ storeId: "store_a", eventId: "evt_1", event: "order.created", data: { id: "o1", customer_name: "Aïcha" } });
    expect(r.created).toBe(1);
    const rows = state.fake!.tables.webhookDelivery;
    expect(rows.map((d) => d.endpointId)).toEqual(["ep_a_orders"]);
    expect(rows[0].payload.data).toEqual({ id: "o1" }); // sans données personnelles par défaut
    expect(rows[0].payload).toMatchObject({ id: "evt_1", type: "order.created", store_id: "store_a", api_version: "2026-10" });
    expect(state.fake!.tables.job.filter((j) => j.type === "webhook.deliver")).toHaveLength(1);
  });

  it("données personnelles seulement si le point les demande ET le créateur a customers.view", async () => {
    seed({ includePersonalData: true });
    await fanoutEvent({ storeId: "store_a", eventId: "evt_2", event: "order.created", data: { id: "o1", customer_name: "Aïcha" } });
    expect(state.fake!.tables.webhookDelivery[0].payload.data).toEqual({ id: "o1", customer_name: "Aïcha" });
    seed({ includePersonalData: true, role: "STAFF" });
    await fanoutEvent({ storeId: "store_a", eventId: "evt_3", event: "order.created", data: { id: "o1", customer_name: "Aïcha" } });
    expect(state.fake!.tables.webhookDelivery[0].payload.data).toEqual({ id: "o1" });
  });

  it("plan sans webhooks (rétrogradé) ou événement inconnu : rien", async () => {
    seed({ plan: "STARTER" });
    expect((await fanoutEvent({ storeId: "store_a", eventId: "evt_4", event: "order.created", data: {} })).created).toBe(0);
    seed();
    expect((await fanoutEvent({ storeId: "store_a", eventId: "evt_5", event: "order.exploded", data: {} })).created).toBe(0);
  });
});

describe("livraison et relances", () => {
  const delivery = (over: Record<string, unknown> = {}) => ({
    id: "dlv_1", storeId: "store_a", endpointId: "ep_a_orders", eventId: "evt_9", event: "order.created",
    payload: { id: "evt_9", type: "order.created", data: { id: "o1" } }, status: "PENDING", attempts: 0, nextAttemptAt: new Date(NOW.getTime() - 1000), createdAt: NOW, ...over,
  });
  const send = (r: Partial<SendResult>) => vi.fn(async (...args: [url: string, body: string, headers: Record<string, string>]) => (void args, { ok: false, status: null, error: null, snippet: null, durationMs: 5, ...r }) as SendResult);

  it("succès : signé (Axi-Signature vérifiable), en-têtes, SUCCEEDED, compteur d'échecs remis à zéro", async () => {
    seed({ consecutiveFailures: 3 });
    state.fake!.tables.webhookDelivery.push(delivery());
    const s = send({ ok: true, status: 200, snippet: "ok" });
    const r = await deliverWebhook("dlv_1", { send: s, now: () => NOW });
    expect(r.outcome).toBe("succeeded");
    const [, body, headers] = s.mock.calls[0];
    expect(headers["Axi-Webhook-Id"]).toBe("evt_9");
    expect(headers["Axi-Event"]).toBe("order.created");
    expect(headers["Axi-Delivery-Id"]).toBe("dlv_1");
    expect(verifySignature(headers["Axi-Signature"], body, [SECRET], { nowSec: Math.floor(NOW.getTime() / 1000) }).ok).toBe(true);
    expect(state.fake!.tables.webhookDelivery[0]).toMatchObject({ status: "SUCCEEDED", attempts: 1, lastStatusCode: 200 });
    expect(state.fake!.tables.webhookEndpoint[0].consecutiveFailures).toBe(0);
  });

  it("échec : FAILED, prochain essai à +1 min avec un job programmé ; 8e échec : DEAD sans nouveau job", async () => {
    seed();
    state.fake!.tables.webhookDelivery.push(delivery());
    const r = await deliverWebhook("dlv_1", { send: send({ status: 500, error: "Réponse HTTP 500" }), now: () => NOW });
    expect(r.outcome).toBe("retry");
    const d = state.fake!.tables.webhookDelivery[0];
    expect(d.status).toBe("FAILED");
    expect(d.nextAttemptAt.getTime() - NOW.getTime()).toBe(60_000);
    const jobs = state.fake!.tables.job.filter((j) => j.type === "webhook.deliver");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].runAt.getTime()).toBe(NOW.getTime() + 60_000);

    seed();
    state.fake!.tables.webhookDelivery.push(delivery({ status: "FAILED", attempts: 7 }));
    const dead = await deliverWebhook("dlv_1", { send: send({ status: 503 }), now: () => NOW });
    expect(dead.outcome).toBe("dead");
    expect(state.fake!.tables.webhookDelivery[0].status).toBe("DEAD");
    expect(state.fake!.tables.job.filter((j) => j.type === "webhook.deliver")).toHaveLength(0);
  });

  it("pas encore dû, déjà livré, ou réclamé par un autre worker : ignoré (aucun envoi)", async () => {
    seed();
    state.fake!.tables.webhookDelivery.push(delivery({ nextAttemptAt: new Date(NOW.getTime() + 60_000) }));
    const s = send({ ok: true, status: 200 });
    expect((await deliverWebhook("dlv_1", { send: s, now: () => NOW })).outcome).toBe("skipped");
    state.fake!.tables.webhookDelivery[0] = delivery({ status: "SUCCEEDED" });
    expect((await deliverWebhook("dlv_1", { send: s, now: () => NOW })).outcome).toBe("skipped");
    expect(s).not.toHaveBeenCalled();
  });

  it("50e échec consécutif sur plus de 72 h : point désactivé et commerçant notifié", async () => {
    seed({ consecutiveFailures: 49 });
    state.fake!.tables.webhookDelivery.push(delivery({ createdAt: new Date(NOW.getTime() - 80 * 3_600_000), attempts: 3, status: "FAILED" }));
    await deliverWebhook("dlv_1", { send: send({ status: 500 }), now: () => NOW });
    const ep = state.fake!.tables.webhookEndpoint[0];
    expect(ep.active).toBe(false);
    expect(ep.disabledReason).toMatch(/50 échecs/);
    const { notifyStore } = await import("@/lib/notifications/service");
    expect(notifyStore).toHaveBeenCalled();
    expect(state.fake!.tables.notification?.some((n) => n.template === "merchant.webhook_disabled")).toBe(true);
  });
});

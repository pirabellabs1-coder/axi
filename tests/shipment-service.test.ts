import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";
import { parseCarrierPayload, signWebhook, verifySignature, WEBHOOK_TOLERANCE_SECONDS } from "@/lib/carriers/webhook";
import { buildCreateShipmentRequest } from "@/lib/carriers/adapters";

/**
 * Service d'expédition (lot 3 §1.2) : expéditions partielles, avancement de la commande, idempotence
 * et non-rétrogradation des événements transporteur, vérification des webhooks signés.
 */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})), queueNotification: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => ({})) }));
vi.mock("@/lib/commerce/orders", () => ({ transitionOrder: vi.fn(async () => ({})) }));

process.env.APP_SECRET = "test-secret-0123456789-0123456789-abcdef";

import { createShipment, recordShipmentEvent, ShippingError, syncOrderFulfillmentTx } from "@/lib/shipping/service";
import { transitionOrder } from "@/lib/commerce/orders";

const S = "store_S_0001";
const ORDER = "order_S_0001";

function seed() {
  return createFakeDb({
    store: [{ id: S, slug: "s", name: "S", status: "PUBLISHED", currency: "XOF", country: "BJ" }],
    location: [{ id: "loc_1", storeId: S, name: "Entrepôt", active: true, isDefault: true }],
    order: [{ id: ORDER, storeId: S, reference: "AX-S1", status: "CONFIRMED", fulfillmentStatus: "UNFULFILLED", paymentStatus: "PAID", total: 5_000, amountDue: 0, trackingToken: "tok", customerName: "Awa Koffi", customerPhone: "22997123456" }],
    product: [{ id: "p1", storeId: S, name: "Sac", status: "ACTIVE", trackStock: true, stock: 7, inventoryPolicy: "DENY", variants: [] }],
    inventoryLevel: [{ id: "lvl_1", storeId: S, locationId: "loc_1", productId: "p1", variantId: null, itemKey: "p1", available: 7 }],
    orderItem: [
      { id: "it1", orderId: ORDER, productId: "p1", name: "Sac", quantity: 3, kind: "PHYSICAL", unitPrice: 1_000, lineTotal: 3_000, locationId: "loc_1" },
      { id: "it2", orderId: ORDER, productId: "p2", name: "Fichier", quantity: 1, kind: "DIGITAL", unitPrice: 2_000, lineTotal: 2_000 },
    ],
  });
}

beforeEach(() => {
  state.fake = seed();
  vi.mocked(transitionOrder).mockClear();
});

describe("createShipment", () => {
  it("crée une expédition partielle et met la commande en PARTIAL", async () => {
    const created = await createShipment({ storeId: S, orderId: ORDER, carrier: "manual", items: [{ orderItemId: "it1", quantity: 1 }], withDeliveryCode: true });
    expect(created.id).toBeTruthy();
    expect(created.deliveryCode).toMatch(/^\d{4}$/);
    expect(created.courierToken.length).toBeGreaterThanOrEqual(32);
    const shipment = state.fake!.tables.shipment[0];
    expect(shipment).toMatchObject({ storeId: S, orderId: ORDER, status: "PENDING", locationId: "loc_1" });
    // Le code n'est JAMAIS stocké en clair.
    expect(String(shipment.deliveryCodeHash)).not.toContain(created.deliveryCode!);
    expect(state.fake!.tables.order[0].fulfillmentStatus).toBe("PARTIAL");
    expect(state.fake!.tables.shipmentEvent[0]).toMatchObject({ status: "PENDING", source: "manual" });
  });

  it("borne les quantités au reste à expédier et ignore les lignes non physiques", async () => {
    await createShipment({ storeId: S, orderId: ORDER, carrier: "manual", items: [{ orderItemId: "it1", quantity: 99 }, { orderItemId: "it2", quantity: 1 }] });
    const items = state.fake!.tables.shipmentItem;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ orderItemId: "it1", quantity: 3 });
    expect(state.fake!.tables.order[0].fulfillmentStatus).toBe("FULFILLED");
  });

  it("refuse une seconde expédition quand tout est déjà expédié", async () => {
    await createShipment({ storeId: S, orderId: ORDER, carrier: "manual", items: [{ orderItemId: "it1", quantity: 3 }] });
    await expect(createShipment({ storeId: S, orderId: ORDER, carrier: "manual", items: [{ orderItemId: "it1", quantity: 1 }] })).rejects.toBeInstanceOf(ShippingError);
  });

  it("refuse une ligne qui n'appartient pas à la commande", async () => {
    await expect(createShipment({ storeId: S, orderId: ORDER, carrier: "manual", items: [{ orderItemId: "inconnu", quantity: 1 }] })).rejects.toBeInstanceOf(ShippingError);
  });
});

describe("recordShipmentEvent", () => {
  async function shipment() {
    const created = await createShipment({ storeId: S, orderId: ORDER, carrier: "manual", items: [{ orderItemId: "it1", quantity: 3 }] });
    return created.id;
  }

  it("fait avancer l'expédition et journalise l'événement", async () => {
    const id = await shipment();
    const r = await recordShipmentEvent({ storeId: S, shipmentId: id, status: "PICKED_UP", source: "manual", strict: true });
    expect(r).toMatchObject({ applied: true, status: "PICKED_UP" });
    expect(state.fake!.tables.shipment[0].status).toBe("PICKED_UP");
  });

  it("ignore un événement déjà reçu (idempotence par providerEventId)", async () => {
    const id = await shipment();
    const first = await recordShipmentEvent({ storeId: S, shipmentId: id, status: "IN_TRANSIT", source: "webhook", providerEventId: "evt_1" });
    const second = await recordShipmentEvent({ storeId: S, shipmentId: id, status: "IN_TRANSIT", source: "webhook", providerEventId: "evt_1" });
    expect(first.applied).toBe(true);
    expect(second).toMatchObject({ applied: false, reason: "duplicate" });
    expect(state.fake!.tables.shipmentEvent.filter((e) => e.providerEventId === "evt_1")).toHaveLength(1);
  });

  it("un événement tardif ne rétrograde pas l'expédition mais reste journalisé", async () => {
    const id = await shipment();
    await recordShipmentEvent({ storeId: S, shipmentId: id, status: "OUT_FOR_DELIVERY", source: "webhook", providerEventId: "evt_2" });
    const late = await recordShipmentEvent({ storeId: S, shipmentId: id, status: "PICKED_UP", source: "webhook", providerEventId: "evt_3" });
    expect(late).toMatchObject({ applied: false, reason: "ignored" });
    expect(state.fake!.tables.shipment[0].status).toBe("OUT_FOR_DELIVERY");
    expect(state.fake!.tables.shipmentEvent.some((e) => e.providerEventId === "evt_3")).toBe(true);
  });

  it("refuse une transition interdite demandée par un humain (strict)", async () => {
    const id = await shipment();
    const r = await recordShipmentEvent({ storeId: S, shipmentId: id, status: "DELIVERED", source: "courier", strict: true });
    expect(r).toMatchObject({ applied: false, reason: "forbidden" });
    expect(state.fake!.tables.shipment[0].status).toBe("PENDING");
  });

  it("livraison : horodatée, et la commande passe en livrée", async () => {
    const id = await shipment();
    await recordShipmentEvent({ storeId: S, shipmentId: id, status: "OUT_FOR_DELIVERY", source: "webhook" });
    const r = await recordShipmentEvent({ storeId: S, shipmentId: id, status: "DELIVERED", source: "courier", strict: true });
    expect(r.applied).toBe(true);
    expect(state.fake!.tables.shipment[0].deliveredAt).toBeInstanceOf(Date);
    expect(vi.mocked(transitionOrder).mock.calls.map((c) => c[0].to)).toContain("DELIVERED");
  });

  it("compte les tentatives échouées", async () => {
    const id = await shipment();
    // Le commerçant ne peut pas sauter d'étape : récupéré, puis en livraison, puis échec.
    const skipped = await recordShipmentEvent({ storeId: S, shipmentId: id, status: "OUT_FOR_DELIVERY", source: "manual", strict: true });
    expect(skipped).toMatchObject({ applied: false, reason: "forbidden" });
    await recordShipmentEvent({ storeId: S, shipmentId: id, status: "PICKED_UP", source: "manual", strict: true });
    await recordShipmentEvent({ storeId: S, shipmentId: id, status: "OUT_FOR_DELIVERY", source: "manual", strict: true });
    await recordShipmentEvent({ storeId: S, shipmentId: id, status: "FAILED_ATTEMPT", source: "courier", strict: true, message: "Client absent" });
    expect(state.fake!.tables.shipment[0].deliveryAttempts).toBe(1);
    expect(state.fake!.tables.shipment[0].status).toBe("FAILED_ATTEMPT");
  });

  it("refuse une expédition d'une autre boutique", async () => {
    const id = await shipment();
    await expect(recordShipmentEvent({ storeId: "store_AUTRE", shipmentId: id, status: "PICKED_UP", source: "manual" })).rejects.toBeInstanceOf(ShippingError);
  });

  it("une expédition annulée rend ses unités expédiables (avancement recalculé)", async () => {
    const id = await shipment();
    expect(state.fake!.tables.order[0].fulfillmentStatus).toBe("FULFILLED");
    await recordShipmentEvent({ storeId: S, shipmentId: id, status: "CANCELLED", source: "manual", strict: true });
    expect(state.fake!.tables.order[0].fulfillmentStatus).toBe("UNFULFILLED");
    await state.fake!.db.$transaction(async (tx: unknown) => {
      const status = await syncOrderFulfillmentTx(tx as never, { storeId: S, orderId: ORDER });
      expect(status).toBe("UNFULFILLED");
    });
  });
});

describe("expédition RETOURNÉE : remise en stock (majeur n° 7)", () => {
  async function returned(providerEventId?: string) {
    const created = await createShipment({ storeId: S, orderId: ORDER, carrier: "manual", items: [{ orderItemId: "it1", quantity: 3 }] });
    await recordShipmentEvent({ storeId: S, shipmentId: created.id, status: "PICKED_UP", source: "manual", strict: true });
    await recordShipmentEvent({ storeId: S, shipmentId: created.id, status: "OUT_FOR_DELIVERY", source: "manual", strict: true });
    await recordShipmentEvent({ storeId: S, shipmentId: created.id, status: "FAILED_ATTEMPT", source: "courier", strict: true });
    const r = await recordShipmentEvent({ storeId: S, shipmentId: created.id, status: "RETURNED", source: "webhook", strict: true, providerEventId });
    return { id: created.id, result: r };
  }

  const product = () => state.fake!.tables.product.find((p) => p.id === "p1")!;
  const level = () => state.fake!.tables.inventoryLevel.find((l) => l.itemKey === "p1")!;
  const returns = () => (state.fake!.tables.inventoryMovement ?? []).filter((m) => m.reason === "RETURN");

  it("crédite l'agrégat ET le dépôt de l'expédition, avec un mouvement RETURN", async () => {
    const { result } = await returned();
    expect(result).toMatchObject({ applied: true, status: "RETURNED" });
    expect(product().stock).toBe(10); // 7 + 3 retournés
    expect(level().available).toBe(10);
    expect(returns()).toHaveLength(1);
    expect(returns()[0]).toMatchObject({ locationId: "loc_1", delta: 3, orderId: ORDER });
    // La commande en garde la trace.
    expect(state.fake!.tables.orderEvent.some((e) => /remis en stock/.test(String(e.message)))).toBe(true);
  });

  it("ne recrédite JAMAIS deux fois, même sur rejeu de l'événement", async () => {
    const { id } = await returned("evt_ret_1");
    // Rejeu du même événement (même clé) puis d'un événement RETURNED sans clé.
    await recordShipmentEvent({ storeId: S, shipmentId: id, status: "RETURNED", source: "webhook", providerEventId: "evt_ret_1" });
    await recordShipmentEvent({ storeId: S, shipmentId: id, status: "RETURNED", source: "webhook" });
    expect(product().stock).toBe(10);
    expect(level().available).toBe(10);
    expect(returns()).toHaveLength(1);
  });

  it("une ligne non physique n'est pas remise en stock", async () => {
    const created = await createShipment({ storeId: S, orderId: ORDER, carrier: "manual", items: [{ orderItemId: "it1", quantity: 3 }] });
    // La ligne numérique n'a jamais été expédiée : rien d'autre que les 3 sacs ne revient.
    await recordShipmentEvent({ storeId: S, shipmentId: created.id, status: "PICKED_UP", source: "manual", strict: true });
    await recordShipmentEvent({ storeId: S, shipmentId: created.id, status: "IN_TRANSIT", source: "webhook" });
    await recordShipmentEvent({ storeId: S, shipmentId: created.id, status: "OUT_FOR_DELIVERY", source: "webhook" });
    await recordShipmentEvent({ storeId: S, shipmentId: created.id, status: "FAILED_ATTEMPT", source: "courier", strict: true });
    await recordShipmentEvent({ storeId: S, shipmentId: created.id, status: "RETURNED", source: "manual", strict: true });
    expect(returns()).toHaveLength(1);
    expect(returns()[0].productId).toBe("p1");
  });
});

describe("webhooks transporteurs", () => {
  const secret = "whsec_123";
  const body = JSON.stringify({ provider_ref: "REF-1", events: [{ status: "delivered", event_id: "e1", occurred_at: "2026-10-10T10:00:00Z" }] });

  /** Horodatage frais : il est désormais OBLIGATOIRE (mineur n° 7 de l'audit de la vague 3). */
  const ts = () => String(Math.floor(Date.now() / 1000));

  it("valide une signature correcte (avec horodatage)", () => {
    const t = ts();
    expect(verifySignature({ secret, raw: body, timestamp: t, signature: signWebhook(secret, body, t) })).toEqual({ ok: true });
    expect(verifySignature({ secret, raw: body, timestamp: t, signature: `sha256=${signWebhook(secret, body, t)}` })).toEqual({ ok: true });
  });

  it("rejette une signature SANS horodatage, sauf drapeau de configuration explicite", () => {
    // Sans horodatage, un corps signé est rejouable indéfiniment : refus par défaut.
    expect(verifySignature({ secret, raw: body, signature: signWebhook(secret, body) })).toMatchObject({ ok: false, error: "missing_timestamp" });
    expect(verifySignature({ secret, raw: body, signature: signWebhook(secret, body), allowMissingTimestamp: true })).toEqual({ ok: true });
  });

  it("rejette une signature absente, erronée ou un secret manquant", () => {
    const t = ts();
    expect(verifySignature({ secret, raw: body, timestamp: t, signature: "" })).toMatchObject({ ok: false, error: "missing_signature" });
    expect(verifySignature({ secret, raw: body, timestamp: t, signature: "deadbeef" })).toMatchObject({ ok: false, error: "bad_signature" });
    expect(verifySignature({ secret: null, raw: body, timestamp: t, signature: "x" })).toMatchObject({ ok: false, error: "missing_secret" });
  });

  it("rejette un corps modifié (même d'un caractère)", () => {
    const t = ts();
    const signature = signWebhook(secret, body, t);
    expect(verifySignature({ secret, raw: `${body} `, timestamp: t, signature })).toMatchObject({ ok: false, error: "bad_signature" });
  });

  it("rejette un horodatage hors tolérance (anti-rejeu)", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const fresh = String(Math.floor(now.getTime() / 1000));
    const stale = String(Math.floor(now.getTime() / 1000) - WEBHOOK_TOLERANCE_SECONDS - 10);
    expect(verifySignature({ secret, raw: body, timestamp: fresh, signature: signWebhook(secret, body, fresh), now })).toEqual({ ok: true });
    expect(verifySignature({ secret, raw: body, timestamp: stale, signature: signWebhook(secret, body, stale), now })).toMatchObject({ ok: false, error: "stale" });
  });

  it("extrait les événements connus et écarte les codes inconnus", () => {
    const parsed = parseCarrierPayload("dhl", { provider_ref: "REF-1", events: [{ status: "OK", event_id: "e1" }, { status: "code-bidon", event_id: "e2" }] });
    expect(parsed?.providerRef).toBe("REF-1");
    expect(parsed?.events.map((e) => e.status)).toEqual(["DELIVERED"]);
  });

  it("dérive une clé déterministe quand le transporteur n'envoie aucun identifiant (mineur n° 12)", () => {
    const payload = { provider_ref: "REF-1", events: [{ status: "OK", occurred_at: "2026-10-10T10:00:00Z", message: "Livré au client" }] };
    const first = parseCarrierPayload("dhl", payload);
    const second = parseCarrierPayload("dhl", payload);
    expect(first?.events[0].providerEventId).toMatch(/^fp:[0-9a-f]{32}$/);
    // Même événement renvoyé deux fois ⇒ même clé : l'idempotence `(shipmentId, providerEventId)` joue.
    expect(second?.events[0].providerEventId).toBe(first?.events[0].providerEventId);
    // Un contenu différent (date ou libellé) donne une clé différente.
    const other = parseCarrierPayload("dhl", { provider_ref: "REF-1", events: [{ status: "OK", occurred_at: "2026-10-10T11:00:00Z", message: "Livré au client" }] });
    expect(other?.events[0].providerEventId).not.toBe(first?.events[0].providerEventId);
    // Un identifiant fourni par le transporteur reste prioritaire.
    const withId = parseCarrierPayload("dhl", { provider_ref: "REF-1", events: [{ status: "OK", event_id: "e9" }] });
    expect(withId?.events[0].providerEventId).toBe("e9");
  });

  it("refuse une charge utile sans référence ou sans événement exploitable", () => {
    expect(parseCarrierPayload("dhl", { events: [{ status: "OK" }] })).toBeNull();
    expect(parseCarrierPayload("dhl", { provider_ref: "REF-1", events: [{ status: "inconnu" }] })).toBeNull();
    expect(parseCarrierPayload("dhl", null)).toBeNull();
  });

  it("construit une requête d'expédition complète et normalisée", () => {
    const request = buildCreateShipmentRequest({
      from: { name: "Boutique", phone: "22997000000", city: "Cotonou", country: "BJ" },
      to: { name: "Awa", phone: "22997123456", address: "Rue 12", city: "Porto-Novo", country: "BJ", note: "Près du marché" },
      parcel: { weightGrams: 0, reference: "AX-S1", declaredValue: 5_000, cashOnDelivery: 0 },
      callbackUrl: "https://axi.africa/api/webhooks/carriers/dhl",
    });
    expect(request).toMatchObject({ reference: "AX-S1", callback_url: "https://axi.africa/api/webhooks/carriers/dhl" });
    // Poids minimal de 1 g : aucun transporteur n'accepte 0.
    expect((request.parcel as { weight_grams: number }).weight_grams).toBe(1);
  });
});

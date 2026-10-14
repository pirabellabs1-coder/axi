import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";
import { PLANS } from "@/config/plans";

/**
 * Sécurité du lot 3 (§6) : isolation entre boutiques (dépôts, niveaux, tarifs, transporteurs,
 * expéditions, appareils de caisse), contrôle de plan côté serveur et capacités par rôle.
 * Un membre de la boutique A ne doit jamais lire ni écrire une donnée de la boutique B.
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  member: "store_A_0001" as string,
  planId: "BUSINESS" as string,
  caps: new Set<string>(["products.manage", "delivery.manage", "orders.manage", "store.settings", "pos.sell"]),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => ({})) }));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
  hmacSha256: (_k: string, v: string) => `hmac:${v}`,
  // Accesseur unique du secret (mineur n° 12) : toute empreinte passe par lui.
  requireAppSecret: () => "test-secret-0123456789-0123456789-abcdef",
  isPlaceholderSecret: (v: string) => /change-?me/i.test(v ?? ""),
  sha256: (v: string) => `sha:${v}`,
  numericCode: () => "1234",
  safeEqual: (a: string, b: string) => a === b,
}));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireStore: vi.fn(async (storeId: string, cap: string) => {
      if (storeId !== state.member) throw new AuthError("Boutique introuvable ou accès refusé");
      if (!state.caps.has(cap)) throw new AuthError("Votre rôle ne permet pas cette action");
      const store = state.fake!.tables.store.find((s) => s.id === storeId)!;
      return { user: { id: "user_A" }, store, role: "OWNER", planId: state.planId, can: () => true };
    }),
  };
});

process.env.APP_SECRET = "test-secret-0123456789-0123456789-abcdef";

import { upsertLocation, setDefaultLocation, archiveLocation } from "@/lib/locations/actions";
import { assignStockToLocation, createTransfer, submitCount } from "@/lib/inventory/actions";
import { upsertShippingRate, setZoneLocation, upsertCarrierAccount, createShipmentAction, updateShipmentStatus } from "@/lib/shipping/actions";
import { registerPosDevice, revokePosDevice, openPosSession } from "@/lib/pos/actions";

const A = "store_A_0001";
const B = "store_B_0001";
const LA = "loc_A_0001";
const LA2 = "loc_A_0002";
const LB = "loc_B_0001";
const PA = "prod_A_0001";
const PB = "prod_B_0001";
const ZA = "zone_A_0001";
const ZB = "zone_B_0001";
const OA = "order_A_0001";
const OB = "order_B_0001";
const SHIP_B = "ship_B_0001";
const DEV_B = "dev_B_0001";

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

beforeEach(() => {
  state.member = A;
  state.planId = "BUSINESS";
  state.caps = new Set(["products.manage", "delivery.manage", "orders.manage", "store.settings", "pos.sell"]);
  state.fake = createFakeDb({
    store: [
      { id: A, slug: "a", name: "A", status: "PUBLISHED", currency: "XOF", country: "BJ" },
      { id: B, slug: "b", name: "B", status: "PUBLISHED", currency: "XOF", country: "BJ" },
    ],
    location: [
      { id: LA, storeId: A, name: "Entrepôt A", active: true, isDefault: true },
      { id: LA2, storeId: A, name: "Magasin A", active: true, isDefault: false },
      { id: LB, storeId: B, name: "Entrepôt B", active: true, isDefault: true },
    ],
    product: [
      { id: PA, storeId: A, name: "Sac A", status: "ACTIVE", trackStock: true, stock: 5, variants: [] },
      { id: PB, storeId: B, name: "Sac B", status: "ACTIVE", trackStock: true, stock: 5, variants: [] },
    ],
    inventoryLevel: [
      { id: "lvlA", storeId: A, locationId: LA, productId: PA, variantId: null, itemKey: PA, available: 5 },
      { id: "lvlB", storeId: B, locationId: LB, productId: PB, variantId: null, itemKey: PB, available: 5 },
    ],
    deliveryZone: [
      { id: ZA, storeId: A, name: "Zone A", fee: 1_000, active: true, position: 0 },
      { id: ZB, storeId: B, name: "Zone B", fee: 1_000, active: true, position: 0 },
    ],
    order: [
      { id: OA, storeId: A, reference: "AX-A", status: "CONFIRMED", fulfillmentStatus: "UNFULFILLED", items: [] },
      { id: OB, storeId: B, reference: "AX-B", status: "CONFIRMED", fulfillmentStatus: "UNFULFILLED", items: [] },
    ],
    orderItem: [
      { id: "itA", orderId: OA, productId: PA, name: "Sac A", quantity: 2, kind: "PHYSICAL", unitPrice: 1_000, lineTotal: 2_000 },
      { id: "itB", orderId: OB, productId: PB, name: "Sac B", quantity: 2, kind: "PHYSICAL", unitPrice: 1_000, lineTotal: 2_000 },
    ],
    shipment: [{ id: SHIP_B, storeId: B, orderId: OB, carrier: "manual", status: "PENDING" }],
    posDevice: [{ id: DEV_B, storeId: B, locationId: LB, name: "Tablette B", tokenHash: "hB", tokenPrefix: "bbb", revokedAt: null }],
    carrierAccount: [{ id: "car_B", storeId: B, carrier: "manual", name: "Livreur B", active: true }],
  });
});

describe("isolation des dépôts et du stock", () => {
  it("refuse toute action sur une autre boutique", async () => {
    const r = await upsertLocation(undefined, fd({ storeId: B, name: "Pirate", type: "WAREHOUSE", fulfillsOnlineOrders: "on", pickupEnabled: "", active: "on" }));
    expect(r.ok).toBe(false);
    expect(await setDefaultLocation(B, LB)).toMatchObject({ ok: false });
    expect(await archiveLocation(B, LB)).toMatchObject({ ok: false });
  });

  it("ne modifie pas un dépôt d'une autre boutique depuis sa propre boutique", async () => {
    const r = await upsertLocation(undefined, fd({ storeId: A, id: LB, name: "Renommé", type: "WAREHOUSE", fulfillsOnlineOrders: "on", pickupEnabled: "", active: "on" }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.location.find((l) => l.id === LB)!.name).toBe("Entrepôt B");
  });

  it("refuse de désigner par défaut un dépôt d'une autre boutique", async () => {
    expect(await setDefaultLocation(A, LB)).toMatchObject({ ok: false });
    expect(state.fake!.tables.location.find((l) => l.id === LB)!.isDefault).toBe(true);
    expect(state.fake!.tables.location.find((l) => l.id === LA)!.isDefault).toBe(true);
  });

  it("refuse de répartir du stock vers un dépôt ou un produit d'une autre boutique", async () => {
    expect(await assignStockToLocation(undefined, fd({ storeId: A, locationId: LB, productId: PA, quantity: "2" }))).toMatchObject({ ok: false });
    expect(await assignStockToLocation(undefined, fd({ storeId: A, locationId: LA, productId: PB, quantity: "2" }))).toMatchObject({ ok: false });
    expect(state.fake!.tables.inventoryLevel.find((l) => l.id === "lvlB")!.available).toBe(5);
  });

  it("refuse un transfert mêlant les boutiques", async () => {
    expect(await createTransfer(undefined, fd({ storeId: A, fromLocationId: LA, toLocationId: LB, [`item-${PA}`]: "1" }))).toMatchObject({ ok: false });
    expect(await createTransfer(undefined, fd({ storeId: A, fromLocationId: LA, toLocationId: LA2, [`item-${PB}`]: "1" }))).toMatchObject({ ok: false });
  });

  it("refuse un comptage dans un dépôt d'une autre boutique", async () => {
    expect(await submitCount(undefined, fd({ storeId: A, locationId: LB, [`count-${PB}`]: "0" }))).toMatchObject({ ok: false });
    expect(state.fake!.tables.inventoryLevel.find((l) => l.id === "lvlB")!.available).toBe(5);
  });
});

describe("isolation de l'expédition", () => {
  it("refuse un tarif sur une zone d'une autre boutique", async () => {
    const r = await upsertShippingRate(undefined, fd({ storeId: A, zoneId: ZB, name: "Pirate", price: "0", active: "on" }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.shippingRate ?? []).toHaveLength(0);
  });

  it("refuse d'affecter un dépôt d'une autre boutique à une zone", async () => {
    expect(await setZoneLocation(A, ZA, LB)).toMatchObject({ ok: false });
    expect(await setZoneLocation(A, ZB, LA)).toMatchObject({ ok: false });
  });

  it("refuse une expédition sur une commande d'une autre boutique", async () => {
    const r = await createShipmentAction(undefined, fd({ storeId: A, orderId: OB, [`ship-itB`]: "1", withDeliveryCode: "" }));
    expect(r.ok).toBe(false);
  });

  it("refuse de faire avancer une expédition d'une autre boutique", async () => {
    const r = await updateShipmentStatus(undefined, fd({ storeId: A, shipmentId: SHIP_B, status: "PICKED_UP" }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.shipment.find((s) => s.id === SHIP_B)!.status).toBe("PENDING");
  });

  it("refuse d'utiliser le compte transporteur d'une autre boutique", async () => {
    const r = await createShipmentAction(undefined, fd({ storeId: A, orderId: OA, carrierAccountId: "car_B", [`ship-itA`]: "1", withDeliveryCode: "" }));
    expect(r.ok).toBe(false);
  });

  it("chiffre les identifiants transporteur au repos (jamais en clair)", async () => {
    const r = await upsertCarrierAccount(undefined, fd({ storeId: A, carrier: "manual", name: "Livreur A", active: "on" }));
    expect(r.ok).toBe(true);
    const account = state.fake!.tables.carrierAccount.find((c) => c.storeId === A)!;
    expect(account.credentialsEncrypted ?? null).toBeNull(); // aucun identifiant fourni
    const withCreds = await upsertCarrierAccount(undefined, fd({ storeId: A, carrier: "dhl", name: "DHL A", active: "on", "cred-apiKey": "secret-123" }));
    // Plan Business : l'API transporteurs est réservée au plan Scale.
    expect(withCreds.ok).toBe(false);
    state.planId = "SCALE";
    const scale = await upsertCarrierAccount(undefined, fd({ storeId: A, carrier: "dhl", name: "DHL A", active: "on", "cred-apiKey": "secret-123" }));
    expect(scale.ok).toBe(true);
    const dhl = state.fake!.tables.carrierAccount.find((c) => c.carrier === "dhl")!;
    expect(String(dhl.credentialsEncrypted)).toContain("enc:");
    expect(String(dhl.credentialsEncrypted)).not.toBe("secret-123");
  });
});

describe("isolation de la caisse", () => {
  it("refuse d'enregistrer un appareil sur une autre boutique", async () => {
    expect(await registerPosDevice(undefined, fd({ storeId: B, name: "Pirate", locationId: LB }))).toMatchObject({ ok: false });
  });

  it("refuse un appareil rattaché à un dépôt d'une autre boutique", async () => {
    expect(await registerPosDevice(undefined, fd({ storeId: A, name: "Tablette", locationId: LB }))).toMatchObject({ ok: false });
  });

  it("refuse de révoquer ou d'ouvrir une session sur l'appareil d'une autre boutique", async () => {
    expect(await revokePosDevice(A, DEV_B)).toMatchObject({ ok: false });
    expect(await openPosSession(undefined, fd({ storeId: A, deviceId: DEV_B, openingFloat: "0" }))).toMatchObject({ ok: false });
    expect(state.fake!.tables.posDevice.find((d) => d.id === DEV_B)!.revokedAt).toBeNull();
  });
});

describe("contrôles de plan et de rôle", () => {
  it("plan Gratuit : pas de tarif d'expédition avancé", async () => {
    state.planId = "FREE";
    const r = await upsertShippingRate(undefined, fd({ storeId: A, zoneId: ZA, name: "Standard", price: "1000", active: "on" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Starter/);
  });

  it("plan sans caisse : aucun appareil ne peut être enregistré", async () => {
    state.planId = "STARTER";
    const r = await registerPosDevice(undefined, fd({ storeId: A, name: "Tablette", locationId: LA }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Business/);
  });

  it("limite d'appareils du plan Business (1)", async () => {
    expect(PLANS.BUSINESS.limits.posDevices).toBe(1);
    const first = await registerPosDevice(undefined, fd({ storeId: A, name: "Tablette 1", locationId: LA }));
    expect(first.ok).toBe(true);
    const second = await registerPosDevice(undefined, fd({ storeId: A, name: "Tablette 2", locationId: LA }));
    expect(second.ok).toBe(false);
  });

  it("limite de dépôts du plan (Business : 2)", async () => {
    expect(PLANS.BUSINESS.limits.locations).toBe(2);
    const r = await upsertLocation(undefined, fd({ storeId: A, name: "Troisième dépôt", type: "STORE", fulfillsOnlineOrders: "on", pickupEnabled: "on", active: "on" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dépôt/);
  });

  it("une capacité manquante bloque l'action", async () => {
    state.caps = new Set(["orders.manage"]);
    expect(await upsertLocation(undefined, fd({ storeId: A, name: "X", type: "WAREHOUSE", fulfillsOnlineOrders: "on", pickupEnabled: "", active: "on" }))).toMatchObject({ ok: false });
  });
});

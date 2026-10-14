import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Clôture de caisse et rapport Z (lot 3 §2) — correctifs de la revue de la vague 3 :
 *  - majeur n° 9 : les remboursements rendus en espèces sur les ventes de la session sont déduits
 *    des espèces attendues ;
 *  - mineur n° 13 : la clôture vérifie l'APPAREIL (la session doit lui appartenir) et refuse de figer
 *    un rapport Z tant que l'appareil déclare des ventes en file.
 *  - bloquant n° 3 (côté appareil) : une vente refusée de façon récupérable reste en file et n'est plus
 *    comptée comme « synchronisable » : elle ne bloque pas la clôture mais est signalée au gérant.
 */

const state = vi.hoisted(() => ({ fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications/service", () => ({ notifyStore: vi.fn(async () => ({})) }));

import { closeSession, PosSessionError, sessionReport } from "@/lib/pos/session";
import { blockedSales, syncableSales, type QueuedSale } from "@/lib/pos/offline-store";

const STORE = "store_z_1";
const DEVICE = "device_z_1";
const OTHER_DEVICE = "device_z_2";
const SESSION = "session_z_1";

function seed(opts: { refund?: number; refundMethod?: string; refundStatus?: string } = {}) {
  state.fake = createFakeDb({
    store: [{ id: STORE, slug: "z", name: "Z", status: "PUBLISHED", currency: "XOF", country: "BJ" }],
    posDevice: [
      { id: DEVICE, storeId: STORE, name: "Tablette", locationId: "loc_1" },
      { id: OTHER_DEVICE, storeId: STORE, name: "Comptoir 2", locationId: "loc_1" },
    ],
    posSession: [{ id: SESSION, storeId: STORE, deviceId: DEVICE, locationId: "loc_1", status: "OPEN", openedById: "user_1", openingFloat: 20_000 }],
    order: [{ id: "order_z_1", storeId: STORE, posSessionId: SESSION, reference: "AX-Z1", total: 10_000, discount: 0, taxTotal: 0, priceSource: "server", createdAt: new Date() }],
    paymentAttempt: [{ id: "pa_1", orderId: "order_z_1", provider: "pos_cash", amount: 10_000, status: "CONFIRMED" }],
    refund: opts.refund
      ? [{ id: "ref_1", orderId: "order_z_1", amount: opts.refund, method: opts.refundMethod ?? "original", status: opts.refundStatus ?? "DONE" }]
      : [],
  });
}

beforeEach(() => seed());

describe("rapport Z : remboursements en espèces (majeur n° 9)", () => {
  it("déduit un remboursement rendu en espèces des espèces attendues", async () => {
    seed({ refund: 4_000 });
    const { report } = await sessionReport(STORE, SESSION);
    expect(report.cashRefunds).toBe(4_000);
    expect(report.expectedCash).toBe(26_000); // 20 000 + 10 000 − 4 000
  });

  it("ignore un remboursement rendu en AVOIR (il ne sort pas du tiroir)", async () => {
    seed({ refund: 4_000, refundMethod: "store_credit" });
    const { report } = await sessionReport(STORE, SESSION);
    expect(report.cashRefunds).toBe(0);
    expect(report.expectedCash).toBe(30_000);
  });

  it("ignore un remboursement non abouti", async () => {
    seed({ refund: 4_000, refundStatus: "REQUESTED" });
    const { report } = await sessionReport(STORE, SESSION);
    expect(report.cashRefunds).toBe(0);
  });

  it("le rapport figé à la clôture porte le même montant", async () => {
    seed({ refund: 4_000 });
    const report = await closeSession({ storeId: STORE, sessionId: SESSION, actorId: "user_1", countedCash: 26_000, deviceId: DEVICE });
    expect(report.cashRefunds).toBe(4_000);
    expect(report.discrepancy).toBe(0);
    expect(state.fake!.tables.posSession[0]).toMatchObject({ status: "CLOSED", expectedCash: 26_000, discrepancy: 0 });
  });
});

describe("clôture : appareil et file (mineur n° 13)", () => {
  it("refuse la clôture quand l'appareil déclare des ventes en file", async () => {
    await expect(closeSession({ storeId: STORE, sessionId: SESSION, actorId: "user_1", countedCash: 30_000, deviceId: DEVICE, pendingSales: 2 })).rejects.toBeInstanceOf(PosSessionError);
    expect(state.fake!.tables.posSession[0].status).toBe("OPEN");
  });

  it("refuse la clôture depuis un AUTRE appareil de la boutique", async () => {
    await expect(closeSession({ storeId: STORE, sessionId: SESSION, actorId: "user_1", countedCash: 30_000, deviceId: OTHER_DEVICE })).rejects.toBeInstanceOf(PosSessionError);
    expect(state.fake!.tables.posSession[0].status).toBe("OPEN");
  });

  it("accepte la clôture depuis le bon appareil, file vide", async () => {
    const report = await closeSession({ storeId: STORE, sessionId: SESSION, actorId: "user_1", countedCash: 30_000, deviceId: DEVICE, pendingSales: 0 });
    expect(report.expectedCash).toBe(30_000);
    expect(state.fake!.tables.posSession[0].status).toBe("CLOSED");
  });
});

describe("file hors ligne : ventes bloquées (bloquant n° 3)", () => {
  const sale = (key: string, lastError?: string): QueuedSale => ({
    idempotencyKey: key,
    sessionId: SESSION,
    items: [],
    payments: [],
    collectedTotal: 5_000,
    offlineCreatedAt: new Date().toISOString(),
    ...(lastError ? { lastError } : {}),
  });

  it("sépare les ventes encore synchronisables des ventes à régulariser", () => {
    const queue = [sale("a"), sale("b", "Cette session de caisse est fermée"), sale("c")];
    expect(syncableSales(queue).map((s) => s.idempotencyKey)).toEqual(["a", "c"]);
    expect(blockedSales(queue).map((s) => s.idempotencyKey)).toEqual(["b"]);
  });
});

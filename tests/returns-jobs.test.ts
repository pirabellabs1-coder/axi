import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ ret: null as any, existing: null as any, queued: [] as any[], notified: [] as any[], enqueued: [] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    returnRequest: { findUnique: async () => h.ret },
    notification: { findFirst: async () => h.existing },
  },
}));
vi.mock("@/lib/jobs", () => ({
  queueNotification: async (...args: any[]) => {
    h.queued.push(args);
  },
  enqueue: async (type: string) => {
    h.enqueued.push(type);
  },
}));
vi.mock("@/lib/notifications/service", () => ({
  notifyStore: async (storeId: string, n: any) => {
    h.notified.push({ storeId, ...n });
  },
}));

import { handleReturnStatusChanged, handlers } from "@/lib/returns/jobs";

const base = () => ({
  id: "ret_1", storeId: "store_1", reference: "RT-ABC123", requestedBy: "customer", resolution: "STORE_CREDIT", refundAmount: 10_000, storeCreditAmount: 11_000, rejectionReason: null,
  order: { id: "o1", reference: "AX-1", customerName: "Awa", customerEmail: "awa@example.com", trackingToken: "tok", currency: "XOF" },
  store: { name: "Dantokpa Mode", returnPolicy: { enabled: true, instructions: "Stand 214" } },
});

describe("job return.status_changed", () => {
  beforeEach(() => {
    h.ret = base();
    h.existing = null;
    h.queued = [];
    h.notified = [];
    h.enqueued = [];
  });

  it("est enregistré dans le registre paresseux", () => {
    expect(typeof handlers["return.status_changed"]).toBe("function");
  });

  it("nouvelle demande : notification interne du commerçant + e-mail acheteur", async () => {
    await handleReturnStatusChanged({ returnId: "ret_1", to: "REQUESTED" });
    expect(h.notified).toMatchObject([{ storeId: "store_1", key: "return:ret_1:REQUESTED", href: "/app/store_1/retours/ret_1" }]);
    expect(h.queued).toHaveLength(1);
    expect(h.queued[0][2]).toBe("awa@example.com");
    expect(h.enqueued).toEqual(["notification.send"]);
  });

  it("approbation : instructions de la boutique ; résolution : montant de l'avoir ; lien de suivi du retour", async () => {
    await handleReturnStatusChanged({ returnId: "ret_1", to: "APPROVED" });
    expect(h.queued[0][4].text).toContain("Stand 214");
    await handleReturnStatusChanged({ returnId: "ret_1", to: "RESOLVED" });
    expect(h.queued[1][4].text).toMatch(/Avoir de 11\s000/);
    expect(h.queued[1][4].text).toContain("/suivi/tok/retour");
    expect(h.notified).toHaveLength(0);
  });

  it("idempotent (retentative) et sans e-mail : rien n'est envoyé", async () => {
    h.existing = { id: "n1" };
    await handleReturnStatusChanged({ returnId: "ret_1", to: "APPROVED" });
    expect(h.queued).toHaveLength(0);
    h.existing = null;
    h.ret = { ...base(), order: { ...base().order, customerEmail: null } };
    await handleReturnStatusChanged({ returnId: "ret_1", to: "APPROVED" });
    expect(h.queued).toHaveLength(0);
    await handleReturnStatusChanged({ returnId: "ret_1", to: "PAS_UN_STATUT" });
    expect(h.queued).toHaveLength(0);
  });
});

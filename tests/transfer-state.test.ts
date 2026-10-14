import { describe, it, expect } from "vitest";
import { canTransitionTransfer, nextTransferStatuses, receivePlan, validateTransferDraft, TRANSFER_STATUS_LABELS, type TransferStatusValue } from "@/lib/inventory/transfer";

/** Machine d'états des transferts de stock (lot 3 §1.1) — module pur. */

const ALL: TransferStatusValue[] = ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];

describe("canTransitionTransfer", () => {
  it("suit exactement le diagramme de la spec", () => {
    expect(canTransitionTransfer("DRAFT", "IN_TRANSIT")).toBe(true);
    expect(canTransitionTransfer("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransitionTransfer("IN_TRANSIT", "RECEIVED")).toBe(true);
    expect(canTransitionTransfer("IN_TRANSIT", "CANCELLED")).toBe(true);
  });

  it("refuse les raccourcis et les retours en arrière", () => {
    expect(canTransitionTransfer("DRAFT", "RECEIVED")).toBe(false);
    expect(canTransitionTransfer("IN_TRANSIT", "DRAFT")).toBe(false);
    expect(canTransitionTransfer("RECEIVED", "IN_TRANSIT")).toBe(false);
  });

  it("RECEIVED et CANCELLED sont terminaux", () => {
    for (const to of ALL) {
      expect(canTransitionTransfer("RECEIVED", to)).toBe(false);
      expect(canTransitionTransfer("CANCELLED", to)).toBe(false);
    }
    expect(nextTransferStatuses("RECEIVED")).toEqual([]);
  });

  it("chaque état a un libellé français", () => {
    for (const status of ALL) expect(TRANSFER_STATUS_LABELS[status].length).toBeGreaterThan(2);
  });
});

describe("receivePlan", () => {
  const items = [
    { id: "it1", productId: "p1", variantId: null, quantity: 5 },
    { id: "it2", productId: "p2", variantId: "v2", quantity: 2 },
  ];

  it("sans saisie, tout est considéré reçu", () => {
    const plan = receivePlan(items, new Map());
    expect(plan.totalMissing).toBe(0);
    expect(plan.lines.map((l) => l.received)).toEqual([5, 2]);
  });

  it("borne les quantités reçues à ce qui a été expédié", () => {
    const plan = receivePlan(items, new Map([["it1", 99]]));
    expect(plan.lines[0].received).toBe(5);
    expect(plan.lines[0].missing).toBe(0);
  });

  it("calcule l'écart à déclarer en perte", () => {
    const plan = receivePlan(items, new Map([["it1", 3], ["it2", 0]]));
    expect(plan.lines[0]).toMatchObject({ received: 3, missing: 2 });
    expect(plan.lines[1]).toMatchObject({ received: 0, missing: 2 });
    expect(plan.totalMissing).toBe(4);
  });

  it("une saisie invalide vaut zéro reçu (jamais de quantité négative)", () => {
    const plan = receivePlan(items, new Map([["it1", -4]]));
    expect(plan.lines[0].received).toBe(0);
    expect(plan.lines[0].missing).toBe(5);
  });
});

describe("validateTransferDraft", () => {
  it("refuse un transfert vers le même dépôt", () => {
    expect(validateTransferDraft({ fromLocationId: "a", toLocationId: "a", items: [{ quantity: 1 }] })).toMatch(/différents/);
  });

  it("refuse un transfert sans ligne positive", () => {
    expect(validateTransferDraft({ fromLocationId: "a", toLocationId: "b", items: [{ quantity: 0 }] })).toMatch(/au moins un article/);
  });

  it("accepte un transfert valide", () => {
    expect(validateTransferDraft({ fromLocationId: "a", toLocationId: "b", items: [{ quantity: 3 }] })).toBeNull();
  });
});

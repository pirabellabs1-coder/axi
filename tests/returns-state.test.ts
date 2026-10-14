import { describe, it, expect } from "vitest";
import type { ReturnStatus } from "@prisma/client";
import { canActorTransitionReturn, canTransitionReturn, initialReturnStatusAllowed, isTerminalReturn, RETURN_STATUSES, nextReturnStatuses } from "@/lib/returns/state";
import { orderEligibility, parseReturnPolicy, DEFAULT_RETURN_POLICY, isItemReturnable, remainingQuantities, buyerResolutions, parseTagList } from "@/lib/returns/policy";

const ALLOWED: [ReturnStatus, ReturnStatus][] = [
  ["REQUESTED", "APPROVED"],
  ["REQUESTED", "REJECTED"],
  ["REQUESTED", "CANCELLED"],
  ["APPROVED", "RECEIVED"],
  ["APPROVED", "CANCELLED"],
  ["RECEIVED", "RESOLVED"],
];

describe("machine d'états des retours", () => {
  it("n'autorise que les transitions du diagramme", () => {
    for (const from of RETURN_STATUSES) {
      for (const to of RETURN_STATUSES) {
        const expected = ALLOWED.some(([a, b]) => a === from && b === to);
        expect(canTransitionReturn(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it("états terminaux : RESOLVED, REJECTED, CANCELLED", () => {
    expect(RETURN_STATUSES.filter(isTerminalReturn).sort()).toEqual(["CANCELLED", "REJECTED", "RESOLVED"]);
    expect(nextReturnStatuses("RESOLVED")).toEqual([]);
  });

  it("l'acheteur ne peut qu'annuler une demande en attente", () => {
    expect(canActorTransitionReturn("REQUESTED", "CANCELLED", "customer")).toBe(true);
    expect(canActorTransitionReturn("APPROVED", "CANCELLED", "customer")).toBe(false);
    expect(canActorTransitionReturn("REQUESTED", "APPROVED", "customer")).toBe(false);
    expect(canActorTransitionReturn("APPROVED", "CANCELLED", "merchant")).toBe(true);
    expect(canActorTransitionReturn("RECEIVED", "CANCELLED", "merchant")).toBe(false);
  });

  it("statuts initiaux : demande acheteur REQUESTED ; commerçant APPROVED ou RECEIVED", () => {
    expect(initialReturnStatusAllowed("REQUESTED", "customer")).toBe(true);
    expect(initialReturnStatusAllowed("RECEIVED", "customer")).toBe(false);
    expect(initialReturnStatusAllowed("APPROVED", "merchant")).toBe(true);
    expect(initialReturnStatusAllowed("RECEIVED", "merchant")).toBe(true);
    expect(initialReturnStatusAllowed("REQUESTED", "merchant")).toBe(false);
    expect(initialReturnStatusAllowed("RESOLVED", "merchant")).toBe(false);
  });
});

describe("politique et éligibilité", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const policy = parseReturnPolicy({ enabled: true, windowDays: 7 });

  it("valeurs par défaut et politique invalide → désactivée", () => {
    expect(parseReturnPolicy(null)).toEqual(DEFAULT_RETURN_POLICY);
    expect(parseReturnPolicy({ enabled: true, windowDays: 500 })).toEqual(DEFAULT_RETURN_POLICY);
    expect(parseReturnPolicy({ enabled: true, storeCreditBonusPercent: 25 }).enabled).toBe(false);
    expect(parseReturnPolicy({ enabled: true, restockingFeePercent: 30 }).restockingFeePercent).toBe(30);
  });

  it("commande livrée dans la fenêtre uniquement (bornes incluses)", () => {
    const at = (days: number) => new Date(now.getTime() - days * 86_400_000);
    expect(orderEligibility({ status: "DELIVERED", deliveredAt: at(7) }, policy, now).ok).toBe(true);
    expect(orderEligibility({ status: "DELIVERED", deliveredAt: new Date(at(7).getTime() - 1000) }, policy, now)).toMatchObject({ ok: false, code: "expired" });
    expect(orderEligibility({ status: "OUT_FOR_DELIVERY", deliveredAt: null }, policy, now)).toMatchObject({ ok: false, code: "not_delivered" });
    expect(orderEligibility({ status: "DELIVERED", deliveredAt: at(1) }, { ...policy, enabled: false }, now)).toMatchObject({ ok: false, code: "disabled" });
    // Commerçant (retour en boutique) : seule la livraison compte.
    expect(orderEligibility({ status: "DELIVERED", deliveredAt: at(60) }, { ...policy, enabled: false }, now, { merchant: true }).ok).toBe(true);
  });

  it("cartes cadeaux et étiquettes non retournables exclues (casse ignorée)", () => {
    const p = { ...policy, nonReturnableTags: ["Soldes"] };
    expect(isItemReturnable({ isGiftCard: true }, p)).toBe(false);
    expect(isItemReturnable({ isGiftCard: false, productTags: [" soldes "] }, p)).toBe(false);
    expect(isItemReturnable({ isGiftCard: false, productTags: ["wax"] }, p)).toBe(true);
    expect(isItemReturnable({ isGiftCard: false, productTags: null }, p)).toBe(true); // produit supprimé
  });

  it("quantité restante : retours annulés ou refusés libèrent les unités", () => {
    const items = [{ id: "a", quantity: 3 }, { id: "b", quantity: 1 }];
    const rem = remainingQuantities(items, [
      { orderItemId: "a", quantity: 1, status: "RESOLVED", returnId: "r1" },
      { orderItemId: "a", quantity: 1, status: "CANCELLED", returnId: "r2" },
      { orderItemId: "a", quantity: 1, status: "REJECTED", returnId: "r3" },
      { orderItemId: "b", quantity: 1, status: "REQUESTED", returnId: "r4" },
    ]);
    expect(rem.get("a")).toBe(2);
    expect(rem.get("b")).toBe(0);
  });

  it("résolutions proposées et étiquettes", () => {
    expect(buyerResolutions({ ...policy, allowRefund: false })).toEqual(["STORE_CREDIT", "EXCHANGE"]);
    expect(parseTagList("soldes, Soldes ,, lingerie\nsoldes")).toEqual(["soldes", "Soldes", "lingerie"]);
  });
});

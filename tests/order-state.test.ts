import { describe, it, expect } from "vitest";
import { canTransition, nextStatuses, ACTIVE_STATUSES, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/commerce/order-state";

describe("machine d'états commande", () => {
  it("transitions valides du flux nominal", () => {
    expect(canTransition("NEW", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "PREPARING")).toBe(true);
    expect(canTransition("CONFIRMED", "READY")).toBe(true);
    expect(canTransition("PREPARING", "READY")).toBe(true);
    expect(canTransition("READY", "OUT_FOR_DELIVERY")).toBe(true);
    expect(canTransition("READY", "DELIVERED")).toBe(true);
    expect(canTransition("OUT_FOR_DELIVERY", "DELIVERED")).toBe(true);
    expect(canTransition("DELIVERED", "REFUNDED")).toBe(true);
  });
  it("annulation possible avant la livraison, pas après", () => {
    for (const s of ["NEW", "CONFIRMED", "PREPARING", "READY"] as const) expect(canTransition(s, "CANCELLED")).toBe(true);
    expect(canTransition("OUT_FOR_DELIVERY", "CANCELLED")).toBe(false);
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
  });
  it("échec de livraison : retour à READY", () => {
    expect(canTransition("OUT_FOR_DELIVERY", "READY")).toBe(true);
  });
  it("transitions invalides (sauts et retours en arrière)", () => {
    expect(canTransition("NEW", "DELIVERED")).toBe(false);
    expect(canTransition("NEW", "PREPARING")).toBe(false);
    expect(canTransition("CONFIRMED", "NEW")).toBe(false);
    expect(canTransition("READY", "CONFIRMED")).toBe(false);
    expect(canTransition("NEW", "REFUNDED")).toBe(false);
    expect(canTransition("NEW", "NEW")).toBe(false);
  });
  it("états terminaux sans sortie", () => {
    expect(nextStatuses("CANCELLED")).toEqual([]);
    expect(nextStatuses("REFUNDED")).toEqual([]);
    expect(canTransition("CANCELLED", "NEW")).toBe(false);
    expect(canTransition("REFUNDED", "DELIVERED")).toBe(false);
  });
  it("nextStatuses reflète la table", () => {
    expect(nextStatuses("NEW")).toEqual(["CONFIRMED", "CANCELLED"]);
    expect(nextStatuses("DELIVERED")).toEqual(["REFUNDED"]);
  });
  it("statuts actifs = non terminés", () => {
    expect(ACTIVE_STATUSES).not.toContain("DELIVERED");
    expect(ACTIVE_STATUSES).not.toContain("CANCELLED");
    expect(ACTIVE_STATUSES).not.toContain("REFUNDED");
    expect(ACTIVE_STATUSES).toContain("NEW");
  });
  it("chaque statut a un libellé français", () => {
    for (const s of Object.keys(ORDER_STATUS_LABELS)) expect(ORDER_STATUS_LABELS[s as keyof typeof ORDER_STATUS_LABELS]).toBeTruthy();
    expect(PAYMENT_STATUS_LABELS.PAID).toBe("Payée");
  });
});

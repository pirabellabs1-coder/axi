import { describe, it, expect } from "vitest";
import {
  applyCarrierStatus,
  canTransitionShipment,
  fulfillmentStatusOf,
  isTerminalShipmentStatus,
  orderStatusFromShipments,
  remainingToShip,
  shippedByItem,
  SHIPMENT_RANK,
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatusValue,
} from "@/lib/shipping/state";
import { mapCarrierStatus, normalizeCarrierCode } from "@/lib/carriers/status-map";

/** Machine d'états des expéditions (lot 3 §1.2) : transitions, non-rétrogradation, avancement commande. */

const ALL: ShipmentStatusValue[] = ["PENDING", "LABEL_CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_ATTEMPT", "RETURNED", "CANCELLED"];

describe("canTransitionShipment", () => {
  it("suit le chemin nominal", () => {
    expect(canTransitionShipment("PENDING", "LABEL_CREATED")).toBe(true);
    expect(canTransitionShipment("LABEL_CREATED", "PICKED_UP")).toBe(true);
    expect(canTransitionShipment("PICKED_UP", "IN_TRANSIT")).toBe(true);
    expect(canTransitionShipment("IN_TRANSIT", "OUT_FOR_DELIVERY")).toBe(true);
    expect(canTransitionShipment("OUT_FOR_DELIVERY", "DELIVERED")).toBe(true);
  });

  it("gère l'échec de livraison : nouvelle tentative ou retour", () => {
    expect(canTransitionShipment("OUT_FOR_DELIVERY", "FAILED_ATTEMPT")).toBe(true);
    expect(canTransitionShipment("FAILED_ATTEMPT", "OUT_FOR_DELIVERY")).toBe(true);
    expect(canTransitionShipment("FAILED_ATTEMPT", "RETURNED")).toBe(true);
    expect(canTransitionShipment("FAILED_ATTEMPT", "DELIVERED")).toBe(false);
  });

  it("n'annule que ce qui n'est pas parti", () => {
    expect(canTransitionShipment("PENDING", "CANCELLED")).toBe(true);
    expect(canTransitionShipment("LABEL_CREATED", "CANCELLED")).toBe(true);
    expect(canTransitionShipment("PICKED_UP", "CANCELLED")).toBe(false);
    expect(canTransitionShipment("IN_TRANSIT", "CANCELLED")).toBe(false);
  });

  it("DELIVERED, RETURNED et CANCELLED sont terminaux", () => {
    for (const status of ["DELIVERED", "RETURNED", "CANCELLED"] as ShipmentStatusValue[]) {
      expect(isTerminalShipmentStatus(status)).toBe(true);
      for (const to of ALL) expect(canTransitionShipment(status, to)).toBe(false);
    }
  });

  it("chaque état a un libellé et un rang", () => {
    for (const status of ALL) {
      expect(SHIPMENT_STATUS_LABELS[status].length).toBeGreaterThan(2);
      expect(Number.isInteger(SHIPMENT_RANK[status])).toBe(true);
    }
  });
});

describe("applyCarrierStatus (non-rétrogradation)", () => {
  it("un événement tardif ne fait pas reculer l'expédition", () => {
    expect(applyCarrierStatus("OUT_FOR_DELIVERY", "IN_TRANSIT")).toBeNull();
    expect(applyCarrierStatus("IN_TRANSIT", "PICKED_UP")).toBeNull();
    expect(applyCarrierStatus("IN_TRANSIT", "LABEL_CREATED")).toBeNull();
  });

  it("un rejeu du même statut est ignoré", () => {
    expect(applyCarrierStatus("IN_TRANSIT", "IN_TRANSIT")).toBeNull();
  });

  it("accepte un saut d'étape vers l'avant (transporteurs peu bavards)", () => {
    expect(applyCarrierStatus("LABEL_CREATED", "DELIVERED")).toBe("DELIVERED");
    expect(applyCarrierStatus("PENDING", "IN_TRANSIT")).toBe("IN_TRANSIT");
  });

  it("n'altère jamais une expédition dans un état terminal", () => {
    expect(applyCarrierStatus("DELIVERED", "IN_TRANSIT")).toBeNull();
    expect(applyCarrierStatus("DELIVERED", "RETURNED")).toBeNull();
    expect(applyCarrierStatus("CANCELLED", "DELIVERED")).toBeNull();
  });

  it("entre rangs égaux, seule une transition déclarée passe", () => {
    expect(applyCarrierStatus("OUT_FOR_DELIVERY", "FAILED_ATTEMPT")).toBe("FAILED_ATTEMPT");
    expect(applyCarrierStatus("FAILED_ATTEMPT", "OUT_FOR_DELIVERY")).toBe("OUT_FOR_DELIVERY");
  });

  it("une annulation du transporteur n'est acceptée que si elle est permise", () => {
    expect(applyCarrierStatus("PENDING", "CANCELLED")).toBe("CANCELLED");
    expect(applyCarrierStatus("IN_TRANSIT", "CANCELLED")).toBeNull();
  });
});

describe("mapCarrierStatus", () => {
  it("normalise les codes fournisseurs", () => {
    expect(normalizeCarrierCode(" Out-For Delivery ")).toBe("out_for_delivery");
    expect(mapCarrierStatus("gozem", "Out-For-Delivery")).toBe("OUT_FOR_DELIVERY");
  });

  it("connaît les codes propres à chaque transporteur", () => {
    expect(mapCarrierStatus("dhl", "OK")).toBe("DELIVERED");
    expect(mapCarrierStatus("yango", "performer_found")).toBe("LABEL_CREATED");
    expect(mapCarrierStatus("laposte_bj", "distribue")).toBe("DELIVERED");
    expect(mapCarrierStatus("gozem", "client_absent")).toBe("FAILED_ATTEMPT");
  });

  it("un code inconnu ne produit aucune transition", () => {
    expect(mapCarrierStatus("dhl", "zzz")).toBeNull();
    expect(mapCarrierStatus("gozem", "")).toBeNull();
  });
});

describe("avancement de la commande", () => {
  const items = [
    { orderItemId: "i1", quantity: 2 },
    { orderItemId: "i2", quantity: 1 },
  ];

  it("UNFULFILLED sans expédition", () => {
    expect(fulfillmentStatusOf(items, [])).toBe("UNFULFILLED");
  });

  it("PARTIAL quand une partie est expédiée", () => {
    expect(fulfillmentStatusOf(items, [{ orderItemId: "i1", quantity: 1, status: "IN_TRANSIT" }])).toBe("PARTIAL");
  });

  it("FULFILLED quand tout est expédié", () => {
    expect(
      fulfillmentStatusOf(items, [
        { orderItemId: "i1", quantity: 2, status: "IN_TRANSIT" },
        { orderItemId: "i2", quantity: 1, status: "DELIVERED" },
      ]),
    ).toBe("FULFILLED");
  });

  it("une expédition annulée rend ses unités de nouveau expédiables", () => {
    const shipmentItems = [
      { orderItemId: "i1", quantity: 2, status: "CANCELLED" as ShipmentStatusValue },
      { orderItemId: "i2", quantity: 1, status: "PENDING" as ShipmentStatusValue },
    ];
    expect(shippedByItem(shipmentItems).get("i1")).toBeUndefined();
    expect(fulfillmentStatusOf(items, shipmentItems)).toBe("PARTIAL");
  });

  it("remainingToShip n'est jamais négatif", () => {
    expect(remainingToShip(2, 5)).toBe(0);
    expect(remainingToShip(5, 2)).toBe(3);
  });

  it("toutes les expéditions livrées → commande livrée", () => {
    expect(orderStatusFromShipments(["DELIVERED", "DELIVERED"])).toBe("DELIVERED");
    expect(orderStatusFromShipments(["DELIVERED", "CANCELLED"])).toBe("DELIVERED");
  });

  it("une expédition en cours de livraison → commande en livraison", () => {
    expect(orderStatusFromShipments(["OUT_FOR_DELIVERY", "PENDING"])).toBe("OUT_FOR_DELIVERY");
  });

  it("sinon, aucun changement de statut de commande", () => {
    expect(orderStatusFromShipments(["PENDING"])).toBeNull();
    expect(orderStatusFromShipments([])).toBeNull();
    expect(orderStatusFromShipments(["CANCELLED"])).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { allocateLocations, allocatedByLine, preferredLocation, type LocationAvailability } from "@/lib/inventory/allocate";

/**
 * Affectation d'une commande aux dépôts (lot 3 §1.1) — module pur.
 * Priorités : dépôt de la zone, dépôt de retrait, dépôt par défaut, puis dépôt qui couvre le plus.
 * Invariant vérifié partout : Σ quantités affectées = quantité commandée.
 */

const WAREHOUSE = "loc_warehouse";
const SHOP = "loc_shop";
const PICKUP = "loc_pickup";

function locations(map: Record<string, Record<string, number>>, opts: Record<string, boolean> = {}): LocationAvailability[] {
  return Object.entries(map).map(([locationId, items]) => ({
    locationId,
    available: new Map(Object.entries(items)),
    fulfillsOnlineOrders: opts[locationId] ?? true,
  }));
}

describe("preferredLocation", () => {
  it("retient le dépôt de la zone quand il couvre la quantité", () => {
    const avail = locations({ [WAREHOUSE]: { p1: 10 }, [SHOP]: { p1: 3 } });
    expect(preferredLocation(avail, "p1", 3, { zoneLocationId: SHOP, defaultLocationId: WAREHOUSE })).toBe(SHOP);
  });

  it("ignore le dépôt de la zone s'il ne couvre pas, et passe au dépôt par défaut", () => {
    const avail = locations({ [WAREHOUSE]: { p1: 10 }, [SHOP]: { p1: 1 } });
    expect(preferredLocation(avail, "p1", 3, { zoneLocationId: SHOP, defaultLocationId: WAREHOUSE })).toBe(WAREHOUSE);
  });

  it("retient le dépôt de retrait avant le dépôt par défaut", () => {
    const avail = locations({ [WAREHOUSE]: { p1: 10 }, [PICKUP]: { p1: 5 } });
    expect(preferredLocation(avail, "p1", 4, { pickupLocationId: PICKUP, defaultLocationId: WAREHOUSE })).toBe(PICKUP);
  });

  it("à défaut, retient le dépôt qui couvre le plus", () => {
    const avail = locations({ [WAREHOUSE]: { p1: 2 }, [SHOP]: { p1: 4 }, [PICKUP]: { p1: 1 } });
    expect(preferredLocation(avail, "p1", 9, {})).toBe(SHOP);
  });

  it("aucun dépôt ne détient l'article : repli sur la priorité déclarée", () => {
    const avail = locations({ [WAREHOUSE]: {}, [SHOP]: {} });
    expect(preferredLocation(avail, "p1", 2, { defaultLocationId: WAREHOUSE })).toBe(WAREHOUSE);
  });
});

describe("allocateLocations", () => {
  it("affecte la ligne au dépôt de la zone", () => {
    const result = allocateLocations([{ lineId: "0", itemKey: "p1", quantity: 2 }], locations({ [WAREHOUSE]: { p1: 10 }, [SHOP]: { p1: 5 } }), { zoneLocationId: SHOP, defaultLocationId: WAREHOUSE });
    expect(result).toEqual([{ lineId: "0", locationId: SHOP, quantity: 2 }]);
  });

  it("répartit une ligne entre dépôts quand un seul ne suffit pas", () => {
    const result = allocateLocations([{ lineId: "0", itemKey: "p1", quantity: 7 }], locations({ [SHOP]: { p1: 4 }, [WAREHOUSE]: { p1: 5 } }), { zoneLocationId: SHOP, defaultLocationId: WAREHOUSE });
    // Le dépôt préféré (le mieux fourni ici) donne tout ce qu'il a, le reste vient de l'autre.
    expect(allocatedByLine(result).get("0")).toBe(7);
    expect(result.length).toBe(2);
  });

  it("stock insuffisant partout : le reliquat est porté par le dépôt préféré (niveau négatif possible)", () => {
    const result = allocateLocations([{ lineId: "0", itemKey: "p1", quantity: 10 }], locations({ [SHOP]: { p1: 2 }, [WAREHOUSE]: { p1: 3 } }), { zoneLocationId: SHOP, defaultLocationId: WAREHOUSE });
    expect(allocatedByLine(result).get("0")).toBe(10);
    // Le dépôt de la zone ne couvre pas : le préféré devient celui qui couvre le plus (l'entrepôt),
    // qui prend son stock (3) PLUS le reliquat (5) ; son niveau pourra devenir négatif.
    const warehouse = result.filter((r) => r.locationId === WAREHOUSE).reduce((s, r) => s + r.quantity, 0);
    const shop = result.filter((r) => r.locationId === SHOP).reduce((s, r) => s + r.quantity, 0);
    expect(warehouse).toBe(8);
    expect(shop).toBe(2);
  });

  it("deux lignes du même article consomment le stock l'une après l'autre", () => {
    const result = allocateLocations(
      [
        { lineId: "0", itemKey: "p1", quantity: 3 },
        { lineId: "1", itemKey: "p1", quantity: 3 },
      ],
      locations({ [SHOP]: { p1: 4 }, [WAREHOUSE]: { p1: 10 } }),
      { zoneLocationId: SHOP, defaultLocationId: WAREHOUSE },
    );
    const byLine = allocatedByLine(result);
    expect(byLine.get("0")).toBe(3);
    expect(byLine.get("1")).toBe(3);
    // La seconde ligne ne peut plus prendre 3 unités au magasin (il n'en reste qu'une).
    const shopTotal = result.filter((r) => r.locationId === SHOP).reduce((s, r) => s + r.quantity, 0);
    expect(shopTotal).toBeLessThanOrEqual(4);
  });

  it("ignore les articles sans suivi de stock et les quantités nulles", () => {
    const result = allocateLocations(
      [
        { lineId: "0", itemKey: "p1", quantity: 2, trackStock: false },
        { lineId: "1", itemKey: "p2", quantity: 0 },
      ],
      locations({ [WAREHOUSE]: { p1: 5, p2: 5 } }),
      { defaultLocationId: WAREHOUSE },
    );
    expect(result).toEqual([]);
  });

  it("écarte un dépôt qui ne sert pas les commandes en ligne (sauf s'il est le dépôt préféré)", () => {
    const avail = locations({ [WAREHOUSE]: { p1: 1 }, [SHOP]: { p1: 50 } }, { [SHOP]: false });
    const result = allocateLocations([{ lineId: "0", itemKey: "p1", quantity: 3 }], avail, { defaultLocationId: WAREHOUSE });
    expect(result.every((r) => r.locationId === WAREHOUSE)).toBe(true);
    expect(allocatedByLine(result).get("0")).toBe(3);
  });

  it("aucun dépôt : aucune affectation (boutique non migrée, aucune régression)", () => {
    expect(allocateLocations([{ lineId: "0", itemKey: "p1", quantity: 2 }], [], {})).toEqual([]);
  });

  it("résultat déterministe (deux appels identiques donnent le même plan)", () => {
    const build = () => allocateLocations([{ lineId: "0", itemKey: "p1", quantity: 6 }], locations({ [WAREHOUSE]: { p1: 3 }, [SHOP]: { p1: 3 }, [PICKUP]: { p1: 3 } }), {});
    expect(build()).toEqual(build());
  });
});

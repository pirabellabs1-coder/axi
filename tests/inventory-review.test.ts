import { describe, it, expect } from "vitest";
import { lowStockCrossing, oversoldCrossing, thresholdSince } from "@/lib/inventory/policy";
import { canDecrement, quickStockTarget, sanitizeStockInput, stepStock } from "@/lib/inventory/quick-stock";
import { restockPlan } from "@/lib/commerce/restock";
import { checkQuantity } from "@/lib/commerce/pricing";

/** Corrections de revue : seuil relevé, survente puis réassort, ajustement rapide négatif, restock, fuite du stock. */

const at = (iso: string) => new Date(`2026-10-${iso}T10:00:00Z`);

describe("seuil relevé avec un historique : pas d'alerte rétroactive", () => {
  // Du plus récent au plus ancien : 10 → vente -4 (6, le 03) → vente -3 (3, le 05).
  const moves = [
    { id: "m_sale3", delta: -3, createdAt: at("05") },
    { id: "m_sale4", delta: -4, createdAt: at("03") },
    { id: "m_init", delta: 10, createdAt: at("01") },
  ];

  it("sans changement de seuil : le passage sous 5 est retenu", () => {
    expect(lowStockCrossing(3, moves, 5)).toBe("m_sale3");
  });

  it("seuil relevé à 8 le 06 : le passage sous 8 (le 03) est antérieur → aucune alerte", () => {
    expect(lowStockCrossing(3, moves, 8, { since: at("06") })).toBeNull();
  });

  it("un nouveau passage APRÈS le changement de seuil est retenu", () => {
    const later = [{ id: "m_restock", delta: 10, createdAt: at("07") }, ...moves]; // 13
    const again = [{ id: "m_sale9", delta: -9, createdAt: at("08") }, ...later]; // 4
    expect(lowStockCrossing(4, again, 8, { since: at("06") })).toBe("m_sale9");
  });

  it("thresholdSince : seuil propre → son horodatage ; seuil boutique → le plus récent des deux", () => {
    expect(thresholdSince({ lowStockThreshold: 3, lowStockThresholdChangedAt: at("02") }, at("09"))).toEqual(at("02"));
    expect(thresholdSince({ lowStockThreshold: null, lowStockThresholdChangedAt: at("02") }, at("09"))).toEqual(at("09"));
    expect(thresholdSince({ lowStockThreshold: null, lowStockThresholdChangedAt: at("09") }, at("02"))).toEqual(at("09"));
    expect(thresholdSince({ lowStockThreshold: null, lowStockThresholdChangedAt: null }, null)).toBeNull();
  });
});

describe("survente puis réassort", () => {
  it("passage direct en négatif : survente seulement, jamais « stock bas »", () => {
    const h = [{ id: "m_sale12", delta: -12 }, { id: "m_init", delta: 10 }]; // 10 → -2
    expect(oversoldCrossing(-2, h)).toBe("m_sale12");
    expect(lowStockCrossing(-2, h, 5)).toBeNull();
  });

  it("réassort partiel (toujours sous le seuil) : pas d'alerte stock bas pour l'ancien passage en négatif", () => {
    const h = [{ id: "m_restock4", delta: 4 }, { id: "m_sale12", delta: -12 }, { id: "m_init", delta: 10 }]; // -2 → 2
    expect(lowStockCrossing(2, h, 5)).toBeNull();
    expect(oversoldCrossing(2, h)).toBeNull();
  });

  it("réassort au-dessus du seuil puis nouvelle baisse : nouvelle alerte stock bas", () => {
    const h = [{ id: "m_sale8", delta: -8 }, { id: "m_restock10", delta: 10 }, { id: "m_restock4", delta: 4 }, { id: "m_sale12", delta: -12 }, { id: "m_init", delta: 10 }]; // 2 → 12 → 4
    expect(lowStockCrossing(4, h, 5)).toBe("m_sale8");
  });
});

describe("QuickStock sur un stock négatif", () => {
  it("affiche le signe et le conserve à la saisie", () => {
    expect(sanitizeStockInput("-2")).toBe("-2");
    expect(sanitizeStockInput("-2a-1")).toBe("-21");
    expect(sanitizeStockInput("1-2")).toBe("12");
  });

  it("« + » remonte depuis le négatif ; « − » désactivé à zéro ou moins", () => {
    expect(stepStock("-2", 1)).toBe("-1");
    expect(stepStock("0", 1)).toBe("1");
    expect(stepStock("-2", -1)).toBe("-2");
    expect(stepStock("3", -1)).toBe("2");
    expect(canDecrement("-2")).toBe(false);
    expect(canDecrement("0")).toBe(false);
    expect(canDecrement("1")).toBe(true);
  });

  it("valeur enregistrable : hausse depuis le négatif oui, baisse dans le négatif non", () => {
    expect(quickStockTarget("-1", -2)).toBe(-1);
    expect(quickStockTarget("5", -2)).toBe(5);
    expect(quickStockTarget("-3", -2)).toBeNull();
    expect(quickStockTarget("-2", -2)).toBeNull();
    expect(quickStockTarget("-", -2)).toBeNull();
  });
});

describe("restock : variante supprimée depuis la vente", () => {
  it("vente sans variantId alors que la ligne portait une variante : ignorée", () => {
    const moves = [{ productId: "p1", variantId: null, delta: -2 }];
    expect(restockPlan(moves, [{ productId: "p1", variantName: "M / Bleu" }])).toEqual([]);
    expect(restockPlan(moves, [{ productId: "p1", variantName: null }])).toEqual([{ productId: "p1", variantId: null, quantity: 2 }]);
  });
});

describe("fuite du stock exact", () => {
  it("thème sans affichage du stock : message générique, jamais la quantité restante", () => {
    const item = { name: "Robe", minQty: 1, trackStock: true, stock: 3 };
    expect(checkQuantity(item, 5)).toMatch(/Il ne reste que 3/);
    const hidden = checkQuantity(item, 5, { revealStock: false });
    expect(hidden).toBe("Quantité demandée indisponible pour Robe.");
    expect(hidden).not.toMatch(/3/);
  });
});

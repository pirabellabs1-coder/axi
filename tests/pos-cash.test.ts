import { describe, it, expect } from "vitest";
import {
  buildZReport,
  cashDiscrepancy,
  cashPayable,
  changeDue,
  checkPayments,
  discountAllowed,
  discountAmount,
  discountCapMessage,
  expectedCash,
  isPaymentKind,
  roundCash,
  settlePayments,
  CASH_ROUNDING_STEP,
  MAX_DISCOUNT_PERCENT,
} from "@/lib/pos/cash";

/** Caisse : espèces, rendu de monnaie, plafonds de remise et rapport Z (lot 3 §2). */

describe("arrondi des espèces", () => {
  it("arrondit au multiple de 5 FCFA le plus proche", () => {
    expect(roundCash(1_002)).toBe(1_000);
    expect(roundCash(1_003)).toBe(1_005);
    expect(roundCash(1_007, CASH_ROUNDING_STEP)).toBe(1_005);
    expect(roundCash(0)).toBe(0);
  });

  it("l'arrondi ne s'applique que si le réglage est actif", () => {
    expect(cashPayable(1_003, true)).toBe(1_005);
    expect(cashPayable(1_003, false)).toBe(1_003);
  });

  it("rendu de monnaie jamais négatif", () => {
    expect(changeDue(1_000, 2_000)).toBe(1_000);
    expect(changeDue(1_000, 500)).toBe(0);
  });
});

describe("clôture de caisse", () => {
  it("espèces attendues = fond + encaissements + entrées − rendus − sorties", () => {
    expect(expectedCash({ openingFloat: 10_000, cashSales: 45_000, cashRefunds: 2_000, cashIn: 1_000, cashOut: 5_000 })).toBe(49_000);
  });

  it("écart = compté − attendu", () => {
    expect(cashDiscrepancy(48_500, 49_000)).toBe(-500);
    expect(cashDiscrepancy(49_000, 49_000)).toBe(0);
  });
});

describe("plafonds de remise par rôle", () => {
  it("STAFF ≤ 10 %, MANAGER ≤ 50 %, OWNER sans limite pratique", () => {
    expect(MAX_DISCOUNT_PERCENT.STAFF).toBe(10);
    expect(MAX_DISCOUNT_PERCENT.MANAGER).toBe(50);
    expect(discountAllowed("STAFF", 10)).toBe(true);
    expect(discountAllowed("STAFF", 11)).toBe(false);
    expect(discountAllowed("MANAGER", 50)).toBe(true);
    expect(discountAllowed("MANAGER", 51)).toBe(false);
    expect(discountAllowed("OWNER", 100)).toBe(true);
    expect(discountAllowed("SUPPORT", 1)).toBe(false);
    expect(discountCapMessage("STAFF")).toMatch(/10 %/);
  });

  it("montant de remise borné au sous-total et arrondi à l'entier", () => {
    expect(discountAmount(10_000, 10)).toBe(1_000);
    expect(discountAmount(3_333, 10)).toBe(333);
    expect(discountAmount(1_000, 150)).toBe(1_000);
    expect(discountAmount(1_000, -5)).toBe(0);
  });
});

describe("paiements multiples", () => {
  it("accepte espèces + Mobile Money avec référence", () => {
    const r = checkPayments(10_000, [
      { kind: "pos_momo", amount: 6_000, reference: "TX-1" },
      { kind: "pos_cash", amount: 4_000 },
    ]);
    expect(r).toEqual({ ok: true, paid: 10_000, change: 0 });
  });

  it("exige une référence pour Mobile Money et carte", () => {
    expect(checkPayments(1_000, [{ kind: "pos_momo", amount: 1_000 }])).toMatchObject({ ok: false });
    expect(checkPayments(1_000, [{ kind: "pos_card", amount: 1_000, reference: " " }])).toMatchObject({ ok: false });
  });

  it("refuse un encaissement insuffisant", () => {
    expect(checkPayments(10_000, [{ kind: "pos_cash", amount: 9_500 }])).toMatchObject({ ok: false });
  });

  it("le trop-perçu n'est rendu qu'en espèces", () => {
    expect(checkPayments(10_000, [{ kind: "pos_cash", amount: 12_000 }])).toEqual({ ok: true, paid: 12_000, change: 2_000 });
    expect(checkPayments(10_000, [{ kind: "pos_momo", amount: 12_000, reference: "TX" }])).toMatchObject({ ok: false });
  });

  it("refuse une vente sans paiement et les montants invalides", () => {
    expect(checkPayments(1_000, [])).toMatchObject({ ok: false });
    expect(checkPayments(1_000, [{ kind: "pos_cash", amount: 0 }])).toMatchObject({ ok: false });
    expect(isPaymentKind("pos_cash")).toBe(true);
    expect(isPaymentKind("virement")).toBe(false);
  });
});

describe("settlePayments (rendu de monnaie exclu de la caisse)", () => {
  it("un paiement exact est conservé tel quel", () => {
    expect(settlePayments(10_000, [{ kind: "pos_cash", amount: 10_000 }])).toEqual([{ kind: "pos_cash", amount: 10_000 }]);
  });

  it("un excédent en espèces n'entre pas en caisse (il est rendu)", () => {
    expect(settlePayments(15_000, [{ kind: "pos_cash", amount: 100_000 }])).toEqual([{ kind: "pos_cash", amount: 15_000 }]);
  });

  it("les moyens non espèces sont servis d'abord, les espèces absorbent le reste", () => {
    const settled = settlePayments(10_000, [
      { kind: "pos_cash", amount: 8_000 },
      { kind: "pos_momo", amount: 6_000, reference: "TX" },
    ]);
    expect(settled).toEqual([
      { kind: "pos_momo", amount: 6_000, reference: "TX" },
      { kind: "pos_cash", amount: 4_000 },
    ]);
    expect(settled.reduce((s, x) => s + x.amount, 0)).toBe(10_000);
  });

  it("Σ des parts = total, toujours", () => {
    for (const total of [0, 1, 999, 15_000]) {
      const settled = settlePayments(total, [{ kind: "pos_momo", amount: 5_000, reference: "T" }, { kind: "pos_cash", amount: 50_000 }]);
      expect(settled.reduce((s, x) => s + x.amount, 0)).toBe(total);
    }
  });
});

describe("rapport Z", () => {
  it("agrège ventes, moyens de paiement, mouvements et écarts", () => {
    const report = buildZReport({
      sales: [
        { total: 10_000, discount: 500, taxTotal: 1_800, priceSource: "server" },
        { total: 5_000, discount: 0, taxTotal: 900, priceSource: "offline_snapshot" },
      ],
      payments: [
        { kind: "pos_cash", amount: 10_000 },
        { kind: "pos_momo", amount: 5_000 },
      ],
      cashMoves: [
        { kind: "in", amount: 2_000 },
        { kind: "out", amount: 3_000 },
      ],
      openingFloat: 20_000,
      countedCash: 28_500,
    });
    expect(report).toMatchObject({
      salesCount: 2,
      grossTotal: 15_000,
      discountTotal: 500,
      taxTotal: 2_700,
      cashIn: 2_000,
      cashOut: 3_000,
      expectedCash: 29_000,
      discrepancy: -500,
      offlinePriceMismatches: 1,
    });
    expect(report.byPayment).toEqual({ pos_cash: 10_000, pos_momo: 5_000 });
  });

  it("déduit les remboursements en espèces des espèces attendues (majeur n° 9)", () => {
    const report = buildZReport({
      sales: [{ total: 10_000, discount: 0, taxTotal: 0, priceSource: "server" }],
      payments: [{ kind: "pos_cash", amount: 10_000 }],
      cashMoves: [],
      openingFloat: 20_000,
      countedCash: 27_000,
      cashRefunds: 3_000,
    });
    // 20 000 + 10 000 − 3 000 = 27 000 : le caissier n'est plus accusé à tort d'un manque de 3 000.
    expect(report.cashRefunds).toBe(3_000);
    expect(report.expectedCash).toBe(27_000);
    expect(report.discrepancy).toBe(0);
  });

  it("sans remboursement déclaré, le rapport est inchangé (non-régression)", () => {
    const report = buildZReport({
      sales: [{ total: 10_000, discount: 0, taxTotal: 0, priceSource: "server" }],
      payments: [{ kind: "pos_cash", amount: 10_000 }],
      cashMoves: [],
      openingFloat: 20_000,
      countedCash: 30_000,
    });
    expect(report.cashRefunds).toBe(0);
    expect(report.expectedCash).toBe(30_000);
    expect(report.discrepancy).toBe(0);
  });

  it("sans comptage, l'écart reste indéterminé", () => {
    const report = buildZReport({ sales: [], payments: [], cashMoves: [], openingFloat: 5_000, countedCash: null });
    expect(report.discrepancy).toBeNull();
    expect(report.expectedCash).toBe(5_000);
  });
});

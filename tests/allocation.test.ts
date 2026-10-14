import { describe, it, expect } from "vitest";
import { allocateProRata, sumInts } from "@/lib/commerce/allocation";

/** Générateur pseudo-aléatoire déterministe (tests de propriété reproductibles). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("allocateProRata (plus fort reste)", () => {
  it("répartit exactement au prorata quand c'est entier", () => {
    expect(allocateProRata(100, [1, 1, 2])).toEqual([25, 25, 50]);
  });

  it("propriété : Σ allocations = montant, chaque allocation ≤ poids si montant ≤ Σ poids", () => {
    const r = rng(42);
    for (let k = 0; k < 500; k++) {
      const n = 1 + Math.floor(r() * 8);
      const weights = Array.from({ length: n }, () => Math.floor(r() * 50_000));
      const total = sumInts(weights);
      const amount = Math.floor(r() * (total + 1));
      const out = allocateProRata(amount, weights);
      expect(sumInts(out)).toBe(amount);
      out.forEach((x, i) => {
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        if (total > 0) expect(x).toBeLessThanOrEqual(weights[i]);
      });
    }
  });

  it("égalités de reste départagées par l'index (le plus petit d'abord)", () => {
    expect(allocateProRata(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocateProRata(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocateProRata(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });

  it("1 FCFA réparti sur des lignes inégales va au plus fort reste", () => {
    // 1 × 300/1000 = 0,3 ; 1 × 700/1000 = 0,7 → la seconde ligne
    expect(allocateProRata(1, [300, 700])).toEqual([0, 1]);
  });

  it("poids nuls : ne reçoivent rien tant qu'un poids est positif", () => {
    expect(allocateProRata(50, [0, 10, 0])).toEqual([0, 50, 0]);
  });

  it("tous les poids nuls : répartition égale, jamais de perte", () => {
    expect(allocateProRata(5, [0, 0])).toEqual([3, 2]);
    expect(allocateProRata(0, [0, 0])).toEqual([0, 0]);
  });

  it("poids négatifs ou non finis traités comme nuls ; montant négatif symétrique", () => {
    expect(allocateProRata(10, [-5, 10, Number.NaN])).toEqual([0, 10, 0]);
    expect(allocateProRata(-3, [1, 2])).toEqual([-1, -2]);
  });

  it("exact au-delà de 2^53 (BigInt)", () => {
    const out = allocateProRata(999_999_999, [999_999_999, 999_999_998, 1]);
    expect(sumInts(out)).toBe(999_999_999);
  });

  it("refuse un montant non entier et un montant non nul sans poids", () => {
    expect(() => allocateProRata(1.5, [1])).toThrow();
    expect(() => allocateProRata(3, [])).toThrow();
    expect(allocateProRata(0, [])).toEqual([]);
  });
});

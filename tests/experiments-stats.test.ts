import { describe, it, expect } from "vitest";
import { analyzeExperiment, betaSample, daysBetween, DEFAULT_SEED, MIN_DAYS, MIN_EXPOSURES_PER_VARIANT, mulberry32 } from "@/lib/experiments/stats";

/**
 * Lot 4 §13 (équipe EXP) : statistiques bêta-binomiales à GRAINE FIXE (reproductibles) et seuils de verdict.
 * Aucun verdict avant 7 jours et 200 expositions par variante, avertissement contre l'arrêt prématuré.
 */

const labels = { A: "A", B: "B", C: "C" };
const opts = (daysRunning: number) => ({ daysRunning, labels });

describe("reproductibilité", () => {
  it("donne exactement les mêmes chiffres à chaque appel", () => {
    const counts = [
      { key: "A", exposures: 1000, conversions: 50 },
      { key: "B", exposures: 1000, conversions: 80 },
    ];
    const a = analyzeExperiment(counts, opts(14));
    const b = analyzeExperiment(counts, opts(14));
    expect(a.variants.map((v) => v.probabilityBest)).toEqual(b.variants.map((v) => v.probabilityBest));
    expect(a.variants.map((v) => v.rateInterval)).toEqual(b.variants.map((v) => v.rateInterval));
    expect(a.variants.map((v) => v.lift)).toEqual(b.variants.map((v) => v.lift));
    expect(a.winnerKey).toBe(b.winnerKey);
  });

  it("change si l'on change la graine (preuve que la graine est bien utilisée)", () => {
    const counts = [
      { key: "A", exposures: 300, conversions: 30 },
      { key: "B", exposures: 300, conversions: 36 },
    ];
    const a = analyzeExperiment(counts, { ...opts(10), seed: DEFAULT_SEED });
    const b = analyzeExperiment(counts, { ...opts(10), seed: DEFAULT_SEED + 1 });
    expect(a.variants[0].probabilityBest).not.toBe(b.variants[0].probabilityBest);
  });

  it("le générateur est déterministe et dans [0,1[", () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("Beta(a,b) reste dans [0,1] et approche la moyenne a/(a+b)", () => {
    const rng = mulberry32(7);
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const v = betaSample(21, 81, rng); // moyenne attendue ≈ 0,2059
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      sum += v;
    }
    expect(Math.abs(sum / n - 21 / 102)).toBeLessThan(0.02);
  });
});

describe("seuils de verdict", () => {
  const strong = [
    { key: "A", exposures: 2000, conversions: 100 },
    { key: "B", exposures: 2000, conversions: 200 },
  ];

  it("aucun verdict avant 7 jours, même avec un écart énorme", () => {
    const r = analyzeExperiment(strong, opts(MIN_DAYS - 1));
    expect(r.enoughData).toBe(false);
    expect(r.winnerKey).toBeNull();
    expect(r.daysRemaining).toBe(1);
    expect(r.warning).toMatch(/N'arrêtez pas/);
    expect(r.message).toMatch(/indicatifs/);
  });

  it("aucun verdict avant 200 expositions sur la variante la moins vue", () => {
    const r = analyzeExperiment(
      [
        { key: "A", exposures: 5000, conversions: 250 },
        { key: "B", exposures: 199, conversions: 40 },
      ],
      opts(30),
    );
    expect(r.enoughData).toBe(false);
    expect(r.exposuresRemaining).toBe(1);
    expect(r.minExposures).toBe(199);
    expect(r.winnerKey).toBeNull();
    expect(r.warning).not.toBeNull();
  });

  it("désigne la gagnante quand les seuils sont atteints et l'écart net", () => {
    const r = analyzeExperiment(strong, opts(MIN_DAYS));
    expect(r.enoughData).toBe(true);
    expect(r.winnerKey).toBe("B");
    expect(r.warning).toBeNull();
    const b = r.variants.find((v) => v.key === "B")!;
    expect(b.probabilityBest).toBeGreaterThan(0.95);
    expect(b.lift).toBeGreaterThan(0.7); // environ +100 %
    expect(b.liftInterval![0]).toBeGreaterThan(0);
  });

  it("ne désigne personne quand les variantes se valent", () => {
    const r = analyzeExperiment(
      [
        { key: "A", exposures: 1000, conversions: 100 },
        { key: "B", exposures: 1000, conversions: 101 },
      ],
      opts(30),
    );
    expect(r.enoughData).toBe(true);
    expect(r.winnerKey).toBeNull();
    expect(r.message).toMatch(/se détache|se valent/);
  });

  it("gère trois variantes et une variante vide", () => {
    const r = analyzeExperiment(
      [
        { key: "A", exposures: 500, conversions: 50 },
        { key: "B", exposures: 500, conversions: 75 },
        { key: "C", exposures: 0, conversions: 0 },
      ],
      opts(10),
    );
    expect(r.variants).toHaveLength(3);
    expect(r.minExposures).toBe(0);
    expect(r.enoughData).toBe(false);
    // Les probabilités d'être la meilleure forment une partition : elles somment à 1.
    const sum = r.variants.reduce((s, v) => s + v.probabilityBest, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.0001);
  });

  it("borne les entrées aberrantes", () => {
    const r = analyzeExperiment(
      [
        { key: "A", exposures: -5, conversions: 10 },
        { key: "B", exposures: 10, conversions: 50 },
      ],
      opts(10),
    );
    expect(r.variants[0].exposures).toBe(0);
    expect(r.variants[0].conversions).toBe(0);
    expect(r.variants[1].conversions).toBe(10); // jamais plus de conversions que d'affichages
    expect(r.variants[1].rate).toBe(1);
  });

  it("un seul groupe : pas de test", () => {
    const r = analyzeExperiment([{ key: "A", exposures: 1000, conversions: 100 }], opts(30));
    expect(r.enoughData).toBe(false);
    expect(r.message).toMatch(/variantes/);
  });

  it("compte les jours écoulés sans jamais descendre sous zéro", () => {
    expect(daysBetween(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-08T00:00:00Z"))).toBe(7);
    expect(daysBetween(new Date("2026-10-08T00:00:00Z"), new Date("2026-10-01T00:00:00Z"))).toBe(0);
    expect(MIN_EXPOSURES_PER_VARIANT).toBe(200);
  });
});

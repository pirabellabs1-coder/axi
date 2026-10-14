/**
 * Lot 4 §13 : statistiques des tests A/B (module PUR, REPRODUCTIBLE).
 *
 * Modèle bêta-binomial : pour chaque variante, le taux de conversion suit une loi Beta(1 + conversions,
 * 1 + expositions − conversions) (a priori uniforme Beta(1,1), honnête quand les volumes sont faibles).
 * On tire `DRAWS` échantillons avec un générateur à GRAINE FIXE : les mêmes données donnent toujours les mêmes
 * chiffres (tests déterministes, et deux lectures de l'écran ne changent pas le verdict).
 *
 * Garde-fous contre les faux positifs :
 *  - aucun verdict avant 7 jours ET 200 expositions sur CHAQUE variante ;
 *  - probabilité d'être la meilleure ≥ 95 % exigée pour désigner une gagnante ;
 *  - avertissement explicite contre l'arrêt prématuré tant que les seuils ne sont pas atteints.
 */

export const DRAWS = 10_000;
export const DEFAULT_SEED = 0x5eed_4a1b;
export const MIN_DAYS = 7;
export const MIN_EXPOSURES_PER_VARIANT = 200;
export const WIN_PROBABILITY = 0.95;

export type VariantCounts = { key: string; label?: string; exposures: number; conversions: number };

export type VariantStats = {
  key: string;
  label: string;
  exposures: number;
  conversions: number;
  /** Taux observé (0..1). */
  rate: number;
  /** Intervalle de crédibilité à 95 % du taux. */
  rateInterval: [number, number];
  /** Probabilité d'être la meilleure variante (0..1). */
  probabilityBest: number;
  /** Gain relatif par rapport à la référence (variante A), en fraction : 0,12 = +12 %. `null` pour la référence. */
  lift: number | null;
  /** Intervalle à 95 % du gain relatif. */
  liftInterval: [number, number] | null;
};

export type ExperimentVerdict = {
  variants: VariantStats[];
  /** Variante gagnante, ou null (pas encore de verdict). */
  winnerKey: string | null;
  /** Les seuils (durée et volume) sont atteints. */
  enoughData: boolean;
  daysRunning: number;
  minExposures: number;
  /** Jours restants avant la durée minimale. */
  daysRemaining: number;
  /** Expositions manquantes sur la variante la moins vue. */
  exposuresRemaining: number;
  /** Message en français : état et avertissement contre l'arrêt prématuré. */
  message: string;
  warning: string | null;
};

/* ───────────── Générateur à graine fixe ───────────── */

/** mulberry32 : rapide, reproductible, suffisant pour une simulation de Monte-Carlo. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Loi normale centrée réduite (Box-Muller, sans mémoire d'état pour rester reproductible). */
function normal(rng: () => number): number {
  let u = rng();
  if (u < 1e-12) u = 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Loi Gamma(shape, 1) — Marsaglia et Tsang (2000), avec le correctif pour shape < 1. */
export function gammaSample(shape: number, rng: () => number): number {
  if (shape < 1) {
    const u = Math.max(rng(), 1e-12);
    return gammaSample(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 1000; i++) {
    const x = normal(rng);
    const v = 1 + c * x;
    if (v <= 0) continue;
    const v3 = v * v * v;
    const u = Math.max(rng(), 1e-12);
    if (Math.log(u) < 0.5 * x * x + d - d * v3 + d * Math.log(v3)) return d * v3;
  }
  return d; // repli (jamais atteint en pratique)
}

/** Loi Beta(a, b) par le rapport de deux lois Gamma. */
export function betaSample(a: number, b: number, rng: () => number): number {
  const x = gammaSample(a, rng);
  const y = gammaSample(b, rng);
  return x + y === 0 ? 0.5 : x / (x + y);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/* ───────────── Analyse ───────────── */

export type AnalyzeOptions = {
  /** Jours entiers écoulés depuis le démarrage. */
  daysRunning: number;
  seed?: number;
  draws?: number;
  labels?: Record<string, string>;
};

/**
 * Probabilités d'être la meilleure, intervalles et gain relatif par rapport à la première variante (référence).
 * Fonction pure : aucune horloge, aucune aléa non maîtrisé.
 */
export function analyzeExperiment(counts: readonly VariantCounts[], opts: AnalyzeOptions): ExperimentVerdict {
  const draws = Math.max(100, Math.trunc(opts.draws ?? DRAWS));
  const rng = mulberry32(opts.seed ?? DEFAULT_SEED);
  const rows = counts.map((c) => ({
    key: c.key,
    label: c.label ?? opts.labels?.[c.key] ?? c.key,
    exposures: Math.max(0, Math.trunc(c.exposures)),
    conversions: Math.max(0, Math.min(Math.trunc(c.conversions), Math.max(0, Math.trunc(c.exposures)))),
  }));

  // Échantillons par variante (une seule passe, ordre fixé : reproductible).
  const samples: number[][] = rows.map(() => []);
  for (let d = 0; d < draws; d++) {
    for (let v = 0; v < rows.length; v++) {
      const r = rows[v];
      samples[v].push(betaSample(1 + r.conversions, 1 + r.exposures - r.conversions, rng));
    }
  }

  const wins = rows.map(() => 0);
  for (let d = 0; d < draws; d++) {
    let bestIdx = 0;
    for (let v = 1; v < rows.length; v++) if (samples[v][d] > samples[bestIdx][d]) bestIdx = v;
    wins[bestIdx]++;
  }

  const sorted = samples.map((s) => s.slice().sort((a, b) => a - b));
  const reference = samples[0] ?? [];

  const variants: VariantStats[] = rows.map((r, v) => {
    const rate = r.exposures > 0 ? r.conversions / r.exposures : 0;
    let lift: number | null = null;
    let liftInterval: [number, number] | null = null;
    if (v > 0 && reference.length > 0) {
      const lifts: number[] = [];
      for (let d = 0; d < draws; d++) {
        const base = reference[d];
        if (base > 1e-9) lifts.push(samples[v][d] / base - 1);
      }
      lifts.sort((a, b) => a - b);
      if (lifts.length > 0) {
        lift = quantile(lifts, 0.5);
        liftInterval = [quantile(lifts, 0.025), quantile(lifts, 0.975)];
      }
    }
    return {
      key: r.key,
      label: r.label,
      exposures: r.exposures,
      conversions: r.conversions,
      rate,
      rateInterval: [quantile(sorted[v], 0.025), quantile(sorted[v], 0.975)],
      probabilityBest: wins[v] / draws,
      lift,
      liftInterval,
    };
  });

  const daysRunning = Math.max(0, Math.trunc(opts.daysRunning));
  const minExposures = rows.length ? Math.min(...rows.map((r) => r.exposures)) : 0;
  const daysRemaining = Math.max(0, MIN_DAYS - daysRunning);
  const exposuresRemaining = Math.max(0, MIN_EXPOSURES_PER_VARIANT - minExposures);
  const enoughData = rows.length >= 2 && daysRemaining === 0 && exposuresRemaining === 0;

  const leader = variants.reduce((best, v) => (v.probabilityBest > best.probabilityBest ? v : best), variants[0]);
  const winnerKey = enoughData && leader && leader.probabilityBest >= WIN_PROBABILITY ? leader.key : null;

  let message: string;
  let warning: string | null = null;
  if (rows.length < 2) {
    message = "Ce test n'a pas encore assez de variantes.";
  } else if (!enoughData) {
    const parts: string[] = [];
    if (daysRemaining > 0) parts.push(`${daysRemaining} jour${daysRemaining > 1 ? "s" : ""} de collecte`);
    if (exposuresRemaining > 0) parts.push(`${exposuresRemaining} affichage${exposuresRemaining > 1 ? "s" : ""} sur la variante la moins vue`);
    message = `Résultats encore indicatifs : il manque ${parts.join(" et ")}.`;
    warning = "N'arrêtez pas le test maintenant : avant 7 jours et 200 affichages par variante, une avance peut s'inverser complètement. Le hasard produit souvent de faux écarts au début.";
  } else if (winnerKey) {
    message = `Variante ${leader.label} gagnante : ${Math.round(leader.probabilityBest * 100)} % de chances d'être la meilleure.`;
  } else {
    message = `Aucune variante ne se détache (meilleure probabilité : ${Math.round((leader?.probabilityBest ?? 0) * 100)} %). Les variantes se valent, gardez la plus simple.`;
  }

  return { variants, winnerKey, enoughData, daysRunning, minExposures, daysRemaining, exposuresRemaining, message, warning };
}

/** Jours entiers écoulés (≥ 0) entre deux instants. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

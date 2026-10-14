const ZERO = BigInt(0);
const ONE = BigInt(1);

/**
 * Répartition d'un montant entier au prorata de poids entiers, par la méthode du plus fort reste
 * (spécification lot 1, §0.3). Fonctions pures, testées (tests/allocation.test.ts).
 *
 * Invariants :
 *  - Σ allocations = amount (toujours) ;
 *  - poids négatifs ou non finis traités comme 0 ;
 *  - si Σ poids > 0, un poids nul reçoit 0 ; si de plus amount ≤ Σ poids et les poids sont entiers,
 *    chaque allocation est ≤ son poids (une remise ne rend jamais une ligne négative) ;
 *  - égalités de reste départagées par l'index (le plus petit d'abord) : résultat déterministe ;
 *  - Σ poids = 0 : répartition égale entre tous les index (plus fort reste), jamais de perte.
 *
 * Les produits amount × poids sont calculés en BigInt : exacts même au-delà de 2^53.
 */
export function allocateProRata(amount: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(amount)) throw new Error("allocateProRata : montant entier attendu");
  const n = weights.length;
  if (n === 0) {
    if (amount !== 0) throw new Error("allocateProRata : aucun poids pour répartir un montant non nul");
    return [];
  }
  if (amount < 0) return allocateProRata(-amount, weights).map((x) => (x === 0 ? 0 : -x));
  if (amount === 0) return new Array<number>(n).fill(0);

  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? BigInt(Math.floor(x)) : ZERO));
  let total = w.reduce((s, x) => s + x, ZERO);
  // Poids tous nuls : répartition égale.
  const eff = total === ZERO ? w.map(() => ONE) : w;
  if (total === ZERO) total = BigInt(n);

  const A = BigInt(amount);
  const base: number[] = new Array<number>(n);
  const rem: bigint[] = new Array<bigint>(n);
  let distributed = ZERO;
  for (let i = 0; i < n; i++) {
    const p = A * eff[i];
    const q = p / total;
    base[i] = Number(q);
    rem[i] = p - q * total;
    distributed += q;
  }
  let left = Number(A - distributed);
  if (left > 0) {
    const order = Array.from({ length: n }, (_, i) => i)
      .filter((i) => eff[i] > ZERO)
      .sort((a, b) => (rem[b] > rem[a] ? 1 : rem[b] < rem[a] ? -1 : a - b));
    for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k]] += 1;
  }
  return base;
}

/** Somme d'un tableau d'entiers. */
export function sumInts(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

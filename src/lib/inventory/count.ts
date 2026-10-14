/**
 * Inventaire tournant (lot 3 §1.1) — plan PUR (tests/inventory-invariant.test.ts).
 * Le commerçant saisit les quantités comptées dans un dépôt ; l'écart est écrit en mouvement `COUNT`
 * (niveau du dépôt ET stock agrégé, dans la même transaction), avec audit.
 */

export type CountedLine = { itemKey: string; productId: string; variantId: string | null; available: number; counted: number | null };

export type CountDelta = { itemKey: string; productId: string; variantId: string | null; delta: number; from: number; to: number };

/** Écarts à écrire : une ligne par article compté dont la quantité diffère du niveau connu. */
export function countPlan(lines: readonly CountedLine[]): CountDelta[] {
  const out: CountDelta[] = [];
  for (const l of lines) {
    if (l.counted == null || !Number.isInteger(l.counted) || l.counted < 0) continue;
    const delta = l.counted - l.available;
    if (delta === 0) continue;
    out.push({ itemKey: l.itemKey, productId: l.productId, variantId: l.variantId, delta, from: l.available, to: l.counted });
  }
  return out;
}

/** Résumé affiché au commerçant après un comptage. */
export function countSummary(deltas: readonly CountDelta[]): { lines: number; added: number; removed: number } {
  return {
    lines: deltas.length,
    added: deltas.filter((d) => d.delta > 0).reduce((s, d) => s + d.delta, 0),
    removed: deltas.filter((d) => d.delta < 0).reduce((s, d) => s - d.delta, 0),
  };
}

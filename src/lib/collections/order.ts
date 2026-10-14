/** Ordre d'affichage des collections (champ `Category.position`). Fonctions pures, testées. */

/**
 * Ordre final à enregistrer : les identifiants demandés qui existent dans la boutique (sans doublon), dans l'ordre reçu,
 * puis les collections existantes non mentionnées, dans leur ordre actuel. Garantit des positions 0..n-1 sans trou
 * ni ex æquo, même si le client envoie une liste partielle ou périmée.
 */
export function mergeCollectionOrder(requested: readonly string[], existing: readonly string[]): string[] {
  const known = new Set(existing);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of requested) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of existing) if (!seen.has(id)) out.push(id);
  return out;
}

/** Déplace `id` à l'index `to` (borné). Renvoie la même liste si rien ne change. */
export function moveId<T extends string>(ids: readonly T[], id: T, to: number): T[] {
  const from = ids.indexOf(id);
  const target = Math.max(0, Math.min(ids.length - 1, to));
  if (from < 0 || from === target) return [...ids];
  const next = ids.filter((x) => x !== id);
  next.splice(target, 0, id);
  return next;
}

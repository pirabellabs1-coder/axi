/**
 * Ajustement rapide de l'inventaire (champ + / − / saisie) — fonctions pures, testées (tests/inventory-policy.test.ts).
 * Un stock peut être négatif (survente en « continuer à vendre ») : il s'affiche tel quel, « + » le remonte
 * normalement, « − » est désactivé à zéro ou moins (un ajustement manuel ne rend jamais le stock négatif).
 */

/** Saisie : chiffres, avec le signe « - » en tête conservé (affichage d'un stock négatif). */
export function sanitizeStockInput(raw: string): string {
  const t = raw.replace(/[^\d-]/g, "");
  return t.startsWith("-") ? `-${t.slice(1).replace(/-/g, "")}` : t.replace(/-/g, "");
}

/** Nouvelle valeur après un pas : « + » toujours possible, « − » plancher à zéro (jamais en dessous). */
export function stepStock(value: string, delta: 1 | -1): string {
  const n = Number(value);
  const cur = Number.isFinite(n) ? n : 0;
  if (delta > 0) return String(cur + 1);
  return String(cur <= 0 ? cur : cur - 1);
}

/** « − » disponible seulement au-dessus de zéro. */
export function canDecrement(value: string): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/** Valeur à enregistrer : un entier qui diffère du stock lu ; une valeur négative n'est acceptée que si elle remonte. */
export function quickStockTarget(value: string, stock: number): number | null {
  if (value === "" || value === "-") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n === stock) return null;
  if (n < 0 && n < stock) return null;
  return n;
}

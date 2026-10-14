/** Contraste WCAG entre deux couleurs #RRGGBB (module pur). */
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

/** Niveau WCAG pour du texte normal : AAA ≥ 7, AA ≥ 4,5, « Grand texte » ≥ 3. */
export function contrastLevel(ratio: number): "AAA" | "AA" | "AA grand texte" | "Insuffisant" {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA grand texte";
  return "Insuffisant";
}

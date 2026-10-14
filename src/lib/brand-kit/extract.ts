/**
 * Lot 4 §7 : extraction des couleurs dominantes d'un logo (module PUR, testé : tests/brand-palette.test.ts).
 *
 * L'extraction a lieu CÔTÉ CLIENT (canvas, voir `client.ts`) : le fichier du logo n'est pas envoyé au serveur
 * pour être analysé. Ce module ne manipule que des pixels et des hex, sans DOM : il est donc testable et
 * réutilisable (jobs, tests, aperçus).
 *
 * Algorithme : quantification « median cut » sur les pixels retenus (5 couleurs par défaut).
 * Pixels ignorés : transparents (alpha < 128) et quasi blancs (très clairs et peu saturés, fond de logo).
 */

export type Rgb = { r: number; g: number; b: number };

/** Alpha en dessous duquel le pixel est considéré transparent. */
export const MIN_ALPHA = 128;

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function fromHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/** Saturation HSL (0..1) d'une couleur RVB. */
export function saturationOf({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/** Luminosité relative simplifiée (0..1), suffisante pour écarter les pixels quasi blancs. */
export function lightnessOf({ r, g, b }: Rgb): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

/** Écart entre le canal le plus fort et le plus faible (0..1) : une couleur grise vaut 0. */
export function chromaOf({ r, g, b }: Rgb): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Pixel à ignorer : transparent, ou quasi blanc (très clair et presque sans couleur : fond du logo). */
export function isIgnoredPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < MIN_ALPHA) return true;
  const px = { r, g, b };
  return lightnessOf(px) > 0.93 && chromaOf(px) < 0.1;
}

/** Pixels retenus d'un buffer RGBA (ImageData.data). `step` échantillonne un pixel sur N (performance). */
export function pixelsFromRgba(data: ArrayLike<number>, step = 1): Rgb[] {
  const out: Rgb[] = [];
  const stride = 4 * Math.max(1, Math.floor(step));
  for (let i = 0; i + 3 < data.length; i += stride) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (isIgnoredPixel(r, g, b, a)) continue;
    out.push({ r, g, b });
  }
  return out;
}

function channelRange(box: Rgb[], c: keyof Rgb): number {
  let min = 255;
  let max = 0;
  for (const p of box) {
    if (p[c] < min) min = p[c];
    if (p[c] > max) max = p[c];
  }
  return max - min;
}

function averageOf(box: Rgb[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of box) {
    r += p.r;
    g += p.g;
    b += p.b;
  }
  return { r: r / box.length, g: g / box.length, b: b / box.length };
}

/**
 * Quantification « median cut » : découpe récursivement l'espace des couleurs sur le canal le plus étalé,
 * jusqu'à `count` boîtes, puis renvoie la moyenne de chaque boîte, de la boîte la plus peuplée à la moins peuplée.
 * Déterministe (aucun aléa) : deux appels sur les mêmes pixels donnent la même palette.
 */
export function medianCut(pixels: Rgb[], count = 5): string[] {
  if (pixels.length === 0) return [];
  const n = Math.max(1, Math.min(16, Math.floor(count)));
  let boxes: Rgb[][] = [pixels];
  while (boxes.length < n) {
    // Boîte la plus « étalée » (plus grand écart sur un canal), à défaut on arrête.
    let bestIndex = -1;
    let bestRange = 0;
    let bestChannel: keyof Rgb = "r";
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (const c of ["r", "g", "b"] as const) {
        const range = channelRange(box, c);
        if (range > bestRange) {
          bestRange = range;
          bestIndex = i;
          bestChannel = c;
        }
      }
    });
    if (bestIndex === -1 || bestRange === 0) break;
    const box = [...boxes[bestIndex]].sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = Math.floor(box.length / 2);
    boxes = [...boxes.slice(0, bestIndex), box.slice(0, mid), box.slice(mid), ...boxes.slice(bestIndex + 1)];
  }
  return boxes
    .filter((b) => b.length > 0)
    .sort((a, b) => b.length - a.length)
    .map((b) => toHex(averageOf(b)));
}

/** Palette d'un buffer RGBA : pixels utiles puis median cut. Renvoie des hex en majuscules, sans doublon. */
export function extractPalette(data: ArrayLike<number>, opts: { count?: number; step?: number } = {}): string[] {
  const pixels = pixelsFromRgba(data, opts.step ?? 1);
  const colors = medianCut(pixels, opts.count ?? 5);
  return [...new Set(colors)];
}

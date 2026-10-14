/**
 * Code-barres Code 128 (jeu B) — module PUR, sans dépendance (tests/code128.test.ts).
 * Utilisé par l'étiquette interne A6 / 100 × 150 mm des transporteurs « manual » (lot 3 §1.2) :
 * référence de commande, numéro de suivi. Rendu en SVG (aucune image à générer côté serveur).
 *
 * Structure : zone de silence, START B, caractères (valeur = code ASCII − 32), somme de contrôle
 * (104 + Σ (i+1) × valeur) mod 103, STOP, zone de silence.
 */

/** 103 valeurs + START A (103), START B (104), START C (105), STOP (106). Largeurs barre/espace alternées. */
const PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

export const CODE128_START_B = 104;
export const CODE128_STOP = 106;
/** Zone de silence réglementaire, en modules. */
export const CODE128_QUIET_MODULES = 10;

/** Caractère encodable en jeu B (ASCII 32 à 126). */
export function isEncodable(text: string): boolean {
  return /^[\x20-\x7e]+$/.test(text);
}

/** Ne garde que les caractères encodables, en majuscules (références Axi : A-Z, 0-9, tirets). */
export function sanitizeCode128(text: string, maxLength = 32): string {
  return [...text.toUpperCase()].filter((c) => isEncodable(c)).join("").slice(0, maxLength);
}

/** Somme de contrôle (modulo 103) des valeurs du jeu B. */
export function checksumCode128(values: readonly number[]): number {
  let sum = CODE128_START_B;
  values.forEach((v, i) => {
    sum += (i + 1) * v;
  });
  return sum % 103;
}

/** Valeurs du jeu B d'un texte (code ASCII − 32). Lève si un caractère n'est pas encodable. */
export function valuesCode128B(text: string): number[] {
  if (!text.length) throw new Error("code128 : texte vide");
  if (!isEncodable(text)) throw new Error("code128 : caractère non encodable en jeu B");
  return [...text].map((c) => c.charCodeAt(0) - 32);
}

/**
 * Suite de modules (1 = barre, 0 = espace), zones de silence comprises.
 * Longueur = 2 × zone de silence + 11 × (1 + n + 1) + 13.
 */
export function modulesCode128(text: string, quiet = CODE128_QUIET_MODULES): string {
  const values = valuesCode128B(text);
  const symbols = [CODE128_START_B, ...values, checksumCode128(values), CODE128_STOP];
  let out = "0".repeat(quiet);
  for (const s of symbols) {
    const pattern = PATTERNS[s];
    let bar = true;
    for (const w of pattern) {
      out += (bar ? "1" : "0").repeat(Number(w));
      bar = !bar;
    }
  }
  return out + "0".repeat(quiet);
}

/**
 * SVG du code-barres : rectangles noirs sur fond blanc, `viewBox` en modules (aucune police requise,
 * imprimable tel quel). `height` est exprimé en modules pour rester proportionnel.
 */
export function code128Svg(text: string, opts: { height?: number; quiet?: number; title?: string } = {}): string {
  const modules = modulesCode128(text, opts.quiet);
  const height = Math.max(10, Math.round(opts.height ?? 40));
  const rects: string[] = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === "1") {
      let width = 1;
      while (modules[i + width] === "1") width += 1;
      rects.push(`<rect x="${i}" y="0" width="${width}" height="${height}" />`);
      i += width;
    } else {
      i += 1;
    }
  }
  const title = opts.title ?? text;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules.length} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="Code-barres ${title}">`,
    `<rect x="0" y="0" width="${modules.length}" height="${height}" fill="#fff" />`,
    `<g fill="#000">${rects.join("")}</g>`,
    "</svg>",
  ].join("");
}

/*
 * Générateur de QR Code en TypeScript pur (aucune dépendance).
 *
 * Portage simplifié de « QR Code generator library » de Project Nayuki
 * (https://www.nayuki.io/page/qr-code-generator-library).
 *
 * Copyright (c) Project Nayuki. (MIT License)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 *
 * Modes pris en charge : numérique, alphanumérique, octets (UTF-8). Versions 1 à 40, 4 niveaux de
 * correction, choix automatique du masque (pénalités ISO/IEC 18004).
 */

export type Ecc = "L" | "M" | "Q" | "H";

const ECC_ORDINAL: Record<Ecc, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT_BITS: Record<Ecc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Index [ordinal][version]. Le 0 n'est pas utilisé.
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

function appendBits(val: number, len: number, bb: number[]): void {
  if (len < 0 || len > 31 || val >>> len !== 0) throw new RangeError("Valeur hors limites");
  for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
}

/* ───────────────────────── Segments ───────────────────────── */

type Mode = { bits: number; cc: [number, number, number] };
const MODE_NUMERIC: Mode = { bits: 0x1, cc: [10, 12, 14] };
const MODE_ALNUM: Mode = { bits: 0x2, cc: [9, 11, 13] };
const MODE_BYTE: Mode = { bits: 0x4, cc: [8, 16, 16] };

const ALNUM_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

export type Segment = { mode: Mode; numChars: number; data: number[] };

function ccBits(mode: Mode, ver: number): number {
  return mode.cc[Math.floor((ver + 7) / 17)];
}

export function makeSegments(text: string): Segment[] {
  if (text === "") return [];
  if (/^[0-9]*$/.test(text)) {
    const bb: number[] = [];
    for (let i = 0; i < text.length; ) {
      const n = Math.min(text.length - i, 3);
      appendBits(parseInt(text.substring(i, i + n), 10), n * 3 + 1, bb);
      i += n;
    }
    return [{ mode: MODE_NUMERIC, numChars: text.length, data: bb }];
  }
  if (/^[A-Z0-9 $%*+.\/:-]*$/.test(text)) {
    const bb: number[] = [];
    let i: number;
    for (i = 0; i + 2 <= text.length; i += 2) {
      appendBits(ALNUM_CHARSET.indexOf(text.charAt(i)) * 45 + ALNUM_CHARSET.indexOf(text.charAt(i + 1)), 11, bb);
    }
    if (i < text.length) appendBits(ALNUM_CHARSET.indexOf(text.charAt(i)), 6, bb);
    return [{ mode: MODE_ALNUM, numChars: text.length, data: bb }];
  }
  const bytes = Array.from(new TextEncoder().encode(text));
  const bb: number[] = [];
  for (const b of bytes) appendBits(b, 8, bb);
  return [{ mode: MODE_BYTE, numChars: bytes.length, data: bb }];
}

function totalBits(segs: Segment[], ver: number): number {
  let result = 0;
  for (const seg of segs) {
    const cc = ccBits(seg.mode, ver);
    if (seg.numChars >= 1 << cc) return Infinity;
    result += 4 + cc + seg.data.length;
  }
  return result;
}

/* ───────────────────────── Capacités ───────────────────────── */

export function getNumRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

export function getNumDataCodewords(ver: number, ecl: Ecc): number {
  const o = ECC_ORDINAL[ecl];
  return Math.floor(getNumRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[o][ver] * NUM_ERROR_CORRECTION_BLOCKS[o][ver];
}

/* ───────────────────────── Reed-Solomon (GF(2^8), polynôme 0x11D) ───────────────────────── */

function rsMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

export function reedSolomonComputeDivisor(degree: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < degree - 1; i++) result.push(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

export function reedSolomonComputeRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= rsMultiply(coef, factor)));
  }
  return result;
}

/* ───────────────────────── Code QR ───────────────────────── */

export type QrCode = {
  version: number;
  size: number;
  ecc: Ecc;
  mask: number;
  /** modules[y][x] : true = module sombre. */
  modules: boolean[][];
};

/** Mots de code de données (avant correction d'erreurs) pour une version et un niveau donnés. */
export function encodeDataCodewords(segs: Segment[], ver: number, ecl: Ecc): number[] {
  const capacityBits = getNumDataCodewords(ver, ecl) * 8;
  const bb: number[] = [];
  for (const seg of segs) {
    appendBits(seg.mode.bits, 4, bb);
    appendBits(seg.numChars, ccBits(seg.mode, ver), bb);
    for (const b of seg.data) bb.push(b);
  }
  if (bb.length > capacityBits) throw new RangeError("Données trop longues");
  appendBits(0, Math.min(4, capacityBits - bb.length), bb);
  appendBits(0, (8 - (bb.length % 8)) % 8, bb);
  for (let padByte = 0xec; bb.length < capacityBits; padByte ^= 0xec ^ 0x11) appendBits(padByte, 8, bb);
  const out: number[] = new Array(bb.length / 8).fill(0);
  bb.forEach((b, i) => (out[i >>> 3] |= b << (7 - (i & 7))));
  return out;
}

export function encodeText(text: string, opts: { ecc?: Ecc; minVersion?: number; maxVersion?: number; mask?: number; boostEcc?: boolean } = {}): QrCode {
  const segs = makeSegments(text);
  let ecl: Ecc = opts.ecc ?? "M";
  const minVersion = opts.minVersion ?? 1;
  const maxVersion = opts.maxVersion ?? 40;
  let version: number;
  let used = 0;
  for (version = minVersion; ; version++) {
    used = totalBits(segs, version);
    if (used <= getNumDataCodewords(version, ecl) * 8) break;
    if (version >= maxVersion) throw new RangeError("Texte trop long pour un QR code");
  }
  if (opts.boostEcc !== false) {
    for (const e of ["M", "Q", "H"] as Ecc[]) {
      if (ECC_ORDINAL[e] > ECC_ORDINAL[ecl] && used <= getNumDataCodewords(version, e) * 8) ecl = e;
    }
  }
  const data = encodeDataCodewords(segs, version, ecl);
  return buildQr(version, ecl, data, opts.mask ?? -1);
}

function buildQr(version: number, ecc: Ecc, dataCodewords: number[], msk: number): QrCode {
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const setFunction = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  const drawFormatBits = (mask: number) => {
    const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFunction(8, i, getBit(bits, i));
    setFunction(8, 7, getBit(bits, 6));
    setFunction(8, 8, getBit(bits, 7));
    setFunction(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, getBit(bits, i));
    setFunction(8, size - 8, true);
  };

  const drawFinder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFunction(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  };

  const drawAlignment = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  };

  // Motifs de fonction
  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);
  const align = alignmentPatternPositions(version);
  const n = align.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))) drawAlignment(align[i], align[j]);
    }
  }
  drawFormatBits(0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const color = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, color);
      setFunction(b, a, color);
    }
  }

  // Données + correction d'erreurs, entrelacées
  const allCodewords = addEccAndInterleave(dataCodewords, version, ecc);
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bit < allCodewords.length * 8) {
          modules[y][x] = getBit(allCodewords[bit >>> 3], 7 - (bit & 7));
          bit++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunction[y][x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: throw new RangeError("Masque invalide");
        }
        if (invert) modules[y][x] = !modules[y][x];
      }
    }
  };

  let mask = msk;
  if (mask === -1) {
    let minPenalty = Infinity;
    for (let i = 0; i < 8; i++) {
      applyMask(i);
      drawFormatBits(i);
      const penalty = penaltyScore(modules);
      if (penalty < minPenalty) {
        mask = i;
        minPenalty = penalty;
      }
      applyMask(i); // XOR : annule
    }
  }
  applyMask(mask);
  drawFormatBits(mask);
  return { version, size, ecc, mask, modules };
}

export function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result: number[] = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Bloc d'information de version (versions 7 et plus), 18 bits. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/** Bits de format (15 bits, masqués) pour un niveau de correction et un masque. */
export function formatBits(ecc: Ecc, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export function addEccAndInterleave(data: readonly number[], version: number, ecc: Ecc): number[] {
  const o = ECC_ORDINAL[ecc];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[o][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[o][version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blocks: number[][] = [];
  const rsDiv = reedSolomonComputeDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccPart = reedSolomonComputeRemainder(dat, rsDiv);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(eccPart));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

/** Score de pénalité d'un masque (règles N1 à N4). */
export function penaltyScore(modules: boolean[][]): number {
  const size = modules.length;
  let result = 0;

  const addHistory = (len: number, h: number[]) => {
    if (h[0] === 0) len += size; // bordure claire implicite
    h.pop();
    h.unshift(len);
  };
  const countPatterns = (h: number[]) => {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  };
  const terminate = (color: boolean, len: number, h: number[]) => {
    if (color) {
      addHistory(len, h);
      len = 0;
    }
    len += size;
    addHistory(len, h);
    return countPatterns(h);
  };

  for (let y = 0; y < size; y++) {
    let runColor = false;
    let runX = 0;
    const h = [0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < size; x++) {
      if (modules[y][x] === runColor) {
        runX++;
        if (runX === 5) result += PENALTY_N1;
        else if (runX > 5) result++;
      } else {
        addHistory(runX, h);
        if (!runColor) result += countPatterns(h) * PENALTY_N3;
        runColor = modules[y][x];
        runX = 1;
      }
    }
    result += terminate(runColor, runX, h) * PENALTY_N3;
  }
  for (let x = 0; x < size; x++) {
    let runColor = false;
    let runY = 0;
    const h = [0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < size; y++) {
      if (modules[y][x] === runColor) {
        runY++;
        if (runY === 5) result += PENALTY_N1;
        else if (runY > 5) result++;
      } else {
        addHistory(runY, h);
        if (!runColor) result += countPatterns(h) * PENALTY_N3;
        runColor = modules[y][x];
        runY = 1;
      }
    }
    result += terminate(runColor, runY, h) * PENALTY_N3;
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += PENALTY_N2;
    }
  }
  let dark = 0;
  for (const row of modules) for (const c of row) if (c) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;
  return result;
}

/* ───────────────────────── Rendu ───────────────────────── */

/** Chemin SVG des modules sombres (unités = modules, bordure incluse). */
export function toSvgPath(qr: QrCode, border = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) parts.push(`M${x + border},${y + border}h1v1h-1z`);
    }
  }
  return parts.join("");
}

/** Document SVG autonome (fond blanc, modules de la couleur choisie). */
export function toSvgString(qr: QrCode, opts: { border?: number; dark?: string; light?: string; title?: string } = {}): string {
  const border = opts.border ?? 4;
  const dim = qr.size + border * 2;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">${opts.title ? `<title>${esc(opts.title)}</title>` : ""}<rect width="100%" height="100%" fill="${esc(opts.light ?? "#ffffff")}"/><path d="${toSvgPath(qr, border)}" fill="${esc(opts.dark ?? "#000000")}"/></svg>`;
}

/** Matrice compacte (« 0 » / « 1 » par ligne) à transmettre à un composant client. */
export function toRows(qr: QrCode): string[] {
  return qr.modules.map((row) => row.map((c) => (c ? "1" : "0")).join(""));
}

import { describe, it, expect } from "vitest";
import {
  encodeText,
  makeSegments,
  encodeDataCodewords,
  addEccAndInterleave,
  reedSolomonComputeDivisor,
  reedSolomonComputeRemainder,
  formatBits,
  versionBits,
  getNumDataCodewords,
  alignmentPatternPositions,
  penaltyScore,
  toSvgString,
} from "@/lib/qr/encoder";

/** Vecteur de référence ISO 18004 / thonky.com : « HELLO WORLD », version 1, niveau M. */
const HELLO_DATA = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
const HELLO_ECC = [196, 35, 39, 119, 235, 215, 231, 226, 93, 23];

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** Relit les mots de code d'un QR de version 1 (zigzag, démasquage) : décodeur indépendant. */
function readV1Codewords(modules: boolean[][], mask: number): number[] {
  const size = modules.length;
  const isFn = (x: number, y: number) => (x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8) || x === 6 || y === 6;
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFn(x, y)) continue;
        bits.push((modules[y][x] !== maskBit(mask, x, y)) ? 1 : 0);
      }
    }
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

/** Lit les 15 bits de format autour du repère en haut à gauche. */
function readFormat(modules: boolean[][]): number {
  const get = (x: number, y: number) => (modules[y][x] ? 1 : 0);
  let bits = 0;
  const coords: [number, number][] = [];
  for (let i = 0; i <= 5; i++) coords.push([8, i]);
  coords.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) coords.push([14 - i, 8]);
  coords.forEach(([x, y], i) => (bits |= get(x, y) << i));
  return bits;
}

describe("encodeur QR : mots de code", () => {
  it("encode « HELLO WORLD » en alphanumérique (16 mots de données, version 1-M)", () => {
    const segs = makeSegments("HELLO WORLD");
    expect(encodeDataCodewords(segs, 1, "M")).toEqual(HELLO_DATA);
  });

  it("calcule la correction Reed-Solomon du vecteur de référence", () => {
    expect(reedSolomonComputeRemainder(HELLO_DATA, reedSolomonComputeDivisor(10))).toEqual(HELLO_ECC);
  });

  it("entrelace données + correction pour une version à un seul bloc", () => {
    expect(addEccAndInterleave(HELLO_DATA, 1, "M")).toEqual([...HELLO_DATA, ...HELLO_ECC]);
  });

  it("respecte les capacités normalisées", () => {
    expect(getNumDataCodewords(1, "L")).toBe(19);
    expect(getNumDataCodewords(1, "M")).toBe(16);
    expect(getNumDataCodewords(1, "Q")).toBe(13);
    expect(getNumDataCodewords(1, "H")).toBe(9);
    expect(getNumDataCodewords(10, "M")).toBe(216);
    expect(getNumDataCodewords(40, "L")).toBe(2956);
    expect(getNumDataCodewords(40, "H")).toBe(1276);
  });

  it("place les motifs d'alignement aux positions normalisées", () => {
    expect(alignmentPatternPositions(1)).toEqual([]);
    expect(alignmentPatternPositions(2)).toEqual([6, 18]);
    expect(alignmentPatternPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPatternPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
  });
});

describe("encodeur QR : format, version, masque", () => {
  it("bits de format conformes à la table ISO (masque 0)", () => {
    expect(formatBits("L", 0).toString(2).padStart(15, "0")).toBe("111011111000100");
    expect(formatBits("M", 0).toString(2).padStart(15, "0")).toBe("101010000010010");
    expect(formatBits("Q", 0).toString(2).padStart(15, "0")).toBe("011010101011111");
    expect(formatBits("H", 0).toString(2).padStart(15, "0")).toBe("001011010001001");
  });

  it("bloc de version 7 conforme (0x07C94)", () => {
    expect(versionBits(7)).toBe(0x07c94);
  });

  it("« HELLO WORLD » 1-M : version, masque optimal et relecture complète", () => {
    const qr = encodeText("HELLO WORLD", { ecc: "M", boostEcc: false });
    expect(qr.version).toBe(1);
    expect(qr.size).toBe(21);
    expect(qr.ecc).toBe("M");
    // Le masque retenu a la pénalité minimale parmi les 8 possibles
    const penalties = Array.from({ length: 8 }, (_, m) => penaltyScore(encodeText("HELLO WORLD", { ecc: "M", boostEcc: false, mask: m }).modules));
    expect(penalties[qr.mask]).toBe(Math.min(...penalties));
    // Les bits de format lus dans la matrice désignent bien ce niveau et ce masque
    expect(readFormat(qr.modules)).toBe(formatBits("M", qr.mask));
    // Relecture indépendante : données + correction intactes
    expect(readV1Codewords(qr.modules, qr.mask)).toEqual([...HELLO_DATA, ...HELLO_ECC]);
  });

  it("chaque masque forcé produit une matrice relisible", () => {
    for (let m = 0; m < 8; m++) {
      const qr = encodeText("HELLO WORLD", { ecc: "M", boostEcc: false, mask: m });
      expect(qr.mask).toBe(m);
      expect(readV1Codewords(qr.modules, m)).toEqual([...HELLO_DATA, ...HELLO_ECC]);
    }
  });

  it("choisit la version selon la longueur d'une URL et relève le niveau si possible", () => {
    const url = "https://axi.africa/s/chez-aicha";
    const qr = encodeText(url, { ecc: "M" });
    expect(qr.version).toBe(3); // 31 octets : la version 2-M (26) ne suffit pas
    expect(qr.size).toBe(29);
    expect(["M", "Q", "H"]).toContain(qr.ecc);
    expect(readFormat(qr.modules)).toBe(formatBits(qr.ecc, qr.mask));
    // Repères de position : coin 7x7 sombre, centre sombre
    expect(qr.modules[0][0] && qr.modules[3][3] && qr.modules[0][qr.size - 1] && qr.modules[qr.size - 1][0]).toBe(true);
  });

  it("encode l'UTF-8 et refuse un texte trop long", () => {
    expect(encodeText("Boutique Aïcha – Cotonou").version).toBeGreaterThanOrEqual(2);
    expect(() => encodeText("x".repeat(3000), { ecc: "H" })).toThrow();
  });

  it("produit un SVG autonome sur fond blanc", () => {
    const svg = toSvgString(encodeText("HELLO WORLD"), { title: "Test <&>" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain("&lt;&amp;&gt;".slice(0, 9));
  });
});

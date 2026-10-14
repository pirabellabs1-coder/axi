import { describe, it, expect } from "vitest";
import { checksumCode128, code128Svg, isEncodable, modulesCode128, sanitizeCode128, valuesCode128B, CODE128_QUIET_MODULES } from "@/lib/shipping/code128";

/**
 * Code 128 (jeu B) de l'étiquette interne (lot 3 §1.2) — vecteurs de contrôle.
 * Références : START B = 11010010000, STOP = 1100011101011.
 */

const START_B = "11010010000";
const STOP = "1100011101011";
const QUIET = "0".repeat(CODE128_QUIET_MODULES);

describe("valeurs et somme de contrôle", () => {
  it("valeur = code ASCII − 32", () => {
    expect(valuesCode128B("A")).toEqual([33]);
    expect(valuesCode128B("0")).toEqual([16]);
    expect(valuesCode128B(" ")).toEqual([0]);
  });

  it("somme de contrôle : (104 + Σ (i+1) × valeur) mod 103", () => {
    // « AXI » : 33, 56, 41 → 104 + 33 + 2×56 + 3×41 = 372 ; 372 mod 103 = 63.
    expect(checksumCode128(valuesCode128B("AXI"))).toBe(63);
    // Vecteur classique « CODE128 » (jeu B seul).
    const values = valuesCode128B("CODE128");
    const expected = (104 + values.reduce((s, v, i) => s + (i + 1) * v, 0)) % 103;
    expect(checksumCode128(values)).toBe(expected);
  });

  it("refuse un texte vide ou non encodable", () => {
    expect(() => valuesCode128B("")).toThrow();
    expect(() => valuesCode128B("é")).toThrow();
    expect(isEncodable("AX-7K3P9Q")).toBe(true);
    expect(isEncodable("é")).toBe(false);
  });

  it("sanitizeCode128 met en majuscules et retire les caractères impossibles", () => {
    expect(sanitizeCode128("ax-7k3p9q")).toBe("AX-7K3P9Q");
    expect(sanitizeCode128("réf-12")).toBe("RF-12");
    expect(sanitizeCode128("A".repeat(50), 10)).toHaveLength(10);
  });
});

describe("modules", () => {
  it("commence par la zone de silence et START B, finit par STOP et la zone de silence", () => {
    const modules = modulesCode128("AX-7K3P9Q");
    expect(modules.startsWith(QUIET + START_B)).toBe(true);
    expect(modules.endsWith(STOP + QUIET)).toBe(true);
  });

  it("longueur = 2 × silence + 11 × (1 + n + 1) + 13", () => {
    const text = "AX-7K3P9Q";
    const expected = 2 * CODE128_QUIET_MODULES + 11 * (text.length + 2) + 13;
    expect(modulesCode128(text)).toHaveLength(expected);
  });

  it("ne contient que des 0 et des 1", () => {
    expect(/^[01]+$/.test(modulesCode128("REF-42"))).toBe(true);
  });

  it("deux textes différents donnent des codes différents", () => {
    expect(modulesCode128("REF-42")).not.toBe(modulesCode128("REF-43"));
  });
});

describe("SVG", () => {
  it("produit un SVG autonome, sans dépendance ni police", () => {
    const svg = code128Svg("AX-7K3P9Q", { height: 40 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<rect");
    expect(svg).not.toContain("<text");
  });

  it("le viewBox couvre toute la suite de modules", () => {
    const text = "REF-42";
    const modules = modulesCode128(text);
    expect(code128Svg(text)).toContain(`viewBox="0 0 ${modules.length}`);
  });
});

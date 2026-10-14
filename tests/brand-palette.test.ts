/**
 * Lot 4 §7 : extraction des couleurs du logo et construction du kit de marque (modules purs).
 * Vérifie : pixels ignorés, median cut déterministe, choix de la couleur principale, accent,
 * neutres teintés, contrôle AA après correction automatique, et lecture défensive d'un kit stocké.
 */
import { describe, expect, it } from "vitest";
import { extractPalette, isIgnoredPixel, medianCut, pixelsFromRgba } from "@/lib/brand-kit/extract";
import {
  AA_LARGE,
  AA_TEXT,
  adjustLuminance,
  buildBrandKit,
  buildPalette,
  contrastReport,
  hexToHsl,
  hslToHex,
  parseBrandKit,
  pickAccent,
  pickPrimary,
  tintedNeutrals,
} from "@/lib/brand-kit/palette";
import { contrastRatio } from "@/lib/storefront/theme-doc";

const rgba = (pixels: [number, number, number, number][]) => new Uint8ClampedArray(pixels.flat());

describe("extraction des couleurs du logo", () => {
  it("ignore les pixels transparents et quasi blancs", () => {
    expect(isIgnoredPixel(200, 30, 30, 10)).toBe(true); // transparent
    expect(isIgnoredPixel(255, 255, 255, 255)).toBe(true); // blanc
    expect(isIgnoredPixel(250, 250, 248, 255)).toBe(true); // quasi blanc
    expect(isIgnoredPixel(200, 30, 30, 255)).toBe(false);
    expect(isIgnoredPixel(10, 10, 10, 255)).toBe(false); // le noir reste une couleur de marque
  });

  it("ne retient que les pixels utiles", () => {
    const data = rgba([
      [255, 255, 255, 255],
      [0, 0, 0, 0],
      [12, 90, 200, 255],
    ]);
    expect(pixelsFromRgba(data)).toEqual([{ r: 12, g: 90, b: 200 }]);
  });

  it("median cut est déterministe et trié par population", () => {
    const pixels = [
      ...Array.from({ length: 10 }, () => ({ r: 200, g: 20, b: 20 })),
      ...Array.from({ length: 3 }, () => ({ r: 20, g: 20, b: 200 })),
    ];
    const once = medianCut(pixels, 2);
    const twice = medianCut(pixels, 2);
    expect(once).toEqual(twice);
    expect(once).toHaveLength(2);
    expect(once[0]).toBe("#C81414");
  });

  it("renvoie une palette sans doublon depuis un buffer RGBA", () => {
    const data = rgba([
      [230, 57, 70, 255],
      [230, 57, 70, 255],
      [29, 53, 87, 255],
      [255, 255, 255, 255],
    ]);
    const palette = extractPalette(data, { count: 5 });
    expect(palette.length).toBeGreaterThan(0);
    expect(new Set(palette).size).toBe(palette.length);
    expect(palette.every((c) => /^#[0-9A-F]{6}$/.test(c))).toBe(true);
  });

  it("palette vide si le logo n'a que des pixels ignorés", () => {
    expect(extractPalette(rgba([[255, 255, 255, 255], [0, 0, 0, 0]]))).toEqual([]);
  });
});

describe("palette de marque", () => {
  it("choisit la couleur la plus saturée et utilisable", () => {
    expect(pickPrimary(["#F2F2F2", "#E63946", "#8A8F8C"])).toBe("#E63946");
    // Une couleur trop claire est ramenée à une luminance utilisable.
    const fromPale = pickPrimary(["#FDEEEF"]);
    expect(hexToHsl(fromPale).l).toBeLessThanOrEqual(0.72);
  });

  it("accent : 2e couleur du logo assez éloignée, sinon complémentaire", () => {
    expect(pickAccent(["#E63946", "#1D3557"], "#E63946")).not.toBe("#E63946");
    const complement = pickAccent(["#E63946"], "#E63946");
    const dh = Math.abs(hexToHsl(complement).h - hexToHsl("#E63946").h);
    expect(Math.min(dh, 360 - dh)).toBeGreaterThan(90);
  });

  it("neutres teintés : la teinte de la marque est conservée", () => {
    const n = tintedNeutrals("#0D3B2E");
    const dh = Math.abs(hexToHsl(n.background).h - hexToHsl("#0D3B2E").h);
    expect(Math.min(dh, 360 - dh)).toBeLessThan(25);
    expect(hexToHsl(n.background).s).toBeGreaterThan(0);
    expect(hexToHsl(n.background).l).toBeGreaterThan(0.9);
  });

  it("adjustLuminance atteint le seuil et reste idempotente", () => {
    const fixed = adjustLuminance("#BBBBBB", "#FFFFFF", AA_TEXT);
    expect(contrastRatio(fixed, "#FFFFFF")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(adjustLuminance(fixed, "#FFFFFF", AA_TEXT)).toBe(fixed);
  });

  it("toute palette respecte AA après correction automatique", () => {
    const sources = [["#E63946", "#1D3557"], ["#FFD166"], ["#111111", "#222222"], ["#7CC6B6", "#F7F6F2"], ["#F4C7A1"]];
    for (const colors of sources) {
      const p = buildPalette(colors);
      expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(p.muted, p.background)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(p.primaryText, p.primary)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(p.primary, p.background)).toBeGreaterThanOrEqual(AA_LARGE);
      expect(contrastRatio(p.accent, p.background)).toBeGreaterThanOrEqual(AA_LARGE);
      expect(contrastReport(p).every((c) => c.ok)).toBe(true);
    }
  });

  it("le kit complet est déterministe et ses schémas sont lisibles", () => {
    const a = buildBrandKit({ colors: ["#E63946", "#1D3557"], tone: "premium", now: new Date(0) });
    const b = buildBrandKit({ colors: ["#E63946", "#1D3557"], tone: "premium", now: new Date(0) });
    expect(a).toEqual(b);
    expect(a.fontPair).toEqual({ heading: "cormorant", body: "manrope" });
    expect(a.voice).toEqual({ tone: "premium", formal: true });
    expect(contrastReport(a.colors, a.schemes).every((c) => c.ok)).toBe(true);
    expect(a.schemes.map((s) => s.id)).toEqual(["marque", "sombre"]);
  });

  it("un kit sans couleur exploitable reste utilisable", () => {
    const kit = buildBrandKit({ colors: [] });
    expect(contrastReport(kit.colors, kit.schemes).every((c) => c.ok)).toBe(true);
  });
});

describe("lecture d'un kit stocké", () => {
  it("refuse une forme invalide", () => {
    expect(parseBrandKit(null)).toBeNull();
    expect(parseBrandKit({ primary: "rouge" })).toBeNull();
  });

  it("recorrige le contraste d'un kit modifié à la main", () => {
    const kit = buildBrandKit({ colors: ["#0D3B2E"] });
    const tampered = { ...kit, colors: { ...kit.colors, text: "#F8F8F8", muted: "#EEEEEE" } };
    const parsed = parseBrandKit(JSON.parse(JSON.stringify(tampered)));
    expect(parsed).not.toBeNull();
    expect(contrastRatio(parsed!.colors.text, parsed!.colors.background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("hexToHsl / hslToHex sont réciproques", () => {
    for (const hex of ["#E63946", "#1D3557", "#FFFFFF", "#000000", "#7CC6B6"]) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex.toUpperCase());
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  effectiveMotion,
  MAX_ANIMATED_ITEMS_PER_SECTION,
  MOTION_CSS,
  MOTION_TIMINGS,
  motionEnvFromRequest,
  motionItemAttrs,
  motionRootAttrs,
  sectionAnimation,
  sectionMotionAttrs,
} from "@/lib/theme-engine/motion";
import { DEFAULT_MOTION } from "@/lib/theme-engine/types";

/** Contenu de premier niveau hors du bloc `@media (prefers-reduced-motion: no-preference) { … }`. */
function outsideNoPreference(css: string): string {
  const start = css.indexOf("@media (prefers-reduced-motion: no-preference)");
  if (start < 0) return css;
  let depth = 0;
  let i = css.indexOf("{", start);
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) break;
  }
  return css.slice(0, start) + css.slice(i + 1);
}

describe("MOTION_CSS", () => {
  it("toute règle est sous prefers-reduced-motion: no-preference", () => {
    expect(MOTION_CSS.trim().startsWith("@media (prefers-reduced-motion: no-preference)")).toBe(true);
    expect(outsideNoPreference(MOTION_CSS).trim()).toBe("");
  });

  it("jamais de transition: all ; transform et opacity uniquement", () => {
    expect(MOTION_CSS).not.toMatch(/transition\s*:\s*all/);
    expect(MOTION_CSS).not.toMatch(/transition-property\s*:\s*all/);
    for (const m of MOTION_CSS.matchAll(/transition-property:\s*([^;]+);/g)) {
      for (const p of m[1].split(",").map((x) => x.trim())) expect(["opacity", "transform"]).toContain(p);
    }
    // Aucune propriété de mise en page animée.
    expect(MOTION_CSS).not.toMatch(/(?:^|[\s;{])(top|left|width|height|margin)\s*:/);
  });

  it("durées 200 à 600 ms, courbe imposée, décalage ≤ 60 ms", () => {
    for (const m of MOTION_CSS.matchAll(/transition-duration:\s*(\d+)ms/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(200);
      expect(Number(m[1])).toBeLessThanOrEqual(600);
    }
    for (const t of Object.values(MOTION_TIMINGS)) expect(t.staggerMs).toBeLessThanOrEqual(60);
    expect(MOTION_CSS).toContain("cubic-bezier(0.2, 0, 0, 1)");
  });

  it("parallaxe uniquement via animation-timeline sous @supports", () => {
    expect(MOTION_CSS).toMatch(/@supports \(animation-timeline: view\(\)\)/);
  });
});

describe("effectiveMotion", () => {
  it("défaut appliqué aux documents antérieurs", () => {
    expect(effectiveMotion(undefined)).toEqual({ ...DEFAULT_MOTION, enabled: true });
    expect(effectiveMotion({ preset: "lively" })).toMatchObject({ preset: "lively", reveal: true, hoverZoom: true, enabled: true });
  });

  it.each([
    ["Save-Data", { saveData: true }],
    ["mode économie", { lite: true }],
    ["aperçu « Réduire les animations »", { reduce: true }],
  ])("%s désactive tout", (_, env) => {
    const m = effectiveMotion({ preset: "lively", reveal: true, parallax: true, hoverZoom: true }, env);
    expect(m.enabled).toBe(false);
    expect(motionRootAttrs(m)).toEqual({});
    expect(sectionMotionAttrs({ animation: "zoom-in" }, m)).toEqual({});
  });

  it("préréglage none = rien", () => {
    expect(effectiveMotion({ preset: "none" }).enabled).toBe(false);
  });

  it("lecture des signaux de requête", () => {
    expect(motionEnvFromRequest({ saveDataHeader: "on" }).saveData).toBe(true);
    expect(motionEnvFromRequest({ saveDataHeader: "off", liteCookie: "1" })).toMatchObject({ saveData: false, lite: true });
  });
});

describe("attributs", () => {
  const m = effectiveMotion({ preset: "subtle", reveal: true, parallax: true, hoverZoom: true });
  it("racine", () => {
    expect(motionRootAttrs(m)).toEqual({ "data-motion": "subtle", "data-motion-hover": "", "data-motion-parallax": "" });
  });
  it("section : héritage, désactivation par section, apparition coupée", () => {
    expect(sectionAnimation({}, m)).toBe("fade-up");
    expect(sectionAnimation({ animation: "slide-left" }, m)).toBe("slide-left");
    expect(sectionMotionAttrs({ animation: "none" }, m)).toEqual({});
    expect(sectionAnimation({ animation: "zoom-in" }, effectiveMotion({ reveal: false }))).toBe("none");
  });
  it("6 éléments animés maximum par section", () => {
    expect(motionItemAttrs(0)).toEqual({ "data-anim-item": "", style: "--anim-i:0" });
    expect(motionItemAttrs(MAX_ANIMATED_ITEMS_PER_SECTION - 1)).not.toEqual({});
    expect(motionItemAttrs(MAX_ANIMATED_ITEMS_PER_SECTION)).toEqual({});
    expect(motionItemAttrs(-1)).toEqual({});
  });
});

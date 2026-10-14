import { describe, expect, it } from "vitest";
import { isLiteRequest, liteOrigin, liteImageUrl, LITE_COOKIE, LITE_HOME_BUDGET_BYTES, LITE_IMAGE_QUALITY, LITE_MAX_IMAGE_WIDTH, SYSTEM_FONT_STACK } from "@/lib/pwa/lite";
import { motionEnvFromRequest, effectiveMotion } from "@/lib/theme-engine/motion";
import { DEFAULT_MOTION } from "@/lib/theme-engine/types";

/** Lot 4 §14 : activation du mode économie de données et effets mesurables. */

describe("activation du mode économie", () => {
  it("en-tête Save-Data: on", () => {
    expect(isLiteRequest({ saveDataHeader: "on" })).toBe(true);
    expect(isLiteRequest({ saveDataHeader: "ON" })).toBe(true);
    expect(isLiteRequest({ saveDataHeader: " on " })).toBe(true);
    expect(isLiteRequest({ saveDataHeader: "off" })).toBe(false);
    expect(isLiteRequest({})).toBe(false);
  });

  it("interrupteur du pied de page (cookie axi_lite)", () => {
    expect(LITE_COOKIE).toBe("axi_lite");
    expect(isLiteRequest({ liteCookie: "1" })).toBe(true);
    expect(isLiteRequest({ liteCookie: "0" })).toBe(false);
    expect(isLiteRequest({ liteCookie: "n'importe quoi" })).toBe(false);
  });

  it("le choix explicite du visiteur l'emporte sur l'en-tête du navigateur", () => {
    expect(isLiteRequest({ saveDataHeader: "on", liteCookie: "0" })).toBe(false);
    expect(isLiteRequest({ saveDataHeader: "off", liteCookie: "1" })).toBe(true);
  });

  it("origine du mode, affichée dans l'interrupteur", () => {
    expect(liteOrigin({ liteCookie: "1" })).toBe("cookie");
    expect(liteOrigin({ saveDataHeader: "on" })).toBe("header");
    expect(liteOrigin({})).toBe("off");
    expect(liteOrigin({ saveDataHeader: "on", liteCookie: "0" })).toBe("off");
  });
});

describe("effets du mode économie", () => {
  it("aucune animation (contrat partagé avec le moteur d'animations)", () => {
    for (const env of [{ saveDataHeader: "on" }, { liteCookie: "1" }]) {
      const motion = effectiveMotion(DEFAULT_MOTION, motionEnvFromRequest(env));
      expect(motion.enabled).toBe(false);
    }
    expect(effectiveMotion(DEFAULT_MOTION, motionEnvFromRequest({})).enabled).toBe(true);
  });

  it("police système : aucune police à télécharger", () => {
    expect(SYSTEM_FONT_STACK).toMatch(/^system-ui/);
    expect(SYSTEM_FONT_STACK).not.toMatch(/url\(/);
  });

  it("images : largeur plafonnée et qualité réduite sur le CDN", () => {
    const out = liteImageUrl("https://images.unsplash.com/photo-1?w=1600&h=2000&q=80&fit=crop", 1200);
    const url = new URL(out!);
    expect(Number(url.searchParams.get("w"))).toBe(LITE_MAX_IMAGE_WIDTH);
    expect(Number(url.searchParams.get("q"))).toBe(LITE_IMAGE_QUALITY);
    // Le rapport d'aspect est conservé (aucun décalage de mise en page).
    expect(Number(url.searchParams.get("h"))).toBe(Math.round((2000 / 1600) * LITE_MAX_IMAGE_WIDTH));
  });

  it("les médias stockés par la boutique sont laissés intacts (déjà compressés, immuables)", () => {
    expect(liteImageUrl("/media/2026/abc.webp")).toBe("/media/2026/abc.webp");
    expect(liteImageUrl("https://cdn.example.com/x.png")).toBe("https://cdn.example.com/x.png");
    expect(liteImageUrl(null)).toBeNull();
    expect(liteImageUrl("pas une url")).toBe("pas une url");
  });

  it("le budget d'accueil reste celui de la spec (300 Ko)", () => {
    expect(LITE_HOME_BUDGET_BYTES).toBe(307_200);
  });
});

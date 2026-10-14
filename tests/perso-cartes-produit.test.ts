/* eslint-disable @typescript-eslint/no-explicit-any -- documents bruts volontairement non typés */
import { describe, it, expect } from "vitest";
import { isNewProduct, saleBadgeLabel, NEW_PRODUCT_WINDOW_DAYS } from "@/lib/storefront/render-types";
import { defaultThemeDocument } from "@/lib/theme-engine/defaults";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import { sanitizeThemeDocument } from "@/lib/storefront/theme-doc";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

describe("isNewProduct (dérivation du badge « Nouveau »)", () => {
  it("vrai dans la fenêtre de 30 jours (aujourd'hui, 1 j, 30 j pile)", () => {
    expect(isNewProduct(daysAgo(0), NOW)).toBe(true);
    expect(isNewProduct(daysAgo(1), NOW)).toBe(true);
    expect(isNewProduct(daysAgo(NEW_PRODUCT_WINDOW_DAYS), NOW)).toBe(true);
  });
  it("faux au-delà de 30 jours", () => {
    expect(isNewProduct(daysAgo(31), NOW)).toBe(false);
    expect(isNewProduct(daysAgo(365), NOW)).toBe(false);
  });
  it("faux pour une date future ou invalide", () => {
    expect(isNewProduct(daysAgo(-2), NOW)).toBe(false);
    expect(isNewProduct("pas une date", NOW)).toBe(false);
  });
});

describe("saleBadgeLabel (badge promo)", () => {
  it("pourcentage par défaut, texte, ou masqué", () => {
    expect(saleBadgeLabel("percent", 20)).toBe("-20 %");
    expect(saleBadgeLabel("text", 20)).toBe("Promo");
    expect(saleBadgeLabel("hidden", 20)).toBeNull();
  });
  it("respecte le seuil de 5 %", () => {
    expect(saleBadgeLabel("percent", 4)).toBeNull();
    expect(saleBadgeLabel("percent", 5)).toBe("-5 %");
    expect(saleBadgeLabel("text", 4)).toBeNull();
  });
});

describe("réglages cards : nettoyage et validation", () => {
  const fallback = () => defaultThemeDocument("mode");

  it("valeurs par défaut rétro-compatibles (document sans les nouveaux réglages)", () => {
    const doc = fallback();
    const raw = JSON.parse(JSON.stringify(doc));
    delete raw.settings.cards.saleBadge;
    delete raw.settings.cards.style;
    delete raw.settings.cards.showNewBadge;
    const out = sanitizeThemeDocument(raw, doc).settings.cards;
    expect(out.saleBadge).toBe("percent");
    expect(out.style).toBe("standard");
    expect(out.showNewBadge).toBe(false);
    // Validation stricte : les clés absentes sont complétées.
    const v = validateThemeDocument(raw);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.doc.settings.cards.saleBadge).toBe("percent");
      expect(v.doc.settings.cards.style).toBe("standard");
      expect(v.doc.settings.cards.showNewBadge).toBe(false);
    }
  });

  it("conserve des valeurs valides", () => {
    const doc = fallback();
    const raw = JSON.parse(JSON.stringify(doc));
    raw.settings.cards.saleBadge = "text";
    raw.settings.cards.style = "overlay";
    raw.settings.cards.showNewBadge = true;
    const out = sanitizeThemeDocument(raw, doc).settings.cards;
    expect(out.saleBadge).toBe("text");
    expect(out.style).toBe("overlay");
    expect(out.showNewBadge).toBe(true);
    expect(validateThemeDocument(raw).ok).toBe(true);
  });

  it("remplace une valeur invalide par le défaut", () => {
    const doc = fallback();
    const raw = JSON.parse(JSON.stringify(doc));
    raw.settings.cards.saleBadge = "arc-en-ciel";
    raw.settings.cards.style = "diagonal";
    raw.settings.cards.showNewBadge = "oui";
    const out = sanitizeThemeDocument(raw, doc).settings.cards;
    expect(out.saleBadge).toBe("percent");
    expect(out.style).toBe("standard");
    expect(out.showNewBadge).toBe(false);
  });
});

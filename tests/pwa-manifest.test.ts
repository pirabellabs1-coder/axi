import { describe, expect, it } from "vitest";
import { buildManifest, defaultShortName, installabilityIssues, isStoreHost, pwaScope, readPwaConfig, safeColor, DEFAULT_PWA_CONFIG } from "@/lib/pwa/config";

/** Lot 4 §14 : manifeste par boutique, portée selon l'hôte, lecture défensive de `Store.pwaConfig`. */

const store = { slug: "chez-aicha", name: "Chez Aïcha Couture", tagline: "Pagnes et tenues sur mesure", description: null, logoUrl: null };
const colors = { primary: "#0f7a5c", background: "#ffffff" };

describe("portée selon l'hôte", () => {
  it("sous-domaine de boutique et domaine propre : racine du site", () => {
    expect(pwaScope({ slug: "chez-aicha", host: "chez-aicha.axi.africa", appDomain: "axi.africa" })).toBe("/");
    expect(pwaScope({ slug: "chez-aicha", host: "boutique-aicha.bj", appDomain: "axi.africa" })).toBe("/");
    expect(isStoreHost({ host: "chez-aicha.axi.africa", appDomain: "axi.africa" })).toBe(true);
  });

  it("domaine de l'application : sous-chemin de la boutique", () => {
    expect(pwaScope({ slug: "chez-aicha", host: "axi.africa", appDomain: "axi.africa" })).toBe("/s/chez-aicha/");
    expect(pwaScope({ slug: "chez-aicha", host: "www.axi.africa", appDomain: "axi.africa" })).toBe("/s/chez-aicha/");
    expect(pwaScope({ slug: "chez-aicha", host: "localhost:3000", appDomain: "localhost:3000" })).toBe("/s/chez-aicha/");
    expect(pwaScope({ slug: "chez-aicha", host: "127.0.0.1:3000", appDomain: "axi.africa" })).toBe("/s/chez-aicha/");
    expect(pwaScope({ slug: "chez-aicha", host: null, appDomain: "axi.africa" })).toBe("/s/chez-aicha/");
  });
});

describe("lecture de Store.pwaConfig", () => {
  it("valeurs par défaut pour une boutique sans réglage", () => {
    expect(readPwaConfig(null)).toEqual(DEFAULT_PWA_CONFIG);
    expect(readPwaConfig("oups")).toEqual(DEFAULT_PWA_CONFIG);
    expect(readPwaConfig([1, 2])).toEqual(DEFAULT_PWA_CONFIG);
    expect(readPwaConfig({}).enabled).toBe(false);
    expect(readPwaConfig({}).prompt).toBe(true);
  });

  it("liste blanche des icônes : média stocké ou https, jamais de data-URL ni de javascript:", () => {
    expect(readPwaConfig({ icon192: "/media/2026/a.png" }).icon192).toBe("/media/2026/a.png");
    expect(readPwaConfig({ icon192: "https://cdn.example.com/a.png" }).icon192).toBe("https://cdn.example.com/a.png");
    expect(readPwaConfig({ icon192: "data:image/png;base64,AAAA" }).icon192).toBeNull();
    expect(readPwaConfig({ icon192: "javascript:alert(1)" }).icon192).toBeNull();
    expect(readPwaConfig({ icon192: "http://cdn.example.com/a.png" }).icon192).toBeNull();
    expect(readPwaConfig({ icon512: 42 }).icon512).toBeNull();
  });

  it("textes nettoyés et bornés", () => {
    expect(readPwaConfig({ name: "  Chez <b>Aïcha</b>  " }).name).toBe("Chez bAïcha/b");
    expect(readPwaConfig({ shortName: "Boutique très très longue" }).shortName).toHaveLength(12);
    expect(readPwaConfig({ name: "" }).name).toBeNull();
  });
});

describe("manifeste", () => {
  const cfg = readPwaConfig({ enabled: true, icon192: "/media/i192.png", icon512: "/media/i512.png" });

  it("reprend le nom, la portée et la couleur du thème", () => {
    const m = buildManifest(store, cfg, { scope: "/s/chez-aicha/", primary: colors.primary, background: colors.background });
    expect(m.name).toBe(store.name);
    expect(m.short_name).toBe("Chez");
    expect(m.start_url).toBe("/s/chez-aicha/");
    expect(m.scope).toBe("/s/chez-aicha/");
    expect(m.theme_color).toBe("#0f7a5c");
    expect(m.display).toBe("standalone");
    expect(m.lang).toBe("fr");
    expect(m.shortcuts.map((s) => s.url)).toEqual(["/s/chez-aicha/catalogue", "/s/chez-aicha/compte"]);
  });

  it("déclare les icônes 192, 512 et une version masquable", () => {
    const m = buildManifest(store, cfg, { scope: "/", primary: colors.primary, background: colors.background });
    expect(m.icons.map((i) => `${i.sizes}:${i.purpose}`)).toEqual(["192x192:any", "512x512:any", "512x512:maskable"]);
    expect(installabilityIssues(cfg, m)).toEqual([]);
  });

  it("sans icône : la boutique n'est pas déclarée installable", () => {
    const empty = readPwaConfig({ enabled: true });
    const m = buildManifest(store, empty, { scope: "/", primary: colors.primary, background: colors.background });
    expect(m.icons).toHaveLength(0);
    expect(installabilityIssues(empty, m)).toHaveLength(2);
  });

  it("couleur invalide : repli, jamais de valeur arbitraire injectée", () => {
    const m = buildManifest(store, cfg, { scope: "/", primary: "red; }", background: "url(x)" });
    expect(m.theme_color).toBe("#111412");
    expect(m.background_color).toBe("#ffffff");
    expect(safeColor("#ABC", "#000000")).toBe("#abc");
  });

  it("nom court par défaut : premier mot, 12 caractères maximum", () => {
    expect(defaultShortName("Chez Aïcha Couture")).toBe("Chez");
    expect(defaultShortName("Boutique")).toBe("Boutique");
    expect(defaultShortName("Lacoiffeusedequartier Cotonou")).toHaveLength(12);
    expect(defaultShortName("   ")).toBe("Boutique");
  });
});

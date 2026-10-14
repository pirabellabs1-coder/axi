import { describe, it, expect } from "vitest";
import { splitLocalePath, withLocalePath, storeBasePath, storeLocales, suggestLocale, pickFromAcceptLanguage, isPlatformLocale, localeDir } from "@/i18n/locales";

/**
 * Lot 2 §1.1 — segment de langue des URL de boutique (logique pure utilisée par `src/proxy.ts`).
 * Le proxy lui-même est vérifié en réel sur le serveur de dev (rapport d'équipe).
 */

describe("splitLocalePath", () => {
  it("détecte la langue après le slug sur le domaine principal", () => {
    expect(splitLocalePath("/s/chez-aicha/en/p/robe-wax")).toEqual({ locale: "en", path: "/s/chez-aicha/p/robe-wax", slug: "chez-aicha" });
    expect(splitLocalePath("/s/chez-aicha/en")).toEqual({ locale: "en", path: "/s/chez-aicha", slug: "chez-aicha" });
  });

  it("détecte la langue en premier segment seulement sur un hôte de boutique", () => {
    expect(splitLocalePath("/en/p/robe", { storeHost: true })).toEqual({ locale: "en", path: "/p/robe", slug: null });
    expect(splitLocalePath("/en", { storeHost: true })).toEqual({ locale: "en", path: "/", slug: null });
    // Domaine de l'application : /en n'est pas une langue (cela pourrait être une vraie page).
    expect(splitLocalePath("/en/p/robe")).toEqual({ locale: null, path: "/en/p/robe", slug: null });
  });

  it("ne touche ni l'espace marchand, ni la console, ni les segments inconnus", () => {
    expect(splitLocalePath("/app/store_1/langues", { storeHost: true }).locale).toBeNull();
    expect(splitLocalePath("/admin", { storeHost: true }).locale).toBeNull();
    expect(splitLocalePath("/s/chez-aicha/zz/p/robe").locale).toBeNull();
    expect(splitLocalePath("/s/chez-aicha/p/robe").locale).toBeNull();
  });

  it("ne confond pas une boutique nommée comme une langue avec un segment de langue", () => {
    // `/s/fon/...` : « fon » est ici l'adresse de la boutique, le segment de langue vient après.
    expect(splitLocalePath("/s/fon/p/robe")).toEqual({ locale: null, path: "/s/fon/p/robe", slug: "fon" });
    expect(splitLocalePath("/s/fon/fon/p/robe")).toEqual({ locale: "fon", path: "/s/fon/p/robe", slug: "fon" });
  });

  it("est stable (idempotente) et conserve la racine", () => {
    const once = splitLocalePath("/s/x-shop/ar/", {});
    expect(once.path).toBe("/s/x-shop/");
    expect(splitLocalePath(once.path).locale).toBeNull();
    expect(splitLocalePath("/", { storeHost: true })).toEqual({ locale: null, path: "/", slug: null });
  });
});

describe("withLocalePath", () => {
  it("ajoute, remplace et retire le segment de langue", () => {
    expect(withLocalePath("/s/chez-aicha/p/robe", "en")).toBe("/s/chez-aicha/en/p/robe");
    expect(withLocalePath("/s/chez-aicha/en/p/robe", "pt")).toBe("/s/chez-aicha/pt/p/robe");
    expect(withLocalePath("/s/chez-aicha/en/p/robe", null)).toBe("/s/chez-aicha/p/robe");
    expect(withLocalePath("/s/chez-aicha", "ar")).toBe("/s/chez-aicha/ar");
    expect(withLocalePath("/p/robe", "en")).toBe("/en/p/robe");
    expect(withLocalePath("/", "en")).toBe("/en");
  });

  it("construit la base des liens de la boutique", () => {
    expect(storeBasePath("chez-aicha", "fr", "fr")).toBe("/s/chez-aicha");
    expect(storeBasePath("chez-aicha", "en", "fr")).toBe("/s/chez-aicha/en");
  });
});

describe("langues d'une boutique et quota de plan", () => {
  it("applique le quota du plan, langue principale comprise", () => {
    const store = { locale: "fr", enabledLocales: ["en", "pt", "ar"] };
    expect(storeLocales(store, null).all).toEqual(["fr", "en", "pt", "ar"]);
    // Business = 2 langues au total : une seule langue secondaire.
    expect(storeLocales(store, 2)).toMatchObject({ primary: "fr", secondary: ["en"], overQuota: ["pt", "ar"] });
    // Gratuit / Starter = 1 langue : aucune langue secondaire servie, traductions conservées.
    expect(storeLocales(store, 1)).toMatchObject({ secondary: [], overQuota: ["en", "pt", "ar"] });
  });

  it("ignore les langues inconnues, les doublons et la langue principale répétée", () => {
    expect(storeLocales({ locale: "fr", enabledLocales: ["en", "en", "fr", "klingon"] }, null).secondary).toEqual(["en"]);
    expect(storeLocales({ locale: "xx", enabledLocales: [] }, null).primary).toBe("fr");
  });

  it("connaît la direction d'écriture de l'arabe", () => {
    expect(localeDir("ar")).toBe("rtl");
    expect(localeDir("fr")).toBe("ltr");
    expect(isPlatformLocale("fon")).toBe(true);
    expect(isPlatformLocale("de")).toBe(false);
  });
});

describe("suggestion de langue (bandeau, jamais de redirection)", () => {
  it("choisit la première langue acceptée qui est servie", () => {
    expect(pickFromAcceptLanguage("en-GB,en;q=0.9,fr;q=0.8", ["fr", "en"])).toBe("en");
    expect(pickFromAcceptLanguage("de-DE,de;q=0.9", ["fr", "en"])).toBeNull();
    expect(pickFromAcceptLanguage("fr-FR;q=0.2,pt-BR;q=0.9", ["fr", "pt"])).toBe("pt");
  });

  it("ne suggère rien quand la langue affichée est déjà la bonne", () => {
    expect(suggestLocale({ current: "en", cookie: "en", acceptLanguage: "en", served: ["fr", "en"] })).toBeNull();
    expect(suggestLocale({ current: "fr", cookie: "en", acceptLanguage: "fr", served: ["fr", "en"] })).toBe("en");
    // Cookie d'une langue non servie : ignoré, on retombe sur Accept-Language.
    expect(suggestLocale({ current: "fr", cookie: "ar", acceptLanguage: "en-US", served: ["fr", "en"] })).toBe("en");
    expect(suggestLocale({ current: "fr", cookie: null, acceptLanguage: null, served: ["fr", "en"] })).toBeNull();
  });
});

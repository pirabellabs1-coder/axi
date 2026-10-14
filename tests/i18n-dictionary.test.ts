import { describe, it, expect } from "vitest";
import { PLATFORM_LOCALES } from "@/i18n/locales";
import { storefrontTranslator, localizeSectorCopy, dictionaryCoverage, rawDictionary } from "@/i18n/dictionary";
import { fr } from "@/i18n/storefront/fr";
import { notificationLocale, orderStatusMessage } from "@/lib/i18n/notify";

/**
 * Lot 2 §1.1 — dictionnaires d'interface : français complet, anglais complet, autres langues partielles
 * avec repli clé par clé sur le français (jamais deux langues dans un même libellé).
 */

describe("dictionnaires d'interface", () => {
  it("expose un dictionnaire pour chacune des 12 langues de la plateforme", () => {
    for (const l of PLATFORM_LOCALES) expect(Object.keys(rawDictionary(l.code)).length, l.code).toBeGreaterThan(0);
  });

  it("français et anglais sont complets", () => {
    expect(dictionaryCoverage("fr")).toEqual({ translated: Object.keys(fr).length, total: Object.keys(fr).length });
    expect(dictionaryCoverage("en").translated).toBe(dictionaryCoverage("en").total);
  });

  it("une clé absente retombe sur le français, sans mélange dans un même libellé", () => {
    const wo = storefrontTranslator("wo");
    expect(wo.has("nav.home")).toBe(true);
    expect(wo.t("nav.home")).toBe("Kër gi");
    // Clé non couverte en wolof : libellé entièrement français.
    expect(wo.has("checkout.thanks")).toBe(false);
    expect(wo.t("checkout.thanks")).toBe(fr["checkout.thanks"]);
  });

  it("langue inconnue ou absente : français", () => {
    expect(storefrontTranslator("de").locale).toBe("fr");
    expect(storefrontTranslator(null).t("cart.title")).toBe("Panier");
  });

  it("interpole les variables et laisse les inconnues telles quelles", () => {
    expect(storefrontTranslator("en").t("search.results", { count: 3 })).toBe("3 result(s)");
    expect(storefrontTranslator("en").t("locale.suggestion", {})).toBe("View this shop in {language}?");
  });

  it("traduit les formules de secteur en conservant celles du commerçant en français", () => {
    const copy = { catalogTitle: "Nos douceurs", addLabel: "Ajouter", itemNoun: "gâteau" } as Record<string, string>;
    expect(localizeSectorCopy(copy, "fr")).toBe(copy);
    const en = localizeSectorCopy(copy, "en");
    expect(en.catalogTitle).toBe("Our products");
    expect(en.addLabel).toBe("Add");
    // Langue sans clé `copy.itemNoun` : la valeur du secteur est conservée (pas de vide).
    const bm = localizeSectorCopy(copy, "bm");
    expect(bm.itemNoun).toBe("gâteau");
    expect(bm.addLabel).toBe("Fara");
  });
});

describe("notifications dans la langue de la commande", () => {
  it("n'utilise la langue de la commande que si le modèle est complet", () => {
    expect(notificationLocale("en", "CONFIRMED")).toBe("en");
    // Le wolof ne couvre pas les modèles de notification : repli entier sur le français.
    expect(notificationLocale("wo", "CONFIRMED")).toBe("fr");
    expect(notificationLocale(null)).toBe("fr");
    expect(notificationLocale("de")).toBe("fr");
  });

  it("compose le message de statut dans la bonne langue", () => {
    const p = { reference: "CMD-12", customerName: "Aïcha", storeName: "Chez Aïcha", trackUrl: "https://axi.test/suivi/abc" };
    const en = orderStatusMessage({ ...p, status: "READY", orderLocale: "en" })!;
    expect(en.locale).toBe("en");
    expect(en.subject).toBe("Order CMD-12: is ready");
    expect(en.text).toContain("Hello Aïcha,");
    expect(en.text).toContain("https://axi.test/suivi/abc");

    const frMsg = orderStatusMessage({ ...p, status: "READY", orderLocale: "wo" })!;
    expect(frMsg.locale).toBe("fr");
    expect(frMsg.subject).toBe("Commande CMD-12 : est prête");

    // Statut sans message client : aucune notification (comportement d'origine).
    expect(orderStatusMessage({ ...p, status: "PENDING", orderLocale: "en" })).toBeNull();
  });
});

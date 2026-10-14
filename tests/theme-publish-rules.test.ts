import { describe, expect, it } from "vitest";
import { decideStoreGoOnline, publishThemeMessage } from "@/lib/theme/publish-rules";

describe("decideStoreGoOnline", () => {
  const ready = { status: "DRAFT", hasWhatsapp: true, activeProducts: 3, activePaymentMethods: 1 };

  it("met en ligne une boutique DRAFT prête (tous prérequis réunis)", () => {
    const d = decideStoreGoOnline(ready);
    expect(d).toEqual({ alreadyOnline: false, suspended: false, missing: [], bringOnline: true });
  });

  it("ne met pas en ligne et liste les prérequis manquants", () => {
    const d = decideStoreGoOnline({ status: "DRAFT", hasWhatsapp: false, activeProducts: 0, activePaymentMethods: 0 });
    expect(d.bringOnline).toBe(false);
    expect(d.missing).toEqual(["un numéro WhatsApp", "au moins un produit actif", "un moyen de paiement actif"]);
  });

  it("un seul prérequis manquant est bien isolé", () => {
    const d = decideStoreGoOnline({ ...ready, activePaymentMethods: 0 });
    expect(d.bringOnline).toBe(false);
    expect(d.missing).toEqual(["un moyen de paiement actif"]);
  });

  it("boutique déjà en ligne : rien à faire, pas de prérequis évalués", () => {
    const d = decideStoreGoOnline({ status: "PUBLISHED", hasWhatsapp: false, activeProducts: 0, activePaymentMethods: 0 });
    expect(d).toEqual({ alreadyOnline: true, suspended: false, missing: [], bringOnline: false });
  });

  it("CLOSED_TEMPORARILY compte comme déjà en ligne", () => {
    expect(decideStoreGoOnline({ ...ready, status: "CLOSED_TEMPORARILY" }).alreadyOnline).toBe(true);
    expect(decideStoreGoOnline({ ...ready, status: "CLOSED_TEMPORARILY" }).bringOnline).toBe(false);
  });

  it("boutique suspendue : jamais mise en ligne, pas de prérequis listés", () => {
    const d = decideStoreGoOnline({ status: "SUSPENDED", hasWhatsapp: true, activeProducts: 5, activePaymentMethods: 2 });
    expect(d).toEqual({ alreadyOnline: false, suspended: true, missing: [], bringOnline: false });
  });
});

describe("publishThemeMessage", () => {
  it("annonce la mise en ligne", () => {
    expect(publishThemeMessage({ bringOnline: true, suspended: false, missing: [] })).toMatch(/EN LIGNE/);
  });
  it("liste ce qu'il manque", () => {
    expect(publishThemeMessage({ bringOnline: false, suspended: false, missing: ["un numéro WhatsApp"] })).toContain("un numéro WhatsApp");
  });
  it("cas suspendu", () => {
    expect(publishThemeMessage({ bringOnline: false, suspended: true, missing: [] })).toMatch(/suspendue/i);
  });
  it("boutique déjà en ligne : message neutre", () => {
    expect(publishThemeMessage({ bringOnline: false, suspended: false, missing: [] })).toBe("Thème publié sur la boutique");
  });
});

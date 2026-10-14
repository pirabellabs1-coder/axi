/**
 * Noms de domaine : tarification (marge %, minimum, devises, arrondi) et validation des noms (IDN, longueur, TLD).
 * Modules purs : src/lib/domains/pricing.ts, src/lib/domains/names.ts.
 */
import { describe, expect, it } from "vitest";
import { normalizeMargin, priceDomain, usdTotals, usdToCents, DEFAULT_MARGIN } from "@/lib/domains/pricing";
import { parseDomain, domainErrorMessage, sellableTlds, registrarPhone, contactSchema, extensionVariants, sanitizeRegistrarMessage, anonymizedContact } from "@/lib/domains/names";
import { classifyRegistrarError } from "@/lib/domains/registrar/types";
import { ONE, parseRate, FIXED_EUR_PARITIES, mul, invert } from "@/lib/currency/convert";

const rate = (s: string) => parseRate(s)!;

describe("tarification des domaines", () => {
  it("marge en pourcentage du coût de gros", () => {
    // 13 $ × 20 % = 2,60 $ > minimum 1 $
    expect(usdTotals(1300, 1, { percentBps: 2000, minUsdCentsPerYear: 100 })).toEqual({ costUsdCents: 1900, marginUsdCents: 380, totalUsdCents: 2280 }) // 13 $ + 6 $ de zone DNS;
  });

  it("minimum de marge par année quand le pourcentage est trop faible", () => {
    // 13 $ × 10 % = 1,30 $ < minimum 5 $ (× 2 ans = 10 $)
    expect(usdTotals(1300, 2, { percentBps: 1000, minUsdCentsPerYear: 500 })).toEqual({ costUsdCents: 3800, marginUsdCents: 1000, totalUsdCents: 4800 });
  });

  it("refuse un coût ou une durée invalides", () => {
    expect(() => usdTotals(0, 1, DEFAULT_MARGIN)).toThrow();
    expect(() => usdTotals(1300, 0, DEFAULT_MARGIN)).toThrow();
    expect(() => usdTotals(1300, 11, DEFAULT_MARGIN)).toThrow();
  });

  it("USD : arrondi supérieur à l'unité entière, marge = prix − coût", () => {
    const p = priceDomain({ wholesaleUsdCentsPerYear: 1300, years: 1, currency: "USD", rate: ONE, margin: { percentBps: 2000, minUsdCentsPerYear: 100 } });
    expect(p.price).toBe(2300); // (13 + 6) $ + 20 % = 22,80 $ → 23,00 $
    expect(p.cost).toBe(1900);
    expect(p.margin).toBe(400);
    expect(p.fxRate).toBeNull();
  });

  it("EUR (devise à centimes) : conversion exacte puis unité entière supérieure", () => {
    // 1 USD = 0,92 EUR ; total 15,60 $ = 14,352 € → 15,00 €
    const p = priceDomain({ wholesaleUsdCentsPerYear: 1300, years: 1, currency: "EUR", rate: rate("0.92"), margin: { percentBps: 2000, minUsdCentsPerYear: 100 } });
    expect(p.price).toBe(2100); // 22,80 $ × 0,92 = 20,98 € → 21 €
    expect(p.cost).toBe(1748); // 19 × 0,92 = 17,48 €
    expect(p.margin).toBe(352);
    expect(p.fxRate).toBe("0.9200000000");
  });

  it("XOF (sans décimales) : parité BCEAO composée, multiple de 100 FCFA supérieur", () => {
    // USD → XOF = (1 / EURUSD) × 655,957 ; EURUSD = 1,08
    const usdXof = mul(invert(rate("1.08")), FIXED_EUR_PARITIES.XOF);
    const p = priceDomain({ wholesaleUsdCentsPerYear: 1300, years: 1, currency: "XOF", rate: usdXof, margin: { percentBps: 2000, minUsdCentsPerYear: 500 } });
    // marge = max(2,60 $, 5 $) = 5 $ ; total 18 $ × 607,367… = 10 932,6 → 11 000 FCFA
    expect(p.totalUsdCents).toBe(2400); // 19 $ de coût + 5 $ de marge minimale
    expect(p.price).toBe(14_600); // 24 $ = 14 576,9 FCFA → 14 600
    expect(p.price % 100).toBe(0);
    expect(p.cost).toBe(11_540); // 19 $ (13 $ + zone DNS 6 $) ≈ 11 540 FCFA
    expect(p.margin).toBe(14_600 - 11_540);
  });

  it("JPY (sans décimales) : multiple de 100 yens", () => {
    const p = priceDomain({ wholesaleUsdCentsPerYear: 2000, years: 1, currency: "JPY", rate: rate("149.5"), margin: DEFAULT_MARGIN });
    expect(p.price % 100).toBe(0);
    expect(p.price).toBeGreaterThanOrEqual(Math.round(((2000 + Math.max(400, 500)) / 100) * 149.5));
  });

  it("la marge facturée n'est jamais inférieure à la marge USD convertie (l'arrondi profite à la marge)", () => {
    for (const [cur, r] of [["EUR", "0.9123456789"], ["GBP", "0.7712"], ["NGN", "1530.25"], ["XOF", "607.37"]] as const) {
      const p = priceDomain({ wholesaleUsdCentsPerYear: 1199, years: 3, currency: cur, rate: rate(r), margin: { percentBps: 1500, minUsdCentsPerYear: 300 } });
      expect(p.price).toBeGreaterThanOrEqual(p.cost);
      expect(p.margin).toBe(p.price - p.cost);
    }
  });

  it("réglage de marge : valeurs invalides ramenées au défaut", () => {
    expect(normalizeMargin({ percentBps: -1, minUsdCentsPerYear: 1.5 })).toEqual(DEFAULT_MARGIN);
    expect(normalizeMargin({ percentBps: 1500, minUsdCentsPerYear: 0 })).toEqual({ percentBps: 1500, minUsdCentsPerYear: 0 });
    expect(normalizeMargin(null)).toEqual(DEFAULT_MARGIN);
  });

  it("prix Route 53 en dollars → centimes", () => {
    expect(usdToCents(13)).toBe(1300);
    expect(usdToCents(9.99)).toBe(999);
    expect(() => usdToCents(0)).toThrow();
  });
});

describe("validation des noms de domaine", () => {
  const allowed = sellableTlds("com,shop,fr");

  it("normalise la saisie (schéma, www, chemin, majuscules)", () => {
    const r = parseDomain("https://www.MaBoutique.com/produits?x=1", allowed);
    expect(r).toMatchObject({ ascii: "maboutique.com", label: "maboutique", tld: "com" });
  });

  it("IDN : conversion en punycode", () => {
    const r = parseDomain("café.fr", allowed);
    expect(r).toMatchObject({ ascii: "xn--caf-dma.fr", unicode: "café.fr" });
  });

  it("refuse les sous-domaines, tirets en bord, labels trop longs", () => {
    expect(parseDomain("shop.maboutique.com", allowed)).toEqual({ error: "subdomain" });
    expect(parseDomain("-abc.com", allowed)).toMatchObject({ error: "invalid" });
    expect(parseDomain("abc-.com", allowed)).toMatchObject({ error: "invalid" });
    expect(parseDomain(`${"a".repeat(64)}.com`, allowed)).toMatchObject({ error: "invalid" });
    expect(parseDomain(`${"a".repeat(63)}.com`, allowed)).toMatchObject({ ascii: `${"a".repeat(63)}.com` });
    expect(parseDomain("ab--cd.com", allowed)).toMatchObject({ error: "invalid" });
    expect(parseDomain("", allowed)).toEqual({ error: "empty" });
    expect(parseDomain("maboutique", allowed)).toEqual({ error: "no_tld" });
  });

  it(".bj : non vendable par API, message qui oriente vers la connexion d'un domaine existant", () => {
    const r = parseDomain("maboutique.bj", allowed);
    expect(r).toEqual({ error: "tld_not_api", tld: "bj" });
    expect(domainErrorMessage(r as { error: "tld_not_api"; tld: string })).toMatch(/J'ai déjà un domaine/);
  });

  it("extension non proposée", () => {
    expect(parseDomain("maboutique.xyz", allowed)).toEqual({ error: "tld_not_allowed", tld: "xyz" });
  });

  it("liste des extensions : variable d'environnement sinon défaut", () => {
    expect(sellableTlds(" .COM, shop,bad!,")).toEqual(["com", "shop"]);
    expect(sellableTlds("")).toContain("com");
  });

  it("variantes d'extension", () => {
    const p = parseDomain("maboutique.com", allowed);
    expect(extensionVariants(p as Exclude<typeof p, { error: string }>, allowed)).toEqual(["maboutique.shop", "maboutique.fr"]);
  });

  it("téléphone au format Route 53 et validation du titulaire", () => {
    expect(registrarPhone("+22997000000", "BJ")).toBe("+229.97000000");
    expect(registrarPhone("+33612345678", "FR")).toBe("+33.612345678");
    const ok = contactSchema.safeParse({ firstName: "Ada", lastName: "K", email: "a@b.co", phone: "+22997000000", address1: "Rue 12", city: "Cotonou", country: "bj" });
    expect(ok.success && ok.data.country).toBe("BJ");
    expect(contactSchema.safeParse({ firstName: "", lastName: "K", email: "x", phone: "12", address1: "", city: "", country: "Benin" }).success).toBe(false);
  });
});

describe("sécurité (audit domaines)", () => {
  const allowed = sellableTlds("com,fr");

  it("M3 : IDN limité à l'écriture latine (homographes refusés)", () => {
    expect(parseDomain("café.fr", allowed)).toMatchObject({ ascii: "xn--caf-dma.fr" });
    expect(parseDomain("аpple.com", allowed)).toEqual({ error: "script" }); // « а » cyrillique
    expect(parseDomain("пример.com", allowed)).toEqual({ error: "script" });
    expect(parseDomain("例え.com", allowed)).toEqual({ error: "script" });
    expect(domainErrorMessage({ error: "script" })).toMatch(/latins/);
  });

  it("F3 : messages registrar filtrés et tronqués, titulaire anonymisé", () => {
    const m = sanitizeRegistrarMessage("Contact ada@example.com / +229 97 00 00 00 invalide\n" + "x ".repeat(300));
    expect(m).not.toMatch(/ada@example\.com|97 00 00/);
    expect(m.length).toBeLessThanOrEqual(200);
    expect(m).not.toContain("\n");
    expect(anonymizedContact({ country: "BJ" })).toEqual({ anonymized: true, country: "BJ" });
  });

  it("E1 : classement des erreurs registrar", () => {
    expect(classifyRegistrarError({ name: "InvalidInput", $metadata: { httpStatusCode: 400 } })).toBe("refused");
    expect(classifyRegistrarError({ name: "ThrottlingException", $metadata: { httpStatusCode: 400 } })).toBe("throttled");
    expect(classifyRegistrarError({ $metadata: { httpStatusCode: 429 } })).toBe("throttled");
    expect(classifyRegistrarError({ name: "TimeoutError" })).toBe("unknown");
    expect(classifyRegistrarError({ name: "InternalFailure", $metadata: { httpStatusCode: 500 } })).toBe("unknown");
  });
});

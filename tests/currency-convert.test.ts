import { describe, it, expect } from "vitest";
import { convertPlain, convertPrice, exactMinor, formatRate, isFresh, makeFx, parseRate, quoteFromFx, readQuote, resolvePlatformRate, FIXED_EUR_PARITIES, type RateRow } from "@/lib/currency/convert";
import { applyRounding, roundAmount, ruleAllowedFor } from "@/lib/currency/rounding";
import { presentCart, presentCompareAt, presentPrice } from "@/lib/currency/present";
import { chargePlan } from "@/lib/currency/payment";
import { parseEcbXml, ecbUrl } from "@/lib/currency/ecb";
import { pickDisplayCurrency } from "@/lib/currency/pick";
import { priceCart, type PipelineLine } from "@/lib/commerce/checkout-pipeline";

const NOW = new Date("2026-10-11T12:00:00Z");
const ecbRow = (quote: string, rate: string, hoursAgo = 1): RateRow => ({ base: "EUR", quote, rate, source: "ECB", fetchedAt: new Date(NOW.getTime() - hoursAgo * 3600_000) });

function fxXofTo(quote: string, rounding: Parameters<typeof makeFx>[0]["rounding"] = "NONE", markupBps = 0, rows: RateRow[] = []) {
  const r = resolvePlatformRate("XOF", quote, rows);
  if (!r) throw new Error("taux introuvable");
  return makeFx({ base: "XOF", quote, rate: r.rate, rounding, markupBps, source: r.source });
}

describe("parités fixes BCEAO", () => {
  it("XOF → EUR exact : 655 957 FCFA = 1 000,00 €", () => {
    const fx = fxXofTo("EUR");
    expect(convertPrice(655_957, fx)).toBe(100_000);
    expect(convertPlain(655_957, fx)).toBe(100_000);
    expect(formatRate(fx.rate)).toBe("0.0015244902");
  });

  it("6 560 FCFA ≈ 10,00 € (exemple de la spécification)", () => {
    expect(convertPrice(6560, fxXofTo("EUR"))).toBe(1000);
  });

  it("EUR → XOF : 10 € = 6 559,57 → 6 560 FCFA (NONE et NEAREST_5)", () => {
    const r = resolvePlatformRate("EUR", "XOF", [])!;
    expect(r.source).toBe("BCEAO_FIXED");
    expect(r.fetchedAt).toBeNull();
    expect(convertPrice(1000, makeFx({ base: "EUR", quote: "XOF", rate: r.rate, rounding: "NONE" }))).toBe(6560);
    expect(convertPrice(1001, makeFx({ base: "EUR", quote: "XOF", rate: r.rate, rounding: "NONE" }))).toBe(6566);
    expect(convertPrice(1001, makeFx({ base: "EUR", quote: "XOF", rate: r.rate, rounding: "NEAREST_5" }))).toBe(6570);
  });

  it("XOF ↔ XAF = 1 (composition exacte, sans arrondi intermédiaire)", () => {
    const r = resolvePlatformRate("XOF", "XAF", [])!;
    expect(r.rate.num).toBe(r.rate.den);
    expect(convertPrice(123_457, makeFx({ base: "XOF", quote: "XAF", rate: r.rate, rounding: "NONE" }))).toBe(123_457);
  });

  it("les parités fixes ne viennent jamais de la base", () => {
    const rows = [{ base: "EUR", quote: "XOF", rate: "600", source: "ECB", fetchedAt: NOW }];
    expect(convertPrice(655_957, fxXofTo("EUR", "NONE", 0, rows))).toBe(100_000);
    expect(FIXED_EUR_PARITIES.XOF).toBeDefined();
  });
});

describe("arrondis", () => {
  it("NEAREST_5 arrondit TOUJOURS au multiple supérieur (pièces)", () => {
    expect(roundAmount(6561, "NEAREST_5", 0)).toBe(6565);
    expect(roundAmount(6565, "NEAREST_5", 0)).toBe(6565);
    expect(roundAmount(1, "NEAREST_100", 0)).toBe(100);
    // Unités majeures : 5 € pour une devise à centimes.
    expect(roundAmount(1001, "NEAREST_5", 2)).toBe(1500);
  });

  it("UP_TO_99 / UP_TO_95 : plus petite valeur ≥ se terminant par ,99 / ,95", () => {
    expect(convertPrice(6560, fxXofTo("EUR", "UP_TO_99"))).toBe(1099);
    expect(convertPrice(6560, fxXofTo("EUR", "UP_TO_95"))).toBe(1095);
    expect(roundAmount(1099, "UP_TO_99", 2)).toBe(1099);
    expect(roundAmount(1100, "UP_TO_99", 2)).toBe(1199);
    expect(roundAmount(50, "UP_TO_99", 2)).toBe(99);
  });

  it("terminaisons refusées pour une devise sans décimales (repli au plus proche)", () => {
    expect(ruleAllowedFor("UP_TO_99", 0)).toBe(false);
    expect(ruleAllowedFor("NEAREST_5", 0)).toBe(true);
    expect(roundAmount(6561, "UP_TO_99", 0)).toBe(6561);
  });

  it("NONE : demi-unité vers le haut", () => {
    expect(applyRounding(BigInt(5), BigInt(10), "NONE", 2)).toBe(1);
    expect(applyRounding(BigInt(4), BigInt(10), "NONE", 2)).toBe(0);
  });
});

describe("marge, taux, BigInt", () => {
  it("marge de 2 % : 6 560 FCFA → 10,20 €", () => {
    expect(convertPrice(6560, fxXofTo("EUR", "NONE", 200))).toBe(1020);
  });

  it("marge plafonnée à 500 points de base", () => {
    expect(fxXofTo("EUR", "NONE", 9999).markupBps).toBe(500);
  });

  it("taux à 10 décimales : lecture, virgule, excédent arrondi", () => {
    expect(formatRate(parseRate("0,0015244902")!)).toBe("0.0015244902");
    expect(formatRate(parseRate("1.00000000005")!)).toBe("1.0000000001");
    expect(parseRate("0")).toBeNull();
    expect(parseRate("-1")).toBeNull();
    expect(parseRate("abc")).toBeNull();
  });

  it("montants très grands : aucun débordement ni dérive (calcul exact BigInt)", () => {
    const fx = fxXofTo("EUR");
    const big = 9_000_000_000_000; // 9 000 milliards de FCFA
    const e = exactMinor(big, fx);
    const expected = (BigInt(big) * BigInt(100_000) * BigInt(2) + BigInt(655_957)) / (BigInt(655_957) * BigInt(2));
    expect(BigInt(convertPlain(big, fx))).toBe(expected);
    expect(e.den > BigInt(0)).toBe(true);
  });

  it("pivot EUR pour une devise BCE : 655 957 FCFA = 1 084,50 $ si 1 EUR = 1,0845 $", () => {
    const fx = fxXofTo("USD", "NONE", 0, [ecbRow("USD", "1.0845")]);
    expect(convertPrice(655_957, fx)).toBe(108_450);
    expect(fx.source).toBe("BCEAO_FIXED+ECB");
  });

  it("taux de plus de 72 h : non affichable ; parité fixe : toujours fraîche", () => {
    expect(isFresh(resolvePlatformRate("XOF", "USD", [ecbRow("USD", "1.08", 73)])!, NOW)).toBe(false);
    expect(isFresh(resolvePlatformRate("XOF", "USD", [ecbRow("USD", "1.08", 71)])!, NOW)).toBe(true);
    expect(isFresh(resolvePlatformRate("XOF", "EUR", [])!, NOW)).toBe(true);
    expect(resolvePlatformRate("XOF", "NGN", [])).toBeNull();
  });

  it("cotation : aller-retour exact, refus si expirée ou autre devise", () => {
    const fx = fxXofTo("EUR", "NEAREST_5", 150);
    const q = JSON.parse(JSON.stringify(quoteFromFx(fx, NOW)));
    const back = readQuote(q, "XOF", "EUR", new Date(NOW.getTime() + 14 * 60_000))!;
    expect(back.rate).toEqual(fx.rate);
    expect(back.rounding).toBe("NEAREST_5");
    expect(convertPrice(6560, back)).toBe(convertPrice(6560, fx));
    expect(readQuote(q, "XOF", "EUR", new Date(NOW.getTime() + 16 * 60_000))).toBeNull();
    expect(readQuote(q, "XOF", "USD", NOW)).toBeNull();
    expect(readQuote({ ...q, num: "1e5" }, "XOF", "EUR", NOW)).toBeNull();
  });
});

describe("presentCart : conversion APRÈS le pipeline", () => {
  const L = (productId: string, unitPrice: number, quantity: number, over: Partial<PipelineLine> = {}): PipelineLine => ({ productId, name: productId, unitPrice, quantity, collectionIds: [], isGiftCard: false, onSale: false, ...over });

  function sums(p: ReturnType<typeof presentCart>) {
    const lineNet = p.lines.reduce((s, l) => s + l.netTotal, 0);
    expect(p.lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(p.subtotal);
    expect(p.lines.reduce((s, l) => s + l.discountAllocated, 0)).toBe(p.discount);
    expect(p.discounts.reduce((s, d) => s + d.amount, 0)).toBe(p.discount);
    expect(p.total).toBe(lineNet + p.deliveryFee + (p.taxesIncluded ? 0 : p.taxTotal));
  }

  it("Σ lignes + livraison = total affiché, remises converties au plus proche et réparties", () => {
    const priced = priceCart({
      lines: [L("a", 3333, 3), L("b", 7777, 1)],
      delivery: { type: "DELIVERY", fee: 1500 },
      coupon: { id: "c", code: "DIX", type: "PERCENT", value: 10, minSubtotal: 0, active: true, usesCount: 0 },
      now: NOW,
      currency: "XOF",
    });
    const fx = fxXofTo("EUR", "UP_TO_99");
    const p = presentCart(priced, fx);
    sums(p);
    // Prix unitaires convertis PUIS multipliés.
    expect(p.lines[0].unitPrice).toBe(convertPrice(3333, fx));
    expect(p.lines[0].lineTotal).toBe(p.lines[0].unitPrice * 3);
    // Remise : Math.round de la remise en devise boutique.
    expect(p.discounts[0].amount).toBe(convertPlain(priced.discounts[0].amount, fx));
    // Livraison : règle appliquée.
    expect(p.deliveryFee).toBe(convertPrice(1500, fx));
    expect(p.amountDue).toBe(p.total);
  });

  it("seuils évalués en devise boutique : freeAbove atteint en FCFA ⇒ livraison offerte affichée", () => {
    const priced = priceCart({ lines: [L("a", 20000, 1)], delivery: { type: "DELIVERY", fee: 1500, freeAbove: 20000 }, now: NOW, currency: "XOF" });
    const p = presentCart(priced, fxXofTo("EUR", "UP_TO_99"));
    expect(priced.deliveryFee).toBe(0);
    expect(p.deliveryFee).toBe(0);
    sums(p);
  });

  it("taxes recalculées sur les montants convertis (TTC 18 %, livraison taxée)", () => {
    const tax = { enabled: true, pricesIncludeTax: true, rates: [{ name: "TVA", rateBps: 1800, taxCategory: "standard", appliesToShipping: true }] };
    const priced = priceCart({ lines: [L("a", 11800, 2)], delivery: { type: "DELIVERY", fee: 1000 }, now: NOW, currency: "XOF", tax });
    const p = presentCart(priced, fxXofTo("EUR"), { tax });
    sums(p);
    const ht = (n: number) => Math.round((n * 1800) / 11800);
    expect(p.taxTotal).toBe(ht(p.lines[0].netTotal) + ht(p.deliveryFee));
    expect(p.taxLines[0].amount).toBe(p.taxTotal);
  });

  it("taxes HT : ajoutées au total converti", () => {
    const tax = { enabled: true, pricesIncludeTax: false, rates: [{ name: "TVA", rateBps: 1800, taxCategory: "standard", appliesToShipping: false }] };
    const priced = priceCart({ lines: [L("a", 6560, 1)], delivery: { type: "PICKUP" }, now: NOW, currency: "XOF", tax });
    const p = presentCart(priced, fxXofTo("EUR"), { tax });
    expect(p.subtotal).toBe(1000);
    expect(p.taxTotal).toBe(180);
    expect(p.total).toBe(1180);
    sums(p);
  });

  it("prix fixé par devise prioritaire, sauf promo datée ; options converties", () => {
    const priced = priceCart({ lines: [L("a", 6560, 2, { options: [{ name: "XL", priceDelta: 656 }], unitPrice: 7216 }), L("b", 6560, 1, { onSale: true })], delivery: { type: "PICKUP" }, now: NOW, currency: "XOF" });
    const fx = fxXofTo("EUR");
    const p = presentCart(priced, fx, { fixedUnitPrices: [990, 990] });
    expect(p.lines[0].unitPrice).toBe(990 + 100);
    expect(p.lines[0].fixed).toBe(true);
    expect(p.lines[1].unitPrice).toBe(1000);
    sums(p);
  });

  it("remise plafonnée par une ligne à prix fixé plus bas que la conversion", () => {
    const priced = priceCart({ lines: [L("a", 10000, 1)], delivery: { type: "PICKUP" }, coupon: { id: "c", code: "F", type: "FIXED", value: 9000, minSubtotal: 0, active: true, usesCount: 0 }, now: NOW, currency: "XOF" });
    const p = presentCart(priced, fxXofTo("EUR"), { fixedUnitPrices: [500] });
    expect(p.lines[0].netTotal).toBeGreaterThanOrEqual(0);
    expect(p.discount).toBeLessThanOrEqual(p.subtotal);
    sums(p);
  });

  it("prix barré converti avec la même règle ; masqué s'il ne dépasse plus le prix", () => {
    const fx = fxXofTo("EUR", "NEAREST_5");
    const price = presentPrice(6560, fx);
    expect(price).toBe(1500);
    expect(presentCompareAt(6600, price, fx)).toBeNull();
    expect(presentCompareAt(13120, price, fx)).toBe(2500);
  });
});

describe("encaissement", () => {
  it("moyen sans la devise : débit en FCFA avec la mention", () => {
    const plan = chargePlan({ method: { kind: "MOBILE_MONEY_MANUAL", currencies: ["EUR"] }, storeCurrency: "XOF", storeDue: 6560, presentment: { currency: "EUR", amountDue: 1000 } });
    expect(plan.currency).toBe("XOF");
    expect(plan.amount).toBe(6560);
    expect(plan.mention?.replace(/\s/g, " ")).toBe("Vous serez débité de 6 560 FCFA (≈ 10,00 €)");
  });

  it("même devise : aucune mention", () => {
    expect(chargePlan({ method: null, storeCurrency: "XOF", storeDue: 5000, presentment: null }).mention).toBeNull();
  });
});

describe("source BCE et choix de la devise", () => {
  it("analyse le XML BCE, ignore XOF/XAF et les valeurs invalides", () => {
    const xml = `<gesmes:Envelope><Cube><Cube time='2026-10-09'><Cube currency='USD' rate='1.0845'/><Cube currency='XOF' rate='600'/><Cube currency='GBP' rate='abc'/><Cube currency='JPY' rate='162.31'/></Cube></Cube></gesmes:Envelope>`;
    const r = parseEcbXml(xml);
    expect(r.date).toBe("2026-10-09");
    expect(r.rates).toEqual([{ currency: "USD", rate: "1.0845" }, { currency: "JPY", rate: "162.31" }]);
    expect(ecbUrl("http://evil.example")).toMatch(/^https:\/\/www\.ecb\.europa\.eu/);
  });

  it("cookie, puis pays IP, puis langue, puis devise boutique ; seules les devises actives", () => {
    const base = { available: ["EUR", "USD"], storeCurrency: "XOF" };
    expect(pickDisplayCurrency({ ...base, cookie: "USD", ipCountry: "FR" })).toBe("USD");
    expect(pickDisplayCurrency({ ...base, cookie: "GBP", ipCountry: "FR" })).toBe("EUR");
    expect(pickDisplayCurrency({ ...base, acceptLanguage: "en-US,en;q=0.9" })).toBe("USD");
    expect(pickDisplayCurrency({ ...base, ipCountry: "BJ" })).toBe("XOF");
    expect(pickDisplayCurrency({ ...base, cookie: "XOF", ipCountry: "FR" })).toBe("XOF");
    expect(pickDisplayCurrency({ available: [], storeCurrency: "XOF", ipCountry: "FR" })).toBe("XOF");
  });
});

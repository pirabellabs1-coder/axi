import { describe, it, expect } from "vitest";
import { slugify, normalizePhone, formatPhone, initials, truncate, currentPeriod, addMonths } from "@/lib/utils";
import { formatMoney, parseMoneyInput, currencyDecimals, percentOf } from "@/lib/money";

describe("slugify", () => {
  it("retire les accents et normalise", () => {
    expect(slugify("Chez Aïcha — Pâtisserie")).toBe("chez-aicha-patisserie");
    expect(slugify("  Épicerie  Générale ! ")).toBe("epicerie-generale");
    expect(slugify("Côte d'Ivoire")).toBe("cote-d-ivoire");
  });
  it("tronque à 48 caractères", () => {
    expect(slugify("a".repeat(100))).toHaveLength(48);
  });
  it("chaîne vide pour une entrée sans caractère valide", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("normalizePhone", () => {
  it("Bénin : numéros à 10 chiffres (01…) et anciens numéros à 8 chiffres", () => {
    expect(normalizePhone("01 97 00 00 01", "229")).toBe("2290197000001");
    expect(normalizePhone("+229 01 97 00 00 01", "229")).toBe("2290197000001");
    expect(normalizePhone("00229 0197000001", "229")).toBe("2290197000001");
    expect(normalizePhone("97000001", "229")).toBe("2290197000001");
    expect(normalizePhone("+229 97 00 00 01", "229")).toBe("2290197000001");
  });
  it("Côte d'Ivoire : 10 chiffres, 0 initial conservé et identique quelle que soit la saisie", () => {
    expect(normalizePhone("07 00 00 00 01", "225")).toBe("2250700000001");
    expect(normalizePhone("+2250700000001", "225")).toBe("2250700000001");
  });
  it("autres pays : 0 initial retiré", () => {
    expect(normalizePhone("06 12 34 56 78", "33")).toBe("33612345678");
    expect(normalizePhone("77 123 45 67", "221")).toBe("221771234567");
  });
  it("rejette les numéros trop courts ou trop longs", () => {
    expect(normalizePhone("12", "229")).toBeNull();
    expect(normalizePhone("123456789012", "229")).toBeNull();
    expect(normalizePhone("", "229")).toBeNull();
    expect(normalizePhone("abc", "229")).toBeNull();
  });
  it("ignore les caractères parasites", () => {
    expect(normalizePhone("(+229) 01-97-00-00-01", "229")).toBe("2290197000001");
  });
});


describe("formatPhone", () => {
  it("formate en groupes de deux", () => {
    expect(formatPhone("22997000001")).toBe("+229 97 00 00 01");
    expect(formatPhone("2250719202122")).toBe("+225 07 19 20 21 22");
    expect(formatPhone("225719202122")).toBe("+225 7 19 20 21 22");
  });
  it("préfixe simplement si le format est inattendu", () => {
    expect(formatPhone("12")).toBe("+12");
  });
});

describe("formatMoney", () => {
  it("XOF sans décimales, espace insécable avant FCFA", () => {
    const s = formatMoney(4900, "XOF");
    expect(s.endsWith(" FCFA")).toBe(true);
    expect(s).not.toMatch(/[.,]\d{2} FCFA$/);
    expect(s.replace(/[   ]/g, "")).toBe("4900FCFA");
  });
  it("sépare les milliers", () => {
    expect(formatMoney(1250000, "XOF").replace(/ FCFA$/, "").replace(/[   ]/g, "")).toBe("1250000");
    expect(formatMoney(1250000, "XOF")).toMatch(/^1[   ]250[   ]000 FCFA$/);
  });
  it("zéro", () => {
    expect(formatMoney(0)).toBe("0 FCFA"); // U+00A0 avant FCFA
  });
  it("EUR : centimes → format devise", () => {
    expect(formatMoney(1050, "EUR")).toMatch(/10,50/);
  });
  it("currencyDecimals", () => {
    expect(currencyDecimals("XOF")).toBe(0);
    expect(currencyDecimals("XAF")).toBe(0);
    expect(currencyDecimals("EUR")).toBe(2);
  });
});

describe("parseMoneyInput", () => {
  it("accepte espaces, espaces insécables et virgules", () => {
    expect(parseMoneyInput("4 900")).toBe(4900);
    expect(parseMoneyInput("4 900")).toBe(4900);
    expect(parseMoneyInput("4900")).toBe(4900);
    expect(parseMoneyInput("49,00", "XOF")).toBe(49);
  });
  it("EUR en centimes", () => {
    expect(parseMoneyInput("10,50", "EUR")).toBe(1050);
    expect(parseMoneyInput("10.5", "EUR")).toBe(1050);
  });
  it("rejette vide, négatif et non numérique", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("-5")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
  });
  it("percentOf arrondit", () => {
    expect(percentOf(27000, 10)).toBe(2700);
    expect(percentOf(999, 33)).toBe(330);
  });
});

describe("divers", () => {
  it("initials", () => {
    expect(initials("Aïcha Koné")).toBe("AK");
    expect(initials("  mono ")).toBe("M");
    expect(initials("Jean Marc Kouassi")).toBe("JM");
  });
  it("truncate", () => {
    expect(truncate("Bonjour", 10)).toBe("Bonjour");
    expect(truncate("Bonjour tout le monde", 10)).toBe("Bonjour t…");
  });
  it("currentPeriod et addMonths", () => {
    expect(currentPeriod(new Date(2026, 9, 10))).toBe("2026-10");
    expect(currentPeriod(new Date(2026, 0, 1))).toBe("2026-01");
    expect(addMonths(new Date(2026, 9, 10), 1).getMonth()).toBe(10);
    expect(addMonths(new Date(2026, 11, 10), 1).getFullYear()).toBe(2027);
  });
});

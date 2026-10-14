import { describe, it, expect } from "vitest";
import { displayPlanPrice, formatPrice } from "@/lib/marketing/pricing";

const clean = (s: string) => s.replace(/\s/g, " ");

describe("formatPrice (site vitrine)", () => {
  it("retire les décimales nulles en euros", () => {
    expect(clean(formatPrice(2900, "EUR"))).toBe("29 €");
  });
  it("garde les centimes utiles", () => {
    expect(clean(formatPrice(2417, "EUR"))).toBe("24,17 €");
  });
  it("affiche le FCFA sans décimales", () => {
    expect(clean(formatPrice(15000, "XOF"))).toBe("15 000 FCFA");
  });
});

describe("displayPlanPrice", () => {
  it("Gratuit", () => {
    const p = displayPlanPrice("FREE", "WORLD", "MONTHLY");
    expect(p.kind).toBe("free");
    if (p.kind === "free") expect(clean(p.label)).toBe("0 €");
  });
  it("Business mensuel en euros", () => {
    const p = displayPlanPrice("BUSINESS", "WORLD", "MONTHLY");
    expect(p.kind).toBe("paid");
    if (p.kind === "paid") {
      expect(clean(p.perMonth)).toBe("29 €");
      expect(p.billed).toBeNull();
    }
  });
  it("Business annuel en euros : 10 mois payés pour 12", () => {
    const p = displayPlanPrice("BUSINESS", "WORLD", "YEARLY");
    if (p.kind !== "paid") throw new Error("attendu : paid");
    expect(clean(p.perMonth)).toBe("24,17 €");
    expect(clean(p.billed ?? "")).toBe("290 € facturés par an");
  });
  it("Starter annuel en FCFA", () => {
    const p = displayPlanPrice("STARTER", "AFRICA", "YEARLY");
    if (p.kind !== "paid") throw new Error("attendu : paid");
    expect(clean(p.perMonth)).toBe("4 167 FCFA");
  });
});

import { describe, it, expect } from "vitest";
import { apiNumberDigits, internationalDigits, normalizeWaNumber, sameNumber } from "@/lib/whatsapp/phone-sync";

describe("phone-sync", () => {
  it("accepte un numéro international explicite quel que soit le pays de la boutique", () => {
    expect(internationalDigits("+1 555-475-7216")).toBe("15554757216");
    expect(internationalDigits("0033612345678")).toBe("33612345678");
    expect(internationalDigits("97000000")).toBeNull();
    expect(normalizeWaNumber("+15554757216", "229")).toBe("15554757216");
  });
  it("garde le comportement national pour une saisie locale", () => {
    expect(normalizeWaNumber("0197000000", "229")).toBe("2290197000000");
    expect(normalizeWaNumber("abc", "229")).toBeNull();
  });
  it("lit le numéro affiché par Meta", () => {
    expect(apiNumberDigits("+1 555-394-7441")).toBe("15553947441");
    expect(apiNumberDigits(null)).toBeNull();
    expect(apiNumberDigits("123")).toBeNull();
  });
  it("compare deux numéros sur leurs chiffres", () => {
    expect(sameNumber("15553947441", "+1 555-394-7441")).toBe(true);
    expect(sameNumber("2290168884534", "15553947441")).toBe(false);
    expect(sameNumber("", "")).toBe(false);
  });
});

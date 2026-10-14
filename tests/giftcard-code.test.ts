import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  GIFT_CARD_ALPHABET,
  formatGiftCardCode,
  generateGiftCardCode,
  giftCardLast4,
  hashGiftCardCode,
  normalizeGiftCardCode,
  sameGiftCardHash,
} from "@/lib/giftcards/code";

const SECRET = "test-secret-0123456789-0123456789-abcdef";

describe("codes de cartes cadeaux : format", () => {
  it("alphabet Crockford sans I, L, O, U (32 symboles, 80 bits sur 16 caractères)", () => {
    expect(GIFT_CARD_ALPHABET).toHaveLength(32);
    for (const c of "ILOU") expect(GIFT_CARD_ALPHABET).not.toContain(c);
  });

  it("génère 16 caractères de l'alphabet, sans répétition sur un échantillon", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = generateGiftCardCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
      seen.add(code);
    }
    expect(seen.size).toBe(500);
  });

  it("affichage XXXX-XXXX-XXXX-XXXX et 4 derniers caractères", () => {
    expect(formatGiftCardCode("KD7M4XQ29PRTH3VW")).toBe("KD7M-4XQ2-9PRT-H3VW");
    expect(giftCardLast4("KD7M4XQ29PRTH3VW")).toBe("H3VW");
  });
});

describe("codes de cartes cadeaux : normalisation de la saisie", () => {
  it("majuscules, sans espaces ni tirets", () => {
    expect(normalizeGiftCardCode(" kd7m-4xq2 9prt-h3vw ")).toBe("KD7M4XQ29PRTH3VW");
  });
  it("O→0, I/L→1", () => {
    expect(normalizeGiftCardCode("ABCD-EFGH-JKMN-PQOI")).toBe("ABCDEFGHJKMNPQ01");
    expect(normalizeGiftCardCode("abcd-efgh-jkmn-pqol")).toBe("ABCDEFGHJKMNPQ01");
  });
  it("refuse longueur incorrecte, U, caractères étrangers, non-chaîne", () => {
    expect(normalizeGiftCardCode("KD7M-4XQ2-9PRT-H3V")).toBeNull();
    expect(normalizeGiftCardCode("KD7M-4XQ2-9PRT-H3VWX")).toBeNull();
    expect(normalizeGiftCardCode("KD7M-4XQ2-9PRT-H3VU")).toBeNull();
    expect(normalizeGiftCardCode("KD7M-4XQ2-9PRT-H3V*")).toBeNull();
    expect(normalizeGiftCardCode(42)).toBeNull();
    expect(normalizeGiftCardCode("x".repeat(100))).toBeNull();
  });
});

describe("codes de cartes cadeaux : HMAC par boutique", () => {
  it("respecte exactement la dérivation du seed (clé = HMAC(APP_SECRET, 'giftcard'), message storeId:code, hex)", () => {
    const key = createHmac("sha256", SECRET).update("giftcard").digest();
    const expected = createHmac("sha256", key).update("store_A:KD7M4XQ29PRTH3VW").digest("hex");
    expect(hashGiftCardCode("store_A", "KD7M4XQ29PRTH3VW", SECRET)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
  it("même code, boutiques différentes : empreintes différentes (carte de A inutilisable sur B)", () => {
    expect(hashGiftCardCode("store_A", "KD7M4XQ29PRTH3VW", SECRET)).not.toBe(hashGiftCardCode("store_B", "KD7M4XQ29PRTH3VW", SECRET));
  });
  it("dépend du secret ; refuse un secret absent ou trop court", () => {
    expect(hashGiftCardCode("s", "KD7M4XQ29PRTH3VW", SECRET)).not.toBe(hashGiftCardCode("s", "KD7M4XQ29PRTH3VW", `${SECRET}x`));
    expect(() => hashGiftCardCode("s", "KD7M4XQ29PRTH3VW", "court")).toThrow(/APP_SECRET/);
  });
  it("comparaison d'empreintes", () => {
    const h = hashGiftCardCode("s", "KD7M4XQ29PRTH3VW", SECRET);
    expect(sameGiftCardHash(h, h)).toBe(true);
    expect(sameGiftCardHash(h, h.slice(0, -1) + (h.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(sameGiftCardHash(h, "abc")).toBe(false);
  });
});

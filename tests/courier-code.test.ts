import { describe, it, expect } from "vitest";
import {
  checkDeliveryCode,
  courierTokenExpiry,
  firstNameOnly,
  isCourierTokenValid,
  maskPhone,
  normalizeDeliveryCode,
  COURIER_TOKEN_DAYS,
  MAX_DELIVERY_CODE_ATTEMPTS,
} from "@/lib/shipping/courier-code";

/** Preuve de remise et minimisation des données personnelles (lot 3 §1.2 et §6). */

describe("normalizeDeliveryCode", () => {
  it("accepte 4 chiffres, espaces et tirets compris", () => {
    expect(normalizeDeliveryCode("12 34")).toBe("1234");
    expect(normalizeDeliveryCode("1-2-3-4")).toBe("1234");
  });

  it("refuse toute autre longueur", () => {
    expect(normalizeDeliveryCode("123")).toBeNull();
    expect(normalizeDeliveryCode("12345")).toBeNull();
    expect(normalizeDeliveryCode("")).toBeNull();
  });
});

describe("checkDeliveryCode", () => {
  const expected = "hash-du-bon-code";

  it("accepte le bon code", () => {
    expect(checkDeliveryCode({ input: "1234", fingerprint: expected, expected, attempts: 0 })).toEqual({ ok: true, attempts: 0 });
  });

  it("compte les essais et refuse au-delà de 5", () => {
    let attempts = 0;
    for (let i = 0; i < MAX_DELIVERY_CODE_ATTEMPTS; i++) {
      const r = checkDeliveryCode({ input: "0000", fingerprint: "mauvais", expected, attempts });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        attempts = r.attempts;
        expect(r.reason).toBe("mismatch");
      }
    }
    expect(attempts).toBe(MAX_DELIVERY_CODE_ATTEMPTS);
    const blocked = checkDeliveryCode({ input: "1234", fingerprint: expected, expected, attempts });
    expect(blocked).toMatchObject({ ok: false, reason: "blocked", remaining: 0 });
  });

  it("un bon code reste accepté tant que le blocage n'est pas atteint", () => {
    expect(checkDeliveryCode({ input: "1234", fingerprint: expected, expected, attempts: MAX_DELIVERY_CODE_ATTEMPTS - 1 }).ok).toBe(true);
  });

  it("signale un format invalide sans consommer d'essai", () => {
    const r = checkDeliveryCode({ input: "12", fingerprint: null, expected, attempts: 2 });
    expect(r).toMatchObject({ ok: false, reason: "format", attempts: 2 });
  });

  it("aucun code attendu : la vérification échoue proprement (photo de preuve exigée)", () => {
    expect(checkDeliveryCode({ input: "1234", fingerprint: "x", expected: null, attempts: 0 })).toMatchObject({ ok: false, reason: "unset" });
  });
});

describe("jeton livreur", () => {
  it("expire après 7 jours", () => {
    const created = new Date("2026-10-01T08:00:00Z");
    const expiry = courierTokenExpiry(created);
    expect(expiry.getTime() - created.getTime()).toBe(COURIER_TOKEN_DAYS * 24 * 3_600_000);
    expect(isCourierTokenValid(expiry, new Date("2026-10-07T07:00:00Z"))).toBe(true);
    expect(isCourierTokenValid(expiry, new Date("2026-10-09T09:00:00Z"))).toBe(false);
  });

  it("un jeton sans date d'expiration n'est pas valable", () => {
    expect(isCourierTokenValid(null)).toBe(false);
    expect(isCourierTokenValid("pas-une-date")).toBe(false);
  });
});

describe("minimisation des données personnelles", () => {
  it("masque partiellement le téléphone", () => {
    const masked = maskPhone("22997123456");
    expect(masked.startsWith("22")).toBe(true);
    expect(masked.endsWith("56")).toBe(true);
    expect(masked).toContain("•");
    expect(masked).not.toContain("7123");
  });

  it("gère les numéros courts et vides", () => {
    expect(maskPhone(null)).toBe("—");
    expect(maskPhone("1234")).toBe("••••");
  });

  it("ne garde que le prénom", () => {
    expect(firstNameOnly("Awa Koffi Dossou")).toBe("Awa");
    expect(firstNameOnly("  ")).toBe("Client");
    expect(firstNameOnly(null)).toBe("Client");
  });
});

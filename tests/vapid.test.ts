import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode } from "@/lib/push/encrypt";
import { audienceOf, decodeJwtPayload, generateVapidKeys, normalizeSubject, publicKeyFromPrivate, signVapidJwt, VAPID_MAX_TTL_SEC, vapidHeaders, verifyVapidJwt } from "@/lib/push/vapid";

/**
 * Exemple de la RFC 8292 §2.4 (figures 1 et 2). ECDSA n'étant pas déterministe, la signature de l'exemple
 * ne peut pas être reproduite : on vérifie que l'en-tête et la charge utile encodés sont identiques, que la
 * signature de la RFC est valide pour la clé publique de la RFC, et que nos propres jetons se vérifient.
 */
const RFC8292 = {
  token:
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1haWx0bzpwdXNoQGV4YW1wbGUuY29tIn0." +
    "i3CYb7t4xfxCDquptFOepC9GAu_HLGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA",
  publicKey: "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs",
  jwk: { x: "DUfHPKLVFQzVvnCPGyfucbECzPDa7rWbXriLcysAjEc", y: "F6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs" },
  audience: "https://push.example.net",
  subject: "mailto:push@example.com",
  exp: 1453523768,
};

describe("RFC 8292 — jeton VAPID ES256", () => {
  it("encode l'en-tête et la charge utile exactement comme la RFC", () => {
    const keys = generateVapidKeys();
    const token = signVapidJwt({ audience: RFC8292.audience, subject: RFC8292.subject, expiresAt: RFC8292.exp }, keys);
    const [header, body] = token.split(".");
    expect(`${header}.${body}`).toBe(RFC8292.token.split(".").slice(0, 2).join("."));
  });

  it("vérifie la signature de l'exemple de la RFC avec la clé publique de l'exemple", () => {
    expect(verifyVapidJwt(RFC8292.token, RFC8292.publicKey)).toBe(true);
  });

  it("la clé publique de la RFC correspond au JWK publié (x ‖ y)", () => {
    const raw = b64urlDecode(RFC8292.publicKey);
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(0x04);
    expect(b64urlEncode(raw.subarray(1, 33))).toBe(RFC8292.jwk.x);
    expect(b64urlEncode(raw.subarray(33, 65))).toBe(RFC8292.jwk.y);
  });

  it("rejette une signature altérée", () => {
    const altered = `${RFC8292.token.slice(0, -4)}AAAA`;
    expect(verifyVapidJwt(altered, RFC8292.publicKey)).toBe(false);
    expect(verifyVapidJwt("pas-un-jeton", RFC8292.publicKey)).toBe(false);
  });
});

describe("Paires de clés", () => {
  it("génère une paire P-256 valide et retrouve la publique depuis la privée", () => {
    const keys = generateVapidKeys();
    expect(b64urlDecode(keys.privateKey).length).toBe(32);
    expect(b64urlDecode(keys.publicKey).length).toBe(65);
    expect(publicKeyFromPrivate(keys.privateKey)).toBe(keys.publicKey);
  });

  it("un jeton signé se vérifie avec sa clé publique, pas avec une autre", () => {
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    const token = signVapidJwt({ audience: "https://fcm.googleapis.com", subject: "mailto:contact@example.com", expiresAt: 2000000000 }, a);
    expect(verifyVapidJwt(token, a.publicKey)).toBe(true);
    expect(verifyVapidJwt(token, b.publicKey)).toBe(false);
  });
});

describe("En-tête d'autorisation", () => {
  const keys = generateVapidKeys();

  it("porte le schéma vapid, le jeton et la clé publique", () => {
    const { Authorization } = vapidHeaders("https://fcm.googleapis.com/fcm/send/abc123", keys, { subject: "mailto:contact@example.com", now: new Date("2026-10-12T10:00:00Z") });
    const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(Authorization);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(keys.publicKey);
    expect(verifyVapidJwt(m![1], keys.publicKey)).toBe(true);
    const payload = decodeJwtPayload(m![1])!;
    expect(payload.aud).toBe("https://fcm.googleapis.com");
    expect(payload.sub).toBe("mailto:contact@example.com");
    expect(payload.exp).toBe(Math.floor(Date.parse("2026-10-12T10:00:00Z") / 1000) + VAPID_MAX_TTL_SEC);
  });

  it("l'audience est l'origine du point de terminaison, jamais le chemin", () => {
    expect(audienceOf("https://updates.push.services.mozilla.com/wpush/v2/gAAA?x=1")).toBe("https://updates.push.services.mozilla.com");
    expect(() => audienceOf("http://push.example.net/x")).toThrow();
  });

  it("l'expiration reste sous 24 h même si on demande plus", () => {
    const { Authorization } = vapidHeaders("https://push.example.net/p/1", keys, { subject: "mailto:a@b.co", now: new Date(0), ttlSec: 999999 });
    const exp = decodeJwtPayload(Authorization.split("t=")[1].split(",")[0])!.exp as number;
    expect(exp).toBeLessThan(24 * 3600);
    expect(exp).toBe(VAPID_MAX_TTL_SEC);
  });

  it("refuse un sujet qui n'est ni mailto: ni https:", () => {
    expect(() => normalizeSubject("axi.africa")).toThrow();
    expect(normalizeSubject(" mailto:contact@axi.africa ")).toBe("mailto:contact@axi.africa");
    expect(normalizeSubject("https://axi.africa/contact")).toBe("https://axi.africa/contact");
  });
});

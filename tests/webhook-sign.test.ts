import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { computeSignature, generateWebhookSecret, isWebhookSecret, parseSignatureHeader, secretDisplayPrefix, signatureHeader, verifySignature } from "@/lib/webhooks/sign";
import { decodeKeyring, encodeKeyring, rotateKeyring, signingSecrets, ROTATION_OVERLAP_MS } from "@/lib/webhooks/keyring";

const SECRET = "whsec_" + "A".repeat(43);
const BODY = '{"id":"evt_1","type":"order.created","data":{"id":"o1"}}';
const T = 1_760_000_000;

describe("signature des webhooks", () => {
  it("vecteur de référence : HMAC-SHA256(secret, t + '.' + corps) en hexadécimal", () => {
    const expected = createHmac("sha256", SECRET).update(`${T}.${BODY}`).digest("hex");
    expect(computeSignature(SECRET, T, BODY)).toBe(expected);
    expect(signatureHeader([SECRET], T, BODY)).toBe(`t=${T},v1=${expected}`);
    // Vecteur figé (non régression du format)
    expect(computeSignature("whsec_test", 1, "{}")).toBe(createHmac("sha256", "whsec_test").update("1.{}").digest("hex"));
  });

  it("secret généré : whsec_ + 32 octets base64url, préfixe affichable court", () => {
    const s = generateWebhookSecret();
    expect(isWebhookSecret(s)).toBe(true);
    expect(Buffer.from(s.slice(6), "base64url").length).toBe(32);
    expect(secretDisplayPrefix(s)).toHaveLength(10);
    expect(generateWebhookSecret()).not.toBe(s);
  });

  it("vérifie dans la tolérance de 5 min, refuse au-delà (rejeu)", () => {
    const h = signatureHeader([SECRET], T, BODY);
    expect(verifySignature(h, BODY, [SECRET], { nowSec: T + 299 })).toEqual({ ok: true });
    expect(verifySignature(h, BODY, [SECRET], { nowSec: T - 299 })).toEqual({ ok: true });
    expect(verifySignature(h, BODY, [SECRET], { nowSec: T + 301 })).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("refuse un corps modifié, un mauvais secret, un en-tête malformé", () => {
    const h = signatureHeader([SECRET], T, BODY);
    expect(verifySignature(h, BODY + " ", [SECRET], { nowSec: T }).ok).toBe(false);
    expect(verifySignature(h, BODY, ["whsec_" + "B".repeat(43)], { nowSec: T }).ok).toBe(false);
    expect(verifySignature("v1=abc", BODY, [SECRET], { nowSec: T })).toEqual({ ok: false, reason: "malformed" });
    expect(verifySignature(null, BODY, [SECRET], { nowSec: T })).toEqual({ ok: false, reason: "malformed" });
    expect(parseSignatureHeader(`t=${T},v1=zz`)).toBeNull();
  });

  it("rotation : double signature pendant 24 h, l'un ou l'autre secret vérifie", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    const next = "whsec_" + "N".repeat(43);
    const k = rotateKeyring({ current: SECRET }, next, now);
    expect(k.current).toBe(next);
    expect(signingSecrets(k, now)).toEqual([next, SECRET]);
    expect(signingSecrets(k, new Date(now.getTime() + ROTATION_OVERLAP_MS + 1))).toEqual([next]);
    const h = signatureHeader(signingSecrets(k, now), T, BODY);
    expect(h.split(",v1=").length).toBe(3);
    expect(verifySignature(h, BODY, [SECRET], { nowSec: T }).ok).toBe(true);
    expect(verifySignature(h, BODY, [next], { nowSec: T }).ok).toBe(true);
  });

  it("trousseau : encodage aller-retour et secret nu hérité", () => {
    const k = rotateKeyring({ current: SECRET }, "whsec_" + "N".repeat(43));
    expect(decodeKeyring(encodeKeyring(k))).toEqual(k);
    expect(decodeKeyring(SECRET)).toEqual({ current: SECRET });
    expect(() => decodeKeyring('{"v":1}')).toThrow();
  });
});

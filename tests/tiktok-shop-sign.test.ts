import { describe, it, expect } from "vitest";
import { signRequest, verifyWebhookSignature, webhookSignature } from "@/lib/tiktok-shop/sign";
import { createState, verifyState, STATE_TTL_MS } from "@/lib/tiktok-shop/state";
import { isCountryCovered, marketFor } from "@/lib/tiktok-shop/markets";

/**
 * Signature Open API TikTok Shop et webhooks : vecteurs calculés indépendamment (Python hmac/hashlib) selon
 * l'algorithme documenté (secret + chemin + paramètres triés hors sign/access_token + corps + secret).
 */
const SECRET = "test_app_secret_123";

describe("signRequest", () => {
  it("vecteur JSON : paramètres triés, sign et access_token exclus, corps inclus", () => {
    const sign = signRequest({
      path: "/order/202309/orders/search",
      query: { app_key: "29a39d", timestamp: "1700000000", shop_cipher: "ROW_abc", page_size: "20", access_token: "IGNORED", sign: "IGNORED" },
      body: '{"order_status":"AWAITING_SHIPMENT"}',
      contentType: "application/json",
      appSecret: SECRET,
    });
    expect(sign).toBe("8d6e20e6737b595af2059a5cd50761b4f8680d878a6c9fcf5f3fe9b26721af37");
  });

  it("vecteur multipart : le corps n'entre pas dans la signature", () => {
    const sign = signRequest({ path: "/product/202309/images/upload", query: { timestamp: "1700000000", app_key: "29a39d" }, body: "BINARY", contentType: "multipart/form-data; boundary=x", appSecret: SECRET });
    expect(sign).toBe("22eb000b8fb447bb86aa972e5f65ae28f6becd64f5c84cbdd0bd4d9166f01e47");
  });

  it("l'ordre des paramètres fournis n'a pas d'effet ; une valeur modifiée change la signature", () => {
    const a = signRequest({ path: "/p", query: { b: "2", a: "1" }, appSecret: SECRET });
    const b = signRequest({ path: "/p", query: { a: "1", b: "2" }, appSecret: SECRET });
    const c = signRequest({ path: "/p", query: { a: "1", b: "3" }, appSecret: SECRET });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("webhook", () => {
  const raw = '{"type":1,"tts_notification_id":"7327","shop_id":"7494","timestamp":1700000000,"data":{"order_id":"576","order_status":"AWAITING_SHIPMENT"}}';
  it("vecteur : HMAC(app_secret, app_key + corps)", () => {
    expect(webhookSignature("29a39d", SECRET, raw)).toBe("b68f4774c58f280a0b75caad5aeaa213038989ad964ca0fe71c5505145b9ed6b");
  });
  it("accepte la bonne signature, refuse corps modifié, signature absente ou mal formée", () => {
    const header = webhookSignature("29a39d", SECRET, raw);
    expect(verifyWebhookSignature({ appKey: "29a39d", appSecret: SECRET, rawBody: raw, header })).toBe(true);
    expect(verifyWebhookSignature({ appKey: "29a39d", appSecret: SECRET, rawBody: Buffer.from(raw), header: header.toUpperCase() })).toBe(true);
    expect(verifyWebhookSignature({ appKey: "29a39d", appSecret: SECRET, rawBody: raw.replace("576", "577"), header })).toBe(false);
    expect(verifyWebhookSignature({ appKey: "29a39d", appSecret: SECRET, rawBody: raw, header: null })).toBe(false);
    expect(verifyWebhookSignature({ appKey: "29a39d", appSecret: SECRET, rawBody: raw, header: "abc" })).toBe(false);
    expect(verifyWebhookSignature({ appKey: "other", appSecret: SECRET, rawBody: raw, header })).toBe(false);
  });
});

describe("state OAuth", () => {
  const KEY = "k".repeat(40);
  it("aller-retour valide : même utilisateur, même nonce", () => {
    const { state, nonce } = createState(KEY, { storeId: "store_A_0001", userId: "user_1", now: 1_000 });
    const r = verifyState(KEY, state, { cookieNonce: nonce, userId: "user_1", now: 2_000 });
    expect(r).toMatchObject({ ok: true, state: { storeId: "store_A_0001", userId: "user_1" } });
  });
  it("refuse : autre utilisateur, nonce absent/différent, expiré, falsifié", () => {
    const { state, nonce } = createState(KEY, { storeId: "store_A_0001", userId: "user_1", now: 1_000 });
    expect(verifyState(KEY, state, { cookieNonce: nonce, userId: "user_2", now: 2_000 })).toEqual({ ok: false, reason: "user" });
    expect(verifyState(KEY, state, { cookieNonce: null, userId: "user_1", now: 2_000 })).toEqual({ ok: false, reason: "nonce" });
    expect(verifyState(KEY, state, { cookieNonce: "x".repeat(nonce.length), userId: "user_1", now: 2_000 })).toEqual({ ok: false, reason: "nonce" });
    expect(verifyState(KEY, state, { cookieNonce: nonce, userId: "user_1", now: 1_000 + STATE_TTL_MS + 1 })).toEqual({ ok: false, reason: "expired" });
    // Charge utile modifiée (autre boutique) avec l'ancienne signature.
    const [payload, sig] = state.split(".");
    const forged = Buffer.from(Buffer.from(payload, "base64url").toString().replace("store_A_0001", "store_B_0001")).toString("base64url");
    expect(verifyState(KEY, `${forged}.${sig}`, { cookieNonce: nonce, userId: "user_1", now: 2_000 })).toEqual({ ok: false, reason: "signature" });
    expect(verifyState("autre-cle".repeat(5), state, { cookieNonce: nonce, userId: "user_1", now: 2_000 })).toEqual({ ok: false, reason: "signature" });
    expect(verifyState(KEY, "n'importe quoi", { cookieNonce: nonce, userId: "user_1" })).toMatchObject({ ok: false });
  });
});

describe("marchés", () => {
  it("Bénin non couvert ; France, Royaume-Uni (UK/GB), États-Unis couverts avec leur devise", () => {
    expect(isCountryCovered("BJ")).toBe(false);
    expect(marketFor("FR")?.currency).toBe("EUR");
    expect(marketFor("uk")?.region).toBe("GB");
    expect(marketFor("US")?.authHost).toBe("us");
    expect(marketFor("ID")?.priceDecimals).toBe(0);
  });
});

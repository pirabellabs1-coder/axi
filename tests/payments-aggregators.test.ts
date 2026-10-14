import { describe, it, expect } from "vitest";
import { paystackSignatureValid, paystackToMinor, paystackFromMinor, mapPaystackStatus, paystackMode } from "@/lib/payments/adapters/paystack";
import { pawapayContentDigestValid, mapPawapayDeposit } from "@/lib/payments/adapters/pawapay";
import { mapCinetpayStatus, cinetpayNotifyTokenValid, parseCinetpayNotification, cinetpayMode } from "@/lib/payments/adapters/cinetpay";
import { fitUrl, toMajorString, fromMajor, splitName, payerEmail, alnumText, isAbandoned } from "@/lib/payments/adapters/util";
import { suggestedMethodLabel, sanitizeChannels, pawapayProvider, cinetpayPaymentMethod, paystackChannelParam } from "@/lib/payments/channels";
import { mergeCredentials, checkGatewayForStore } from "@/lib/payment-methods/gateway-config";
import { GATEWAYS } from "@/lib/payments/gateways";

/** Vecteurs figés (calculés une fois avec node:crypto) : toute régression de format est détectée. */
const PS_SECRET = "sk_test_vector_secret";
const PS_BODY = '{"event":"charge.success","data":{"id":4099260516,"status":"success","reference":"att_vector.a1b2c3","amount":500000,"currency":"XOF"}}';
const PS_SIG = "66cd08e3d7646f316a24b6ad88ea456517c809b952b65d73501b5b24a0e4c57c2911fad8fb836a707ff7fda287c3fb81a5844549a526db1b5e782c8e4d107871";
const PP_BODY = '{"depositId":"8917c345-4791-4285-a416-62f24b6982db","status":"COMPLETED"}';
const PP_D512 = "5XvQ77Ue3i9z+d43e5VYdqY9fKG3nj5pzlJTjoFj5Yxph/17bn1xTeg/nOASeKzfm6dJSbAlUH44t6pRe76BYA==";
const PP_D256 = "8sFrvpawxdZrfNEcUn54LOFzu2O0nRBO0DxZ8JTUl68=";

describe("Paystack : signature x-paystack-signature (HMAC-SHA512)", () => {
  it("accepte le vecteur de référence, y compris en majuscules", () => {
    expect(paystackSignatureValid(PS_SECRET, PS_BODY, PS_SIG)).toBe(true);
    expect(paystackSignatureValid(PS_SECRET, PS_BODY, PS_SIG.toUpperCase())).toBe(true);
  });
  it("refuse corps modifié, autre clé, en-tête absent ou tronqué", () => {
    expect(paystackSignatureValid(PS_SECRET, PS_BODY.replace("500000", "500"), PS_SIG)).toBe(false);
    expect(paystackSignatureValid("sk_test_autre", PS_BODY, PS_SIG)).toBe(false);
    expect(paystackSignatureValid(PS_SECRET, PS_BODY, null)).toBe(false);
    expect(paystackSignatureValid(PS_SECRET, PS_BODY, PS_SIG.slice(0, 64))).toBe(false);
    expect(paystackSignatureValid("", PS_BODY, PS_SIG)).toBe(false);
  });
});

describe("Paystack : montants et statuts", () => {
  it("XOF multiplié par 100 (règle officielle), retour exact sinon null", () => {
    expect(paystackToMinor(5000, "XOF")).toBe(500000);
    expect(paystackFromMinor(500000, "XOF")).toBe(5000);
    expect(paystackFromMinor(500050, "XOF")).toBeNull();
    expect(paystackFromMinor("500000", "XOF")).toBe(5000);
    expect(paystackFromMinor(1.5, "XOF")).toBeNull();
    expect(paystackToMinor(1250, "USD")).toBe(1250);
  });
  it("mappe les statuts ; abandoned n'expire qu'après le délai", () => {
    const now = Date.now();
    expect(mapPaystackStatus("success")).toBe("CONFIRMED");
    expect(mapPaystackStatus("failed")).toBe("FAILED");
    expect(mapPaystackStatus("reversed")).toBe("FAILED");
    expect(mapPaystackStatus("ongoing")).toBe("PENDING");
    expect(mapPaystackStatus("abandoned", { initiatedAt: new Date(now - 5 * 60_000) }, now)).toBe("PENDING");
    expect(mapPaystackStatus("abandoned", { initiatedAt: new Date(now - 2 * 3600_000) }, now)).toBe("EXPIRED");
    expect(mapPaystackStatus("abandoned")).toBe("PENDING");
  });
  it("mode déduit du préfixe de clé", () => {
    expect(paystackMode({ secretKey: "sk_test_x" })).toBe("test");
    expect(paystackMode({ secretKey: "sk_live_x" })).toBe("live");
    expect(paystackMode({ secretKey: "pk_test_x" })).toBeNull();
  });
});

describe("pawaPay : Content-Digest et statuts de dépôt", () => {
  it("valide sha-512 et sha-256, refuse un corps altéré", () => {
    expect(pawapayContentDigestValid(PP_BODY, `sha-512=:${PP_D512}:`)).toBe(true);
    expect(pawapayContentDigestValid(PP_BODY, `sha-256=:${PP_D256}:`)).toBe(true);
    expect(pawapayContentDigestValid(PP_BODY, `sha-256=:AAAA:, sha-512=:${PP_D512}:`)).toBe(true);
    expect(pawapayContentDigestValid(PP_BODY.replace("COMPLETED", "FAILED"), `sha-512=:${PP_D512}:`)).toBe(false);
    expect(pawapayContentDigestValid(PP_BODY, "md5=:abc:")).toBe(false);
    expect(pawapayContentDigestValid(PP_BODY, null)).toBe(false);
  });
  it("COMPLETED confirme ; NOT_FOUND (page abandonnée) n'expire qu'après 20 min", () => {
    const now = Date.now();
    expect(mapPawapayDeposit("FOUND", "COMPLETED")).toBe("CONFIRMED");
    expect(mapPawapayDeposit("FOUND", "FAILED")).toBe("FAILED");
    expect(mapPawapayDeposit("FOUND", "PROCESSING")).toBe("PENDING");
    expect(mapPawapayDeposit("FOUND", "IN_RECONCILIATION")).toBe("PENDING");
    expect(mapPawapayDeposit("NOT_FOUND", undefined, { initiatedAt: new Date(now - 60_000) }, now)).toBe("PENDING");
    expect(mapPawapayDeposit("NOT_FOUND", undefined, { initiatedAt: new Date(now - 25 * 60_000) }, now)).toBe("EXPIRED");
  });
});

describe("CinetPay : jeton de notification et statuts", () => {
  const token = "382a2329ae0647f896fa70283fa087cc";
  const hash = "c55e1b09d61862f91d09a7ddd1d4707c8c783e335840c6459813a5f178c46547";
  it("compare l'empreinte SHA-256 du notify_token", () => {
    expect(cinetpayNotifyTokenValid(token, hash)).toBe(true);
    expect(cinetpayNotifyTokenValid(token.replace("3", "4"), hash)).toBe(false);
    expect(cinetpayNotifyTokenValid("", hash)).toBe(false);
    expect(cinetpayNotifyTokenValid(token, undefined)).toBe(false);
  });
  it("mappe les statuts", () => {
    expect(mapCinetpayStatus("SUCCESS")).toBe("CONFIRMED");
    expect(mapCinetpayStatus("FAILED")).toBe("FAILED");
    expect(mapCinetpayStatus("EXPIRED")).toBe("EXPIRED");
    expect(mapCinetpayStatus("PENDING")).toBe("PENDING");
    expect(mapCinetpayStatus("INITIATED", { initiatedAt: new Date(Date.now() - 3600_000) })).toBe("EXPIRED");
    expect(mapCinetpayStatus("NOT_FOUND")).toBe("UNKNOWN");
    expect(mapCinetpayStatus("WHATEVER")).toBe("UNKNOWN");
  });
  it("lit une notification JSON ou formulaire, refuse le reste", () => {
    expect(parseCinetpayNotification('{"notify_token":"a","transaction_id":"b"}')).toEqual({ notify_token: "a", transaction_id: "b" });
    expect(parseCinetpayNotification("notify_token=a&transaction_id=b")).toEqual({ notify_token: "a", transaction_id: "b" });
    expect(parseCinetpayNotification("<xml/>")).toBeNull();
  });
  it("mode déduit du préfixe de clé", () => {
    expect(cinetpayMode({ apiKey: "sk_test_1" })).toBe("test");
    expect(cinetpayMode({ apiKey: "sk_live_1" })).toBe("live");
  });
});

describe("Portefeuilles et utilitaires", () => {
  it("libellé client suggéré", () => {
    expect(suggestedMethodLabel(["wave", "orange_money", "mtn_momo"])).toBe("Wave, Orange Money ou MTN MoMo");
    expect(suggestedMethodLabel(["wave"])).toBe("Wave");
    expect(suggestedMethodLabel(["card"])).toBe("Carte bancaire");
    expect(suggestedMethodLabel([])).toBe("Mobile Money ou carte en ligne");
  });
  it("ne garde que des portefeuilles connus ET disponibles, ordre canonique", () => {
    expect(sanitizeChannels(["card", "wave", "inconnu", "wave", 3], ["wave", "orange_money"])).toEqual(["wave"]);
    expect(sanitizeChannels(["orange_money", "wave"], ["wave", "orange_money"])).toEqual(["wave", "orange_money"]);
  });
  it("codes opérateurs pawaPay et CinetPay", () => {
    expect(pawapayProvider("CI", "wave")).toEqual({ code: "WAVE_CIV", auth: "REDIRECT_AUTH" });
    expect(pawapayProvider("SN", "orange_money")?.code).toBe("ORANGE_SEN");
    expect(pawapayProvider("SN", "mtn_momo")).toBeNull();
    expect(cinetpayPaymentMethod("CI", "orange_money")).toBe("OM_CI");
    expect(cinetpayPaymentMethod("SN", "wave")).toBe("WAVE_SN");
    expect(cinetpayPaymentMethod("SN", "mtn_momo")).toBeNull();
    expect(paystackChannelParam(["wave", "card"])).toEqual(["mobile_money", "card"]);
    expect(paystackChannelParam(["card"])).toEqual(["card"]);
    expect(paystackChannelParam([])).toBeUndefined();
  });
  it("montants en unités majeures", () => {
    expect(toMajorString(5000, "XOF")).toBe("5000");
    expect(toMajorString(1250, "EUR")).toBe("12.50");
    expect(fromMajor("5000.00", "XOF")).toBe(5000);
    expect(fromMajor("12.5", "EUR")).toBe(1250);
    expect(fromMajor("abc", "XOF")).toBeNull();
  });
  it("URL ≤ 120, noms, e-mail technique, texte relevé", () => {
    const long = `https://axi.africa/s/${"a".repeat(60)}/merci/${"f".repeat(48)}?paiement=annule`;
    expect(fitUrl("https://axi.africa/x?y=1", 120)).toBe("https://axi.africa/x?y=1");
    expect(fitUrl(long, 120).length).toBeLessThanOrEqual(120);
    expect(fitUrl(long, 120)).not.toContain("?");
    expect(splitName("Aïcha Koné Traoré")).toEqual({ first: "Aïcha", last: "Koné Traoré" });
    expect(splitName("A")).toEqual({ first: "Client", last: "Client" });
    expect(payerEmail("awa@exemple.ci", "2250700")).toBe("awa@exemple.ci");
    expect(payerEmail(null, "+225 07 00 00 00 01")).toMatch(/^client-2250700000001@[a-z0-9.-]+\.[a-z]+$/);
    expect(alnumText("Commande AX-7K2Q9 é", 22)).toBe("Commande AX 7K2Q9 e");
    expect(isAbandoned(undefined)).toBe(false);
  });
});

describe("Configuration d'un moyen « agrégateur » (règles pures)", () => {
  it("fusion des identifiants : vide = conservé, option hors liste refusée, clés étrangères écartées", () => {
    const read = (vals: Record<string, string>) => (k: string) => vals[k] ?? "";
    const r1 = mergeCredentials(GATEWAYS.pawapay, read({ mode: "live" }), { apiToken: "tok_saved", stray: "x" });
    expect(r1.creds).toEqual({ apiToken: "tok_saved", mode: "live" });
    expect(r1.missing).toEqual([]);
    const r2 = mergeCredentials(GATEWAYS.pawapay, read({ apiToken: "t", mode: "prod" }), {});
    expect(r2.invalid.map((f) => f.key)).toEqual(["mode"]);
    expect(mergeCredentials(GATEWAYS.paystack, read({}), {}).missing.map((f) => f.key)).toEqual(["secretKey"]);
  });
  it("Paystack : Côte d'Ivoire seulement, au moins un portefeuille", () => {
    const ci = { country: "CI", currency: "XOF" };
    expect(checkGatewayForStore(GATEWAYS.paystack, ci, { secretKey: "sk_test_x" }, ["wave", "card"])).toEqual({ ok: true, channels: ["wave", "card"] });
    const none = checkGatewayForStore(GATEWAYS.paystack, ci, { secretKey: "sk_test_x" }, []);
    expect(none.ok).toBe(false);
    const bj = checkGatewayForStore(GATEWAYS.paystack, { country: "BJ", currency: "XOF" }, { secretKey: "sk_test_x" }, ["wave"]);
    expect(bj).toMatchObject({ ok: false, field: "provider" });
  });
  it("CinetPay : identifiants du pays de la boutique ; passerelles historiques inchangées", () => {
    const sn = { country: "SN", currency: "XOF" };
    expect(checkGatewayForStore(GATEWAYS.cinetpay, sn, { apiKey: "k", apiPassword: "p", country: "CI" }, ["wave"])).toMatchObject({ ok: false, field: "cred_country" });
    expect(checkGatewayForStore(GATEWAYS.cinetpay, sn, { apiKey: "k", apiPassword: "p", country: "SN" }, ["wave", "mtn_momo"])).toEqual({ ok: true, channels: ["wave"] });
    expect(checkGatewayForStore(GATEWAYS.fedapay, { country: "BJ", currency: "XOF" }, {}, ["wave"])).toEqual({ ok: true, channels: [] });
  });
});

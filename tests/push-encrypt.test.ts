import { describe, expect, it } from "vitest";
import { createECDH, createDecipheriv } from "node:crypto";
import { b64urlDecode, b64urlEncode, encryptPush, hkdfExpand, hkdfExtract, MAX_PAYLOAD_BYTES, RECORD_SIZE } from "@/lib/push/encrypt";

/**
 * Vecteurs de la RFC 8291 §5 et annexe A (« Push Message Encryption Example »).
 * Le sel et la paire éphémère du serveur sont imposés : la sortie doit être identique octet pour octet.
 */
const RFC8291 = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  // Corps complet de la requête (en-tête aes128gcm + enregistrement chiffré), RFC 8291 §5.
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  // Valeurs intermédiaires de l'annexe A.
  ecdhSecret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  prkKey: "Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  prk: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
};

function run() {
  return encryptPush(RFC8291.plaintext, { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret }, { salt: b64urlDecode(RFC8291.salt), serverPrivateKey: b64urlDecode(RFC8291.asPrivate) });
}

describe("RFC 8291 — chiffrement Web Push (aes128gcm)", () => {
  it("reproduit le corps complet du vecteur de la RFC", () => {
    expect(b64urlEncode(run().body)).toBe(RFC8291.body);
  });

  it("reproduit les valeurs intermédiaires de l'annexe A", () => {
    const { intermediates: i } = run();
    expect(b64urlEncode(i.serverPublicKey)).toBe(RFC8291.asPublic);
    expect(b64urlEncode(i.ecdhSecret)).toBe(RFC8291.ecdhSecret);
    expect(b64urlEncode(i.prkKey)).toBe(RFC8291.prkKey);
    expect(b64urlEncode(i.ikm)).toBe(RFC8291.ikm);
    expect(b64urlEncode(i.prk)).toBe(RFC8291.prk);
    expect(b64urlEncode(i.cek)).toBe(RFC8291.cek);
    expect(b64urlEncode(i.nonce)).toBe(RFC8291.nonce);
  });

  it("produit l'en-tête aes128gcm attendu (sel, rs = 4096, keyid = clé publique du serveur)", () => {
    const body = run().body;
    const header = body.subarray(0, 86);
    expect(b64urlEncode(header)).toBe(RFC8291.header);
    expect(header.readUInt32BE(16)).toBe(RECORD_SIZE);
    expect(header.readUInt8(20)).toBe(65);
  });
});

describe("HKDF (RFC 5869)", () => {
  it("extract puis expand correspondent aux valeurs de la RFC 8291", () => {
    const prkKey = hkdfExtract(b64urlDecode(RFC8291.authSecret), b64urlDecode(RFC8291.ecdhSecret));
    expect(b64urlEncode(prkKey)).toBe(RFC8291.prkKey);
    const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), b64urlDecode(RFC8291.uaPublic), b64urlDecode(RFC8291.asPublic)]);
    expect(b64urlEncode(hkdfExpand(prkKey, keyInfo, 32))).toBe(RFC8291.ikm);
  });
});

describe("Déchiffrement par le destinataire", () => {
  /** Déchiffre comme le ferait le navigateur, avec la clé privée de l'abonnement. */
  function decrypt(body: Buffer, uaPrivate: string, uaPublic: string, authSecret: string): string {
    const salt = body.subarray(0, 16);
    const idlen = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idlen);
    const sealed = body.subarray(21 + idlen);
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(b64urlDecode(uaPrivate));
    const prkKey = hkdfExtract(b64urlDecode(authSecret), ecdh.computeSecret(asPublic));
    const ikm = hkdfExpand(prkKey, Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), b64urlDecode(uaPublic), asPublic]), 32);
    const prk = hkdfExtract(salt, ikm);
    const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
    const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
    expect(plain[plain.length - 1]).toBe(2); // délimiteur de remplissage
    return plain.subarray(0, plain.length - 1).toString("utf8");
  }

  it("le vecteur de la RFC se déchiffre avec la clé privée du destinataire", () => {
    expect(decrypt(b64urlDecode(RFC8291.body), RFC8291.uaPrivate, RFC8291.uaPublic, RFC8291.authSecret)).toBe(RFC8291.plaintext);
  });

  it("aller-retour avec sel et clé éphémère aléatoires (cas de production)", () => {
    const payload = JSON.stringify({ title: "Commande n° 1042", body: "Votre colis est prêt 🎉", url: "/s/demo/compte" });
    const { body } = encryptPush(payload, { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret });
    expect(decrypt(body, RFC8291.uaPrivate, RFC8291.uaPublic, RFC8291.authSecret)).toBe(payload);
  });

  it("deux chiffrements du même message diffèrent (sel et clé éphémère aléatoires)", () => {
    const a = encryptPush("bonjour", { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret }).body;
    const b = encryptPush("bonjour", { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret }).body;
    expect(a.equals(b)).toBe(false);
  });
});

describe("Garde-fous", () => {
  const keys = { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret };

  it("refuse une clé p256dh invalide", () => {
    expect(() => encryptPush("x", { ...keys, p256dh: b64urlEncode(Buffer.alloc(16)) })).toThrow(/p256dh/);
  });

  it("refuse un secret d'authentification de mauvaise taille", () => {
    expect(() => encryptPush("x", { ...keys, auth: b64urlEncode(Buffer.alloc(8)) })).toThrow(/auth/);
  });

  it("refuse une charge utile au-delà de la limite RFC 8030", () => {
    expect(() => encryptPush("a".repeat(MAX_PAYLOAD_BYTES + 1), keys)).toThrow(/trop grande/);
    expect(() => encryptPush("a".repeat(MAX_PAYLOAD_BYTES), keys)).not.toThrow();
  });

  it("une charge à la limite tient dans un enregistrement de 4096 octets", () => {
    const { body } = encryptPush("a".repeat(MAX_PAYLOAD_BYTES), keys);
    expect(body.length - 86).toBeLessThanOrEqual(RECORD_SIZE);
  });
});

/**
 * Chiffrement des messages Web Push (RFC 8291) dans le codage de contenu `aes128gcm` (RFC 8188),
 * écrit avec `node:crypto` uniquement (aucune dépendance).
 *
 * Suite d'opérations, pour un abonnement `{ endpoint, p256dh, auth }` :
 *  1. paire ECDH P-256 éphémère côté serveur (`as_private` / `as_public`) ;
 *  2. `ecdh_secret = ECDH(as_private, ua_public)` ;
 *  3. `PRK_key     = HMAC-SHA256(auth_secret, ecdh_secret)`            (HKDF-Extract, sel = secret d'authentification)
 *  4. `IKM         = HKDF-Expand(PRK_key, "WebPush: info" ‖ 0x00 ‖ ua_public ‖ as_public, 32)`
 *  5. `PRK         = HMAC-SHA256(salt, IKM)`                            (sel aléatoire de 16 octets)
 *  6. `CEK         = HKDF-Expand(PRK, "Content-Encoding: aes128gcm" ‖ 0x00, 16)`
 *     `NONCE       = HKDF-Expand(PRK, "Content-Encoding: nonce" ‖ 0x00, 12)`
 *  7. corps = en-tête (`salt ‖ rs ‖ idlen ‖ as_public`) ‖ AES-128-GCM(texte ‖ 0x02).
 *
 * Un seul enregistrement est produit : les messages push utiles tiennent largement dans les 4096 octets
 * garantis par la RFC 8030 (`MAX_PAYLOAD_BYTES` ci-dessous). Fonctions pures et déterministes dès que le sel
 * et la paire éphémère sont fournis : c'est ce qui permet de rejouer les vecteurs de la RFC dans les tests.
 */
import { createECDH, createCipheriv, createHmac, randomBytes } from "node:crypto";

/** Taille d'enregistrement annoncée dans l'en-tête (RFC 8188 §2.1). */
export const RECORD_SIZE = 4096;
/** Charge utile maximale acceptée par un service de push (RFC 8030 §5.2) : 4096 octets de texte chiffré. */
export const MAX_PAYLOAD_BYTES = 3993; // 4096 − 86 (en-tête) − 16 (étiquette GCM) − 1 (délimiteur de remplissage)

export function b64urlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function b64urlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HKDF (RFC 5869) limité à une seule itération d'expansion : toutes les sorties utiles font ≤ 32 octets. */
export function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  if (length > 32) throw new Error("hkdf: longueur > 32 non prise en charge");
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return hkdfExpand(prk, info, length);
}

export function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac("sha256", salt).update(ikm).digest();
}

export function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  if (length > 32) throw new Error("hkdfExpand: longueur > 32 non prise en charge");
  return createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

/** Clé publique P-256 non compressée (RFC 8291 : 65 octets, premier octet 0x04). */
export function isValidPublicKey(raw: Buffer): boolean {
  return raw.length === 65 && raw[0] === 0x04;
}

export type PushKeys = {
  /** Clé publique de l'abonnement (`p256dh`), base64url. */
  p256dh: string;
  /** Secret d'authentification de l'abonnement (`auth`), base64url, 16 octets. */
  auth: string;
};

export type EncryptOptions = {
  /** Sel de 16 octets. Aléatoire en production ; fixé par les tests (vecteurs de la RFC). */
  salt?: Buffer;
  /** Clé privée éphémère du serveur (32 octets). Aléatoire en production ; fixée par les tests. */
  serverPrivateKey?: Buffer;
};

export type EncryptResult = {
  /** Corps de la requête `POST` (en-tête aes128gcm + enregistrement chiffré). */
  body: Buffer;
  /** Valeurs intermédiaires, utiles aux tests et au diagnostic (jamais journalisées). */
  intermediates: { ecdhSecret: Buffer; prkKey: Buffer; ikm: Buffer; prk: Buffer; cek: Buffer; nonce: Buffer; serverPublicKey: Buffer; salt: Buffer };
};

const KEY_INFO_PREFIX = Buffer.from("WebPush: info\0", "utf8");
const CEK_INFO = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
const NONCE_INFO = Buffer.from("Content-Encoding: nonce\0", "utf8");

/**
 * Chiffre une charge utile pour un abonnement Web Push.
 * Lève si les clés de l'abonnement sont invalides ou si la charge dépasse `MAX_PAYLOAD_BYTES`.
 */
export function encryptPush(payload: string | Buffer, keys: PushKeys, opts: EncryptOptions = {}): EncryptResult {
  const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error(`Charge utile trop grande (${plaintext.length} > ${MAX_PAYLOAD_BYTES} octets)`);

  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  if (!isValidPublicKey(uaPublic)) throw new Error("Clé p256dh invalide (65 octets non compressés attendus)");
  if (authSecret.length !== 16) throw new Error("Secret auth invalide (16 octets attendus)");

  const salt = opts.salt ?? randomBytes(16);
  if (salt.length !== 16) throw new Error("Sel invalide (16 octets attendus)");

  const ecdh = createECDH("prime256v1");
  if (opts.serverPrivateKey) {
    if (opts.serverPrivateKey.length !== 32) throw new Error("Clé privée serveur invalide (32 octets attendus)");
    ecdh.setPrivateKey(opts.serverPrivateKey);
  } else {
    ecdh.generateKeys();
  }
  const serverPublicKey = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  const prkKey = hkdfExtract(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([KEY_INFO_PREFIX, uaPublic, serverPublicKey]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, CEK_INFO, 16);
  const nonce = hkdfExpand(prk, NONCE_INFO, 12);

  // En-tête aes128gcm : sel (16) ‖ taille d'enregistrement (4, gros-boutiste) ‖ longueur de keyid (1) ‖ keyid.
  const header = Buffer.alloc(16 + 4 + 1 + serverPublicKey.length);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(serverPublicKey.length, 20);
  serverPublicKey.copy(header, 21);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // Délimiteur de remplissage du dernier enregistrement (RFC 8188 §2) : 0x02.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  return { body: Buffer.concat([header, sealed]), intermediates: { ecdhSecret, prkKey, ikm, prk, cek, nonce, serverPublicKey, salt } };
}

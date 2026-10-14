import { describe, it, expect } from "vitest";
import {
  base32Decode,
  base32Encode,
  consumeBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  hotp,
  otpauthUri,
  signMfaPending,
  totp,
  verifyMfaPending,
  verifyTotp,
} from "@/lib/auth/mfa";

// Clés de référence de la RFC 6238, annexe B (ASCII « 1234567890 » répété).
const SHA1 = Buffer.from("12345678901234567890");
const SHA256 = Buffer.from("12345678901234567890123456789012");
const SHA512 = Buffer.from("1234567890123456789012345678901234567890123456789012345678901234");

const VECTORS: [number, string, string, string][] = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

describe("TOTP RFC 6238 (vecteurs officiels, 8 chiffres)", () => {
  for (const [t, sha1, sha256, sha512] of VECTORS) {
    it(`T = ${t}`, () => {
      expect(totp(SHA1, t * 1000, { digits: 8, algorithm: "sha1" })).toBe(sha1);
      expect(totp(SHA256, t * 1000, { digits: 8, algorithm: "sha256" })).toBe(sha256);
      expect(totp(SHA512, t * 1000, { digits: 8, algorithm: "sha512" })).toBe(sha512);
    });
  }
});

describe("HOTP RFC 4226 (annexe D)", () => {
  it("donne les valeurs de référence des compteurs 0 à 9", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, c) => expect(hotp(SHA1, c)).toBe(code));
  });
});

describe("base32", () => {
  it("encode et décode (RFC 4648)", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode("mzxw 6ytb-oi").toString()).toBe("foobar");
  });
  it("refuse un caractère hors alphabet", () => {
    expect(() => base32Decode("MZXW1")).toThrow();
  });
  it("génère un secret de 160 bits", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
  });
});

describe("verifyTotp", () => {
  const key = SHA1;
  const now = 1_700_000_000_000;
  const code = totp(key, now);

  it("accepte le code courant et le pas voisin (dérive d'horloge)", () => {
    expect(verifyTotp(key, code, now)).toBe(Math.floor(now / 30000));
    expect(verifyTotp(key, totp(key, now - 30_000), now)).toBe(Math.floor(now / 30000) - 1);
    expect(verifyTotp(key, `${code.slice(0, 3)} ${code.slice(3)}`, now)).not.toBeNull();
  });
  it("refuse un code trop ancien, mal formé ou déjà utilisé (anti-rejeu)", () => {
    expect(verifyTotp(key, totp(key, now - 120_000), now)).toBeNull();
    expect(verifyTotp(key, "12345", now)).toBeNull();
    const counter = verifyTotp(key, code, now)!;
    expect(verifyTotp(key, code, now, { afterCounter: counter })).toBeNull();
  });
});

describe("codes de secours", () => {
  it("sont uniques, au format xxxx-xxxx, et consommés une seule fois", () => {
    const codes = generateBackupCodes(8);
    expect(new Set(codes).size).toBe(8);
    codes.forEach((c) => expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/));
    const hashes = codes.map(hashBackupCode);
    const rest = consumeBackupCode(hashes, codes[2].toUpperCase().replace("-", " "));
    expect(rest).toHaveLength(7);
    expect(consumeBackupCode(rest!, codes[2])).toBeNull();
    expect(consumeBackupCode(hashes, "zzzz-zzzz")).toBeNull();
  });
});

describe("jeton de connexion en attente", () => {
  const secret = "s".repeat(40);
  it("est vérifié, puis refusé une fois expiré ou falsifié", () => {
    const t = signMfaPending({ uid: "u1", exp: 2_000, next: "/admin" }, secret);
    expect(verifyMfaPending(t, secret, 1_000)).toEqual({ uid: "u1", exp: 2_000, next: "/admin" });
    expect(verifyMfaPending(t, secret, 3_000)).toBeNull();
    expect(verifyMfaPending(t, "autre".repeat(10), 1_000)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: 9e15 })).toString("base64url");
    expect(verifyMfaPending(`${forged}.${sig}`, secret, 1_000)).toBeNull();
    expect(verifyMfaPending(`${body}.`, secret, 1_000)).toBeNull();
    expect(verifyMfaPending(undefined, secret)).toBeNull();
  });
});

describe("otpauthUri", () => {
  it("produit une URI Key Uri Format", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "admin@axi.africa", issuer: "Axi" });
    expect(uri.startsWith("otpauth://totp/Axi%3Aadmin%40axi.africa?")).toBe(true);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Axi");
    expect(uri).toContain("period=30");
  });
});

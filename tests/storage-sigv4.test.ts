import { describe, expect, it, vi } from "vitest";
import { EMPTY_SHA256, awsUriEncode, sha256Hex, signV4 } from "@/lib/storage/sigv4";
import { S3Driver } from "@/lib/storage/drivers";
import { readStorageConfig, StorageConfigError, type S3Config } from "@/lib/storage/config";

/**
 * Vecteurs officiels AWS :
 *  - suite « aws-sig-v4-test-suite » : get-vanilla ;
 *  - documentation S3 « Signature Calculations for the Authorization Header » : GET Object, PUT Object, GET Bucket (List).
 */
const S3_DOC = { region: "us-east-1", service: "s3", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", date: new Date("2013-05-24T00:00:00Z") };

describe("SigV4 — vecteurs officiels AWS", () => {
  it("get-vanilla (suite de tests SigV4)", () => {
    const r = signV4({
      method: "GET",
      host: "example.amazonaws.com",
      path: "/",
      payloadHash: EMPTY_SHA256,
      region: "us-east-1",
      service: "service",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      date: new Date("2015-08-30T12:36:00Z"),
    });
    expect(r.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  it("S3 GET Object (en-tête Range)", () => {
    const r = signV4({ ...S3_DOC, method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", headers: { Range: "bytes=0-9", "x-amz-content-sha256": EMPTY_SHA256 }, payloadHash: EMPTY_SHA256 });
    expect(r.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(r.authorization).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
  });

  it("S3 PUT Object (clé avec « $ », corps signé)", () => {
    const body = "Welcome to Amazon S3.";
    expect(sha256Hex(body)).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    const r = signV4({
      ...S3_DOC,
      method: "PUT",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test$file.text",
      headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY", "x-amz-content-sha256": sha256Hex(body) },
      payloadHash: sha256Hex(body),
    });
    expect(r.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
    expect(r.canonicalRequest.split("\n")[1]).toBe("/test%24file.text");
  });

  it("S3 GET Bucket (paramètres de requête triés et encodés)", () => {
    const r = signV4({ ...S3_DOC, method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/", query: { prefix: "J", "max-keys": "2" }, headers: { "x-amz-content-sha256": EMPTY_SHA256 }, payloadHash: EMPTY_SHA256 });
    expect(r.signature).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
    expect(r.canonicalRequest.split("\n")[2]).toBe("max-keys=2&prefix=J");
  });

  it("encodage URI AWS", () => {
    expect(awsUriEncode("a b/c~d", false)).toBe("a%20b/c~d");
    expect(awsUriEncode("a/b")).toBe("a%2Fb");
    expect(awsUriEncode("é")).toBe("%C3%A9");
  });
});

const KEY = `stores/cmv2hxxra0002ibks5nrleed0/2026/10/${"a".repeat(64)}.webp`;
const baseCfg = (over: Partial<S3Config> = {}): S3Config => ({
  driver: "s3",
  endpoint: new URL("https://acc.r2.cloudflarestorage.com"),
  region: "auto",
  bucket: "axi-media",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  publicUrl: "https://media.axi.africa",
  forcePathStyle: true,
  ...over,
});

describe("pilote S3", () => {
  it("adresse en style chemin (R2), hôte virtuel (AWS) et conserve le chemin de l'endpoint (Supabase)", () => {
    expect(new S3Driver(baseCfg()).target(KEY).url).toBe(`https://acc.r2.cloudflarestorage.com/axi-media/${KEY}`);
    expect(new S3Driver(baseCfg({ endpoint: new URL("https://s3.eu-west-3.amazonaws.com"), forcePathStyle: false })).target(KEY).url).toBe(`https://axi-media.s3.eu-west-3.amazonaws.com/${KEY}`);
    expect(new S3Driver(baseCfg({ endpoint: new URL("https://proj.supabase.co/storage/v1/s3") })).target(KEY).url).toBe(`https://proj.supabase.co/storage/v1/s3/axi-media/${KEY}`);
    expect(new S3Driver(baseCfg()).publicUrl(KEY)).toBe(`https://media.axi.africa/${KEY}`);
  });

  it("PUT signé avec le hash du contenu, type et cache immuable ; réessaie sur 5xx", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(null, { status: calls.length === 1 ? 503 : 200 });
    }) as unknown as typeof fetch;
    const body = new Uint8Array([1, 2, 3]);
    await new S3Driver(baseCfg(), fetchImpl).put(KEY, body, "image/webp", sha256Hex(body));
    expect(calls).toHaveLength(2);
    const h = calls[1].init.headers as Record<string, string>;
    expect(calls[1].init.method).toBe("PUT");
    expect(h["x-amz-content-sha256"]).toBe(sha256Hex(body));
    expect(h["content-type"]).toBe("image/webp");
    expect(h["cache-control"]).toContain("immutable");
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
    expect(JSON.stringify(calls)).not.toContain("SK"); // le secret ne circule jamais
  });

  it("n'insiste pas sur une erreur de configuration (403) et ne divulgue pas le secret", async () => {
    const fetchImpl = vi.fn(async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 })) as unknown as typeof fetch;
    await expect(new S3Driver(baseCfg(), fetchImpl).put(KEY, new Uint8Array([1]), "image/png", "x")).rejects.toThrow("PUT 403 (AccessDenied)");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuse une clé hors format", async () => {
    await expect(new S3Driver(baseCfg()).put("../etc/passwd", new Uint8Array([1]), "image/png", "x")).rejects.toThrow("Clé de média invalide");
  });

  it("HEAD : 200 → existe, 404 → absent", async () => {
    const ok = new S3Driver(baseCfg(), (async () => new Response(null, { status: 200 })) as unknown as typeof fetch);
    const missing = new S3Driver(baseCfg(), (async () => new Response(null, { status: 404 })) as unknown as typeof fetch);
    expect(await ok.exists(KEY)).toBe(true);
    expect(await missing.exists(KEY)).toBe(false);
  });
});

describe("configuration du stockage", () => {
  const s3Env = { STORAGE_DRIVER: "s3", STORAGE_ENDPOINT: "https://acc.r2.cloudflarestorage.com", STORAGE_BUCKET: "axi-media", STORAGE_ACCESS_KEY_ID: "a", STORAGE_SECRET_ACCESS_KEY: "b", STORAGE_PUBLIC_URL: "https://media.axi.africa/" };

  it("local par défaut en développement", () => {
    expect(readStorageConfig({ NODE_ENV: "development" }, "/app").driver).toBe("local");
  });

  it("production sans pilote : refusé, sauf recette sur localhost", () => {
    expect(() => readStorageConfig({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://axi.africa" })).toThrow(StorageConfigError);
    expect(readStorageConfig({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost:3100" }).driver).toBe("local");
  });

  it("production avec STORAGE_DRIVER=local explicite : accepté avec avertissement", () => {
    const c = readStorageConfig({ NODE_ENV: "production", STORAGE_DRIVER: "local", NEXT_PUBLIC_APP_URL: "https://axi.africa" });
    expect(c.driver).toBe("local");
    expect("warning" in c && c.warning).toMatch(/disque persistant/);
  });

  it("s3 : variables complètes, URL publique normalisée, style chemin par défaut", () => {
    const c = readStorageConfig({ NODE_ENV: "production", ...s3Env });
    expect(c).toMatchObject({ driver: "s3", region: "auto", bucket: "axi-media", publicUrl: "https://media.axi.africa", forcePathStyle: true });
    expect(readStorageConfig({ ...s3Env, STORAGE_FORCE_PATH_STYLE: "false" })).toMatchObject({ forcePathStyle: false });
  });

  it("s3 : variable manquante ou http en production → erreur explicite", () => {
    expect(() => readStorageConfig({ ...s3Env, STORAGE_BUCKET: "" })).toThrow(/STORAGE_BUCKET/);
    expect(() => readStorageConfig({ NODE_ENV: "production", ...s3Env, STORAGE_PUBLIC_URL: "http://media.axi.africa" })).toThrow(/https/);
    expect(() => readStorageConfig({ STORAGE_DRIVER: "ftp" })).toThrow(/inconnu/);
  });
});

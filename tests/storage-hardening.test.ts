import { describe, expect, it, vi } from "vitest";
import { checkImageWrite, DATA_URL_WRITE_ERROR, FOREIGN_MEDIA_ERROR, isOwnStoredMediaUrl } from "@/lib/storage/write-guard";
import { imageSizeIssue, readImageSize, sniffImageType } from "@/lib/storage/image-type";
import { sameOrigin } from "@/lib/storage/origin";
import { S3Driver } from "@/lib/storage/drivers";
import { safeImageUrl } from "@/lib/storefront/theme-doc";
import { make } from "./helpers/images";

/** Corrections de l'audit sécurité du stockage des médias (M1, m4, n1, n2, n4). */
const STORE = "cmv2hxxra0002ibks5nrleed0";
const OTHER = "cmv2hxyeh0082ibksgrola5ul";
const HASH = "ab".repeat(32);
const own = `/media/stores/${STORE}/2026/10/${HASH}.webp`;
const foreign = `/media/stores/${OTHER}/2026/10/${HASH}.webp`;
const legacy = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const fresh = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("M1 / n1 — règles d'écriture des images", () => {
  const doc = (logo: string, hero: string) => ({ settings: { header: { logo: { url: logo } } }, templates: { home: { sections: [{ settings: { image: { url: hero } } }] } } });

  it("refuse toute nouvelle data-URL, même valide", () => {
    expect(checkImageWrite(fresh, { storeId: STORE, existing: [] })).toBe(DATA_URL_WRITE_ERROR);
    expect(checkImageWrite(doc(own, fresh), { storeId: STORE, existing: [doc(own, legacy)] })).toBe(DATA_URL_WRITE_ERROR);
    expect(checkImageWrite("data:text/html;base64,PHNjcmlwdD4=", { storeId: STORE })).toBe(DATA_URL_WRITE_ERROR);
  });

  it("accepte une data-URL strictement identique à la valeur déjà en base (thème publié, brouillon…)", () => {
    expect(checkImageWrite(doc(legacy, own), { storeId: STORE, existing: [null, doc(legacy, "https://x.example/a.jpg")] })).toBeNull();
    expect(checkImageWrite(legacy, { storeId: STORE, existing: [legacy] })).toBeNull();
    expect(checkImageWrite(legacy + "A", { storeId: STORE, existing: [legacy] })).toBe(DATA_URL_WRITE_ERROR);
  });

  it("un média téléversé doit appartenir à la boutique (local et bucket)", () => {
    expect(checkImageWrite(doc(own, "https://cdn.example/x.jpg"), { storeId: STORE })).toBeNull();
    expect(checkImageWrite(doc(foreign, own), { storeId: STORE })).toBe(FOREIGN_MEDIA_ERROR);
    const base = "https://media.axi.africa";
    expect(checkImageWrite(`${base}/stores/${OTHER}/2026/10/${HASH}.jpg`, { storeId: STORE, publicBase: base })).toBe(FOREIGN_MEDIA_ERROR);
    expect(checkImageWrite(`${base}/stores/${STORE}/2026/10/${HASH}.jpg`, { storeId: STORE, publicBase: base })).toBeNull();
    expect(isOwnStoredMediaUrl(own, STORE, null)).toBe(true);
    expect(isOwnStoredMediaUrl(foreign, STORE, null)).toBe(false);
    // Préfixe trompeur : l'identifiant de boutique doit être un segment complet.
    expect(isOwnStoredMediaUrl(`/media/stores/${STORE}x/2026/10/${HASH}.webp`, STORE, null)).toBe(false);
  });

  it("le rendu reste rétrocompatible (lecture des data-URL héritées)", () => {
    expect(safeImageUrl(legacy)).toBe(legacy);
  });
});

describe("m4 — dimensions lues dans l'en-tête", () => {
  const size = (b: Uint8Array) => readImageSize(b, sniffImageType(b)!);

  it("PNG, GIF, JPEG (baseline et progressif), WebP (VP8X, VP8, VP8L), AVIF", () => {
    expect(size(make.png(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(size(make.gif(320, 240))).toEqual({ width: 320, height: 240 });
    expect(size(make.jpeg(1600, 900))).toEqual({ width: 1600, height: 900 });
    expect(size(make.jpegProgressive(640, 480))).toEqual({ width: 640, height: 480 });
    expect(size(make.webp(5000, 3000))).toEqual({ width: 5000, height: 3000 });
    expect(size(make.webpLossy(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(size(make.webpLossless(1000, 700))).toEqual({ width: 1000, height: 700 });
    expect(size(make.avif(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("refuse > 8000 px de côté, > 40 Mpx, ou dimensions illisibles", () => {
    expect(imageSizeIssue({ width: 8000, height: 5000 })).toBeNull();
    expect(imageSizeIssue({ width: 8001, height: 10 })).toMatch(/8000 px/);
    expect(imageSizeIssue({ width: 7000, height: 6000 })).toMatch(/40 mégapixels/);
    expect(imageSizeIssue(size(make.png(0, 10)))).toMatch(/illisibles/);
    expect(imageSizeIssue(size(make.png(65535, 65535)))).not.toBeNull(); // « bombe » de décompression
  });
});

describe("n4 — même origine comparée à NEXT_PUBLIC_APP_URL", () => {
  const r = (h: Record<string, string>) => new Request("http://x/api/stores/s/media", { method: "POST", headers: h });
  it("accepte l'origine de l'application, refuse les autres et ignore l'en-tête Host", () => {
    expect(sameOrigin(r({ origin: "https://axi.africa", "sec-fetch-site": "same-origin" }), "axi.africa")).toBe(true);
    expect(sameOrigin(r({ origin: "https://evil.example", host: "evil.example" }), "axi.africa")).toBe(false);
    expect(sameOrigin(r({ origin: "https://boutique.axi.africa", "sec-fetch-site": "same-site" }), "axi.africa")).toBe(false);
    expect(sameOrigin(r({ origin: "https://axi.africa" }), null)).toBe(false);
  });
});

describe("n2 — HEAD 403 sur le bucket = erreur de configuration explicite", () => {
  it("ne confond pas « accès refusé » et « objet absent »", async () => {
    const driver = new S3Driver(
      { driver: "s3", endpoint: new URL("https://acc.r2.cloudflarestorage.com"), region: "auto", bucket: "axi-media", accessKeyId: "AK", secretAccessKey: "SK", publicUrl: "https://media.axi.africa", forcePathStyle: true },
      vi.fn(async () => new Response(null, { status: 403 })) as unknown as typeof fetch,
    );
    await expect(driver.exists(`stores/${STORE}/2026/10/${HASH}.jpg`)).rejects.toThrow(/accès refusé.*STORAGE_ACCESS_KEY_ID/);
  });
});

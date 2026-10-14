import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

import { sniffImageType } from "@/lib/storage/image-type";
import { buildMediaKey, isLocalMediaPath, isValidMediaKey, keyFromSegments, mimeForKey } from "@/lib/storage/keys";
import { LocalDriver, localPathFor } from "@/lib/storage/drivers";
import { isStoredMediaUrl, shareableImageUrl } from "@/lib/storage/public-url";
import { storeImage, InvalidImageError } from "@/lib/storage";
import { isSafeImageUrl } from "@/lib/theme-engine/validate";
import { safeImageUrl } from "@/lib/storefront/theme-doc";
import { imageUrlSchema } from "@/lib/products/schemas";
import imageLoader from "@/lib/image-loader";
import { pad, SAMPLES } from "./helpers/images";

const STORE = "cmv2hxxra0002ibks5nrleed0";
const HASH = "0123456789abcdef".repeat(4);

describe("détection du format par octets magiques", () => {
  it("reconnaît JPEG, PNG, GIF, WebP, AVIF (marque majeure ou compatible)", () => {
    expect(sniffImageType(SAMPLES.jpeg)?.ext).toBe("jpg");
    expect(sniffImageType(SAMPLES.png)?.ext).toBe("png");
    expect(sniffImageType(SAMPLES.gif)?.ext).toBe("gif");
    expect(sniffImageType(SAMPLES.webp)?.ext).toBe("webp");
    expect(sniffImageType(SAMPLES.avif)?.mime).toBe("image/avif");
    expect(sniffImageType(SAMPLES.avifCompat)?.mime).toBe("image/avif");
  });

  it("refuse SVG, HTML, PDF, MP4 et fichiers trop courts, quel que soit le type annoncé", () => {
    expect(sniffImageType(pad('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">'))).toBeNull();
    expect(sniffImageType(pad('<?xml version="1.0"?><svg>'))).toBeNull();
    expect(sniffImageType(pad("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(pad("%PDF-1.7\n"))).toBeNull();
    expect(sniffImageType(pad([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 0, 0, ...Buffer.from("isommp41")]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("clés et chemins", () => {
  it("clé stores/{storeId}/{yyyy}/{mm}/{hash}.{ext}", () => {
    const key = buildMediaKey(STORE, HASH, "webp", new Date("2026-03-05T10:00:00Z"));
    expect(key).toBe(`stores/${STORE}/2026/03/${HASH}.webp`);
    expect(mimeForKey(key)).toBe("image/webp");
    expect(() => buildMediaKey("../x", HASH, "png")).toThrow();
    expect(() => buildMediaKey(STORE, "abc", "png")).toThrow();
  });

  it("refuse toute traversée de chemin ou segment libre dans /media/…", () => {
    const ok = ["stores", STORE, "2026", "10", `${HASH}.jpg`];
    expect(keyFromSegments(ok)).toBe(`stores/${STORE}/2026/10/${HASH}.jpg`);
    expect(keyFromSegments(["..", "..", ".env"])).toBeNull();
    expect(keyFromSegments(["stores", STORE, "2026", "10", "..", `${HASH}.jpg`])).toBeNull();
    expect(keyFromSegments(["stores", STORE, "2026", "10", `..%2F${HASH}.jpg`])).toBeNull();
    expect(keyFromSegments(["stores", STORE, "2026", "10", `${HASH}.svg`])).toBeNull();
    expect(keyFromSegments(["stores", STORE, "2026", "13", `${HASH}.jpg`])).toBeNull();
    expect(keyFromSegments(["stores\\..", STORE, "2026", "10", `${HASH}.jpg`])).toBeNull();
    expect(keyFromSegments([])).toBeNull();
    expect(isValidMediaKey(`stores/${STORE}/2026/10/${HASH}.jpg/../../x`)).toBe(false);
  });

  it("le chemin disque reste dans le dossier de stockage", () => {
    const root = path.resolve("/srv/axi/uploads");
    expect(localPathFor(root, `stores/${STORE}/2026/10/${HASH}.png`)).toBe(path.join(root, "stores", STORE, "2026", "10", `${HASH}.png`));
    expect(() => localPathFor(root, "../../etc/passwd")).toThrow();
  });
});

describe("URL acceptées en écriture et en lecture", () => {
  const local = `/media/stores/${STORE}/2026/10/${HASH}.webp`;
  const bucket = `https://media.axi.africa/stores/${STORE}/2026/10/${HASH}.webp`;

  it("médias locaux et du bucket reconnus, le reste non", () => {
    expect(isLocalMediaPath(local)).toBe(true);
    expect(isStoredMediaUrl(local, null)).toBe(true);
    expect(isStoredMediaUrl(bucket, "https://media.axi.africa")).toBe(true);
    expect(isStoredMediaUrl("http://minio.local:9000/axi/" + bucket.split(".africa/")[1], "http://minio.local:9000/axi")).toBe(true);
    expect(isStoredMediaUrl(`/media/../.env`, null)).toBe(false);
    expect(isStoredMediaUrl(`https://evil.example/stores/${STORE}/2026/10/${HASH}.webp`, "https://media.axi.africa")).toBe(false);
  });

  it("produits, thème et rendu acceptent /media ; le schéma produit n'admet qu'une data-URL raster bornée (la garde d'écriture n'accepte que l'existant), le rendu les lit encore", () => {
    expect(imageUrlSchema.safeParse(local).success).toBe(true);
    expect(imageUrlSchema.safeParse(bucket).success).toBe(true);
    // Data-URL raster bornée : passe le schéma (produit ancien modifiable avant migration) ; checkImageWrite refuse toute NOUVELLE valeur.
    expect(imageUrlSchema.safeParse("data:image/jpeg;base64,/9j/4AAQ").success).toBe(true);
    expect(imageUrlSchema.safeParse(`data:image/png;base64,${"A".repeat(500_000)}`).success).toBe(false); // trop lourde
    expect(imageUrlSchema.safeParse("data:image/svg+xml;base64,PHN2Zz4=").success).toBe(false);
    expect(imageUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(isSafeImageUrl(local)).toBe(true);
    expect(safeImageUrl(local)).toBe(local);
    expect(safeImageUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
  });

  it("le loader d'images ne transforme pas les médias téléversés", () => {
    expect(imageLoader({ src: local, width: 640 })).toBe(local);
    expect(imageLoader({ src: bucket, width: 640 })).toBe(bucket);
  });

  it("partage (Open Graph) : URL absolue pour /media, jamais de data-URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://axi.africa");
    expect(shareableImageUrl(local)).toBe(`https://axi.africa${local}`);
    expect(shareableImageUrl("data:image/png;base64,AAAA")).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe("pilote local + storeImage", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "axi-media-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("écrit, dédoublonne par hash du contenu et refuse un SVG", async () => {
    const driver = new LocalDriver({ dir });
    const date = new Date("2026-10-11T00:00:00Z");
    const first = await storeImage(STORE, SAMPLES.png, { driver, date });
    expect(first.created).toBe(true);
    expect(first.url).toMatch(new RegExp(`^/media/stores/${STORE}/2026/10/[a-f0-9]{64}\\.png$`));
    expect(await driver.read(first.key)).toEqual(Buffer.from(SAMPLES.png));

    const before = vi.fn();
    const again = await storeImage(STORE, SAMPLES.png, { driver, date, reserve: before });
    expect(again).toMatchObject({ key: first.key, created: false });
    expect(before).not.toHaveBeenCalled(); // quota non sollicité pour un doublon

    await expect(storeImage(STORE, pad("<svg onload=alert(1)>"), { driver })).rejects.toBeInstanceOf(InvalidImageError);
    const listed = [];
    for await (const o of driver.list("stores/")) listed.push(o.key);
    expect(listed).toEqual([first.key]);
  });
});

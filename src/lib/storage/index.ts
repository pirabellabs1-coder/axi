import "server-only";
import { readStorageConfig, type StorageConfig } from "./config";
import { LocalDriver, S3Driver, type StorageDriver } from "./drivers";
import { imageSizeIssue, readImageSize, sniffImageType } from "./image-type";
import { buildMediaKey, type MediaNamespace } from "./keys";
import { sha256Hex } from "./sigv4";

/**
 * Point d'entrée serveur de la couche de stockage des médias.
 * Les modules purs (`keys`, `image-type`, `public-url`, `data-url`, `quota`, `sigv4`) sont importables
 * ailleurs (client, scripts, tests) ; celui-ci choisit le pilote selon l'environnement.
 */
export { MAX_UPLOAD_BYTES } from "./limits";

let cached: { driver: StorageDriver; config: StorageConfig } | null = null;
let warned = false;

export function getStorage(): StorageDriver {
  if (cached) return cached.driver;
  const config = readStorageConfig();
  if ("warning" in config && config.warning && !warned) {
    warned = true;
    console.warn(`[storage] ${config.warning}`);
  }
  const driver = config.driver === "s3" ? new S3Driver(config) : new LocalDriver(config);
  cached = { driver, config };
  return driver;
}

export function getStorageConfig(): StorageConfig {
  getStorage();
  return cached!.config;
}

export type StoredImage = { key: string; url: string; bytes: number; mime: string; created: boolean };

/** Fichier vendu (vague 2) : AUCUNE url — il n'est servi que par la route de téléchargement. */
export type StoredFile = { key: string; bytes: number; mime: string; created: boolean };

export class InvalidImageError extends Error {
  constructor(
    message: string,
    readonly reason: "type" | "dimensions" = "type",
  ) {
    super(message);
  }
}

/**
 * Enregistre une image (octets déjà lus, taille déjà bornée par l'appelant) pour une boutique.
 * Format décidé par les octets magiques, dimensions lues dans l'en-tête (8000 px de côté, 40 Mpx maximum),
 * clé dérivée du hash du contenu. `created` = false si l'objet existait déjà (dédoublonnage : rien n'est réécrit
 * ni recompté). `reserve` est appelé juste avant l'écriture (quota) ; `release` rembourse si l'écriture échoue.
 */
export async function storeImage(
  storeId: string,
  body: Uint8Array,
  opts: { driver?: StorageDriver; date?: Date; namespace?: MediaNamespace; reserve?: (bytes: number) => Promise<void>; release?: (bytes: number) => Promise<void> } = {},
): Promise<StoredImage> {
  const type = sniffImageType(body);
  if (!type) throw new InvalidImageError("Format non pris en charge : JPEG, PNG, WebP, AVIF ou GIF uniquement.");
  const sizeIssue = imageSizeIssue(readImageSize(body, type));
  if (sizeIssue) throw new InvalidImageError(sizeIssue, "dimensions");
  const driver = opts.driver ?? getStorage();
  const sha = sha256Hex(body);
  const key = buildMediaKey(storeId, sha, type.ext, opts.date, opts.namespace);
  const url = driver.publicUrl(key);
  if (await driver.exists(key)) return { key, url, bytes: body.byteLength, mime: type.mime, created: false };
  await opts.reserve?.(body.byteLength);
  try {
    await driver.put(key, body, type.mime, sha);
  } catch (e) {
    await opts.release?.(body.byteLength).catch((err) => console.error("[storage] remboursement du quota impossible", err));
    throw e;
  }
  return { key, url, bytes: body.byteLength, mime: type.mime, created: true };
}

/**
 * Enregistre un FICHIER VENDU (produit numérique, vague 2) : format décidé par les octets magiques,
 * clé `stores/{storeId}/files/…` (jamais publique), dédoublonnage par hash du contenu.
 * Même mécanique de quota que les images (compteur `media_kb` partagé) : réservation avant écriture, remboursement si échec.
 */
export async function storeFile(
  storeId: string,
  body: Uint8Array,
  opts: { driver?: StorageDriver; date?: Date; reserve?: (bytes: number) => Promise<void>; release?: (bytes: number) => Promise<void> } = {},
): Promise<StoredFile> {
  const { sniffFileType, buildFileKey, FILE_TYPE_LABELS } = await import("./file-keys");
  const type = sniffFileType(body);
  if (!type) throw new InvalidImageError(`Format non pris en charge : ${FILE_TYPE_LABELS} uniquement.`);
  const driver = opts.driver ?? getStorage();
  const sha = sha256Hex(body);
  const key = buildFileKey(storeId, sha, type.ext, opts.date);
  if (await driver.exists(key)) return { key, bytes: body.byteLength, mime: type.mime, created: false };
  await opts.reserve?.(body.byteLength);
  try {
    await driver.put(key, body, type.mime, sha);
  } catch (e) {
    await opts.release?.(body.byteLength).catch((err) => console.error("[storage] remboursement du quota impossible", err));
    throw e;
  }
  return { key, bytes: body.byteLength, mime: type.mime, created: true };
}

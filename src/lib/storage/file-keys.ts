/**
 * Clés des FICHIERS VENDUS (produits numériques, vague 2) — module pur, client et serveur.
 *
 * Clé : `stores/{storeId}/files/{aaaa}/{mm}/{sha256}.{ext}` — contenu immuable (hash), dédoublonné par mois.
 * Aucune donnée fournie par le client n'entre dans la clé (pas de nom de fichier) : pas de traversée de chemin.
 *
 * DIFFÉRENCE ESSENTIELLE avec les médias (`keys.ts`) : une clé de fichier ne passe PAS `isValidMediaKey`,
 * donc la route publique `/media/[...key]` la refuse (404) et aucune URL publique n'est jamais produite.
 * Les fichiers ne sont servis que par `/telechargement/{jeton}/fichier/{assetId}`, après contrôle du jeton,
 * de l'expiration, de la limite et du débit (flux relayé par le serveur, le bucket n'est jamais exposé).
 */

/** Types acceptés : documents, archives, livres, audio, vidéo et images. */
export const FILE_TYPES = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/epub+zip": "epub",
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type FileMime = keyof typeof FILE_TYPES;
export type FileExt = (typeof FILE_TYPES)[FileMime];

export const EXT_TO_FILE_MIME: Record<FileExt, FileMime> = {
  pdf: "application/pdf",
  zip: "application/zip",
  epub: "application/epub+zip",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Libellés affichés dans l'espace marchand. */
export const FILE_TYPE_LABELS = "PDF, ZIP, EPUB, MP3, MP4, JPEG, PNG, WebP";

/** Attribut `accept` de l'input de téléversement. */
export const ACCEPTED_FILE_TYPES = Object.keys(FILE_TYPES).join(",");

/** Taille maximale d'UN fichier vendu (documentée dans docs/vague2/N-produits-numeriques.md). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Nombre maximal de fichiers par produit. */
export const MAX_FILES_PER_PRODUCT = 20;

/** Seul format de clé de fichier accepté, en écriture comme en lecture. */
export const FILE_KEY_RE = /^stores\/[a-z0-9]{8,40}\/files\/\d{4}\/(0[1-9]|1[0-2])\/[a-f0-9]{64}\.(pdf|zip|epub|mp3|mp4|jpg|png|webp)$/;

export function isValidFileKey(key: string): boolean {
  return FILE_KEY_RE.test(key);
}

export function buildFileKey(storeId: string, sha256Hex: string, ext: FileExt, date: Date = new Date()): string {
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const key = `stores/${storeId}/files/${yyyy}/${mm}/${sha256Hex}.${ext}`;
  if (!isValidFileKey(key)) throw new Error("Clé de fichier invalide");
  return key;
}

/** Préfixe des fichiers vendus d'une boutique (inventaire, purge). */
export function fileKeyPrefix(storeId: string): string {
  return `stores/${storeId}/files/`;
}

/** Type MIME d'une clé valide (déduit de l'extension, elle-même issue des octets magiques). */
export function mimeForFileKey(key: string): FileMime | null {
  if (!isValidFileKey(key)) return null;
  const ext = key.slice(key.lastIndexOf(".") + 1) as FileExt;
  return EXT_TO_FILE_MIME[ext] ?? null;
}

/** La clé appartient-elle bien à cette boutique ? (défense en profondeur avant toute lecture) */
export function fileKeyBelongsTo(key: string, storeId: string): boolean {
  return isValidFileKey(key) && key.startsWith(fileKeyPrefix(storeId));
}

/**
 * Format décidé par les OCTETS, jamais par le type annoncé par le navigateur.
 * ZIP et EPUB partagent la signature `PK\x03\x04` : l'EPUB se reconnaît au `mimetype` stocké en tête d'archive.
 */
export function sniffFileType(bytes: Uint8Array): { mime: FileMime; ext: FileExt } | null {
  const b = bytes;
  const at = (i: number) => (i < b.length ? b[i] : -1);
  const starts = (sig: readonly number[], offset = 0) => sig.every((x, i) => at(offset + i) === x);
  const ascii = (offset: number, text: string) => [...text].every((c, i) => at(offset + i) === c.charCodeAt(0));

  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf" }; // %PDF-
  if (starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06]) || starts([0x50, 0x4b, 0x07, 0x08])) {
    // EPUB = ZIP dont le premier membre est « mimetype » contenant application/epub+zip.
    if (ascii(30, "mimetypeapplication/epub+zip")) return { mime: "application/epub+zip", ext: "epub" };
    return { mime: "application/zip", ext: "zip" };
  }
  if (starts([0x49, 0x44, 0x33])) return { mime: "audio/mpeg", ext: "mp3" }; // ID3
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return { mime: "audio/mpeg", ext: "mp3" }; // trame MPEG
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(Math.max(0, at(8)), Math.max(0, at(9)), Math.max(0, at(10)), Math.max(0, at(11)));
    // isom, iso2, mp41, mp42, avc1, M4V… = conteneur MP4. « M4A » reste de l'audio MP4 : refusé (converti en MP3).
    if (/^(isom|iso2|iso4|iso5|iso6|mp41|mp42|avc1|M4V |dash)$/.test(brand)) return { mime: "video/mp4", ext: "mp4" };
    return null;
  }
  if (starts([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { mime: "image/webp", ext: "webp" };
  return null;
}

/** Nom de fichier proposé au téléchargement : nom du fichier assaini + extension de la clé. */
export function downloadFileName(name: string, key: string): string {
  const ext = isValidFileKey(key) ? key.slice(key.lastIndexOf(".") + 1) : "";
  // Jamais de guillemet, de retour à la ligne, de « / » ni de caractère de contrôle dans un en-tête.
  const base = (name || "fichier")
    .normalize("NFKD")
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/\.+$/, "");
  const safe = base || "fichier";
  return ext && !safe.toLowerCase().endsWith(`.${ext}`) ? `${safe}.${ext}` : safe;
}

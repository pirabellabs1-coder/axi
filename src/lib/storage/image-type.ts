import { IMAGE_TYPES, type ImageExt, type ImageMime } from "./keys";

/**
 * Détection du format par les octets magiques (module pur). Liste blanche stricte : JPEG, PNG, WebP,
 * AVIF, GIF. Le type annoncé par le client (Content-Type, extension) n'est jamais cru : un SVG, un HTML
 * ou un PDF renommé en `.png` est refusé, ce qui interdit tout contenu actif servi depuis notre origine.
 */
export type SniffedImage = { mime: ImageMime; ext: ImageExt };

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

export function sniffImageType(bytes: Uint8Array): SniffedImage | null {
  const b = bytes;
  if (b.length < 12) return null;
  const hit = (mime: ImageMime): SniffedImage => ({ mime, ext: IMAGE_TYPES[mime] });

  // JPEG : FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return hit("image/jpeg");
  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return hit("image/png");
  // GIF : GIF87a / GIF89a
  const gif = ascii(b, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return hit("image/gif");
  // WebP : RIFF....WEBP
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return hit("image/webp");
  // AVIF : boîte ISO-BMFF `ftyp` dont la marque majeure ou une marque compatible est avif / avis
  if (ascii(b, 4, 4) === "ftyp") {
    const boxSize = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
    const end = Math.min(b.length, boxSize >= 16 ? boxSize : 16, 256);
    for (let i = 8; i + 4 <= end; i += 4) {
      if (i === 12) continue; // champ minor_version
      const brand = ascii(b, i, 4);
      if (brand === "avif" || brand === "avis") return hit("image/avif");
    }
  }
  return null;
}

/* ───────────────────────── Dimensions (en-tête uniquement) ───────────────────────── */

/** Plafonds : au-delà, refus (une image « bombe » de 30 000 × 30 000 px tient en quelques Ko mais sature le décodeur). */
export const MAX_IMAGE_SIDE = 8000;
export const MAX_IMAGE_PIXELS = 40_000_000;

export type ImageSize = { width: number; height: number };

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) m = b[++i + 1]; // octets de bourrage
    if ((m >= 0xd0 && m <= 0xd9) || m === 0x01) {
      i += 2; // marqueurs sans longueur
      continue;
    }
    // SOF0..SOF15 hors DHT (C4), JPG (C8) et DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: be16(b, i + 5), width: be16(b, i + 7) };
    const len = be16(b, i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X" && b.length >= 30) return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) };
  if (chunk === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  if (chunk === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
    return { width: 1 + (b[21] | ((b[22] & 0x3f) << 8)), height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) };
  }
  return null;
}

/** AVIF : boîtes `ispe` (largeur/hauteur de chaque élément) ; on retient la plus grande (image principale). */
function avifSize(b: Uint8Array): ImageSize | null {
  let best: ImageSize | null = null;
  const end = Math.min(b.length - 16, 1 << 20);
  for (let i = 4; i < end; i++) {
    if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {
      // [taille][« ispe »][version+drapeaux (4)][largeur (4)][hauteur (4)]
      const size = { width: be32(b, i + 8), height: be32(b, i + 12) };
      if (!best || size.width * size.height > best.width * best.height) best = size;
    }
  }
  return best;
}

/** Dimensions lues dans l'en-tête, sans décoder l'image. null si illisibles. */
export function readImageSize(bytes: Uint8Array, type: SniffedImage): ImageSize | null {
  const b = bytes;
  let s: ImageSize | null = null;
  switch (type.mime) {
    case "image/png":
      s = ascii(b, 12, 4) === "IHDR" && b.length >= 24 ? { width: be32(b, 16), height: be32(b, 20) } : null;
      break;
    case "image/gif":
      s = b.length >= 10 ? { width: le16(b, 6), height: le16(b, 8) } : null;
      break;
    case "image/jpeg":
      s = jpegSize(b);
      break;
    case "image/webp":
      s = webpSize(b);
      break;
    case "image/avif":
      s = avifSize(b);
      break;
  }
  return s && s.width > 0 && s.height > 0 ? s : null;
}

/** Message d'erreur si les dimensions sont illisibles ou excessives, sinon null. */
export function imageSizeIssue(size: ImageSize | null): string | null {
  if (!size) return "Dimensions de l'image illisibles : fichier endommagé ou format non pris en charge.";
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE || size.width * size.height > MAX_IMAGE_PIXELS) {
    return `Image trop grande (${size.width} × ${size.height} px) : ${MAX_IMAGE_SIDE} px de côté et 40 mégapixels maximum.`;
  }
  return null;
}

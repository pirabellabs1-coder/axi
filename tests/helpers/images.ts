/**
 * En-têtes minimaux mais valides de chaque format (octets magiques + dimensions lisibles), complétés par des zéros.
 * Suffisants pour la détection de format et la lecture des dimensions ; non décodables par un navigateur.
 */
export const pad = (head: number[] | string | Uint8Array, len = 64) => {
  const bytes = typeof head === "string" ? [...Buffer.from(head, "latin1")] : [...head];
  return new Uint8Array([...bytes, ...new Array(Math.max(0, len - bytes.length)).fill(0)]);
};

const ascii = (s: string) => [...Buffer.from(s, "latin1")];
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

export const make = {
  jpeg: (w = 2, h = 2) => pad([0xff, 0xd8, 0xff, 0xe0, ...be16(16), ...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, ...be16(17), 8, ...be16(h), ...be16(w), 3]),
  /** JPEG progressif (SOF2) précédé d'un segment EXIF et d'octets de bourrage. */
  jpegProgressive: (w = 2, h = 2) => pad([0xff, 0xd8, 0xff, 0xe1, ...be16(8), ...ascii("Exif\0\0"), 0xff, 0xff, 0xc2, ...be16(17), 8, ...be16(h), ...be16(w), 3]),
  png: (w = 2, h = 2) => pad([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii("IHDR"), ...be32(w), ...be32(h), 8, 6, 0, 0, 0]),
  gif: (w = 2, h = 2) => pad([...ascii("GIF89a"), ...le16(w), ...le16(h), 0]),
  webp: (w = 2, h = 2) => pad([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8X"), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]),
  webpLossy: (w = 2, h = 2) => pad([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8 "), 0x18, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]),
  webpLossless: (w = 2, h = 2) => {
    const a = w - 1;
    const b = h - 1;
    return pad([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8L"), 5, 0, 0, 0, 0x2f, a & 0xff, ((a >> 8) & 0x3f) | ((b & 0x03) << 6), (b >> 2) & 0xff, (b >> 10) & 0x0f]);
  },
  avif: (w = 2, h = 2, major = "avif") =>
    pad([...be32(0x1c), ...ascii("ftyp"), ...ascii(major), 0, 0, 0, 0, ...ascii("avifmif1miaf"), ...be32(20), ...ascii("ispe"), 0, 0, 0, 0, ...be32(w), ...be32(h)]),
};

export const SAMPLES = {
  jpeg: make.jpeg(),
  png: make.png(),
  gif: make.gif(),
  webp: make.webp(),
  avif: make.avif(),
  avifCompat: make.avif(2, 2, "mif1"),
};

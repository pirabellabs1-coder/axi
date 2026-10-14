/**
 * Loader next/image : délègue le redimensionnement au CDN Unsplash (déjà optimisé : AVIF/WebP, recadrage),
 * ce qui évite un second passage par l'optimiseur Next et ses délais réseau. Les autres sources sont servies telles quelles,
 * en particulier les médias téléversés (`/media/…` ou STORAGE_PUBLIC_URL) : déjà compressés à ~300 Ko, immuables et
 * mis en cache un an ; aucun paramètre n'y est ajouté (l'URL reste stable, donc cacheable par le CDN).
 */
export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  if (src.startsWith("/")) return src;
  if (src.startsWith("https://images.unsplash.com/")) {
    const url = new URL(src);
    const w = Number(url.searchParams.get("w")) || 0;
    const h = Number(url.searchParams.get("h")) || 0;
    url.searchParams.set("w", String(width));
    if (w && h) url.searchParams.set("h", String(Math.round((h / w) * width)));
    url.searchParams.set("q", String(quality ?? 72));
    url.searchParams.set("auto", "format");
    if (!url.searchParams.has("fit")) url.searchParams.set("fit", "crop");
    return url.toString();
  }
  return src;
}

/** Version réduite d'une image (vignettes) : redimensionne les URL Unsplash, laisse les autres intactes. */
export function thumbUrl(src: string | null | undefined, width = 160): string {
  if (!src) return "";
  return src.startsWith("https://images.unsplash.com/") ? imageLoader({ src, width, quality: 60 }) : src;
}

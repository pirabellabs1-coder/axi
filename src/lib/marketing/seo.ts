import { MEDIA, unsplash } from "@/config/media";

/**
 * Image Open Graph d'une page marketing (1200 x 630).
 *
 * Next ne fusionne pas `openGraph.images` avec la racine dès qu'une page définit son propre
 * objet `openGraph` : chaque page qui en déclare un doit donc fournir son image.
 */
export function ogImage(key: keyof typeof MEDIA = "market") {
  const m = MEDIA[key];
  return [{ url: unsplash(m.id, 1200, 630), width: 1200, height: 630, alt: m.alt }];
}

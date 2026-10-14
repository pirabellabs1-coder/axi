import { BLOG_TAGS_MAX, BLOG_TAG_MAX } from "./constants";

/** Étiquettes saisies « conseils, recettes » : minuscules, sans #, dédoublonnées, 10 au plus (fonction pure). */
export function parseTags(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const tags = raw
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, " ").slice(0, BLOG_TAG_MAX).trim())
    .filter((t) => t.length >= 2 && !/[<>"&]/.test(t));
  return [...new Set(tags)].slice(0, BLOG_TAGS_MAX);
}

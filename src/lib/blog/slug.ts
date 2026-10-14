import { BLOG_SLUG_MAX, RESERVED_POST_SLUGS } from "./constants";

/**
 * Adresses (slugs) du blog : fonctions pures, testées (tests/blog-slug.test.ts).
 * Unicité par boutique (`@@unique([storeId, slug])`) : en cas de doublon, suffixe `-2`, `-3`… (§3, cas limites).
 */

export function blogSlugify(input: string, max = BLOG_SLUG_MAX): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** Candidats dans l'ordre : base, base-2, base-3… ; la base est raccourcie pour laisser la place au suffixe. */
export function slugCandidates(base: string, count = 30, max = BLOG_SLUG_MAX): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const suffix = i === 1 ? "" : `-${i}`;
    out.push(`${base.slice(0, max - suffix.length).replace(/-+$/g, "")}${suffix}`);
  }
  return out;
}

/**
 * Première adresse libre. `taken` : adresses déjà utilisées par d'autres articles de la même boutique.
 * Les adresses réservées (segments statiques du blog) sont sautées. Renvoie null si tout est pris.
 */
export function pickFreeSlug(base: string, taken: Iterable<string>, opts: { reserved?: string[]; count?: number } = {}): string | null {
  const used = new Set(taken);
  const reserved = new Set(opts.reserved ?? RESERVED_POST_SLUGS);
  for (const c of slugCandidates(base, opts.count ?? 30)) {
    if (c.length >= 2 && !used.has(c) && !reserved.has(c)) return c;
  }
  return null;
}

/** Normalise une saisie d'adresse (ou le titre en repli). Chaîne vide si inutilisable. */
export function baseSlug(slugInput: string | null | undefined, title: string): string {
  const s = blogSlugify(slugInput?.trim() || title);
  return s.length >= 2 ? s : blogSlugify(`article-${title}`) || "article";
}

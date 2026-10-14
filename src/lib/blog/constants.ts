/**
 * Constantes du blog de la boutique (lot 2 D, docs/specs/LOT-2-international-contenu.md §3).
 * Module pur : importable côté client (éditeur) comme serveur.
 */

export const BLOG_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];

export const BLOG_STATUS_LABELS: Record<BlogStatus, string> = {
  DRAFT: "Brouillon",
  SCHEDULED: "Programmé",
  PUBLISHED: "Publié",
  ARCHIVED: "Archivé",
};

export const BLOG_TITLE_MAX = 120;
export const BLOG_EXCERPT_MAX = 300;
export const BLOG_BODY_MAX = 30_000;
export const BLOG_SEO_TITLE_MAX = 70;
export const BLOG_SEO_DESCRIPTION_MAX = 160;
export const BLOG_AUTHOR_MAX = 60;
export const BLOG_TAGS_MAX = 10;
export const BLOG_TAG_MAX = 30;
export const BLOG_SLUG_MAX = 80;
export const BLOG_IMAGE_ALT_MAX = 200;
export const BLOG_CATEGORIES_MAX = 30;
export const BLOG_CATEGORY_NAME_MAX = 60;
export const BLOG_CATEGORY_DESCRIPTION_MAX = 300;

/** Articles par page de la liste publique (réglage `per_page` de la section `main-blog`, borné). */
export const BLOG_PER_PAGE_DEFAULT = 9;
export const BLOG_PER_PAGE_MIN = 3;
export const BLOG_PER_PAGE_MAX = 24;

/** Rédaction d'un brouillon par l'IA : 3 crédits IA (§3). */
export const BLOG_AI_COST = 3;

/** Programmation : au moins 2 minutes dans le futur (sinon « publier maintenant »). */
export const BLOG_SCHEDULE_MIN_MS = 2 * 60_000;

/**
 * Adresses d'article impossibles : segments statiques de /s/{slug}/blog/… (catégorie, flux).
 * Un titre qui produirait l'une d'elles reçoit un suffixe (`categorie-2`).
 */
export const RESERVED_POST_SLUGS = ["categorie", "rss", "rss-xml", "page", "tag", "etiquette"];

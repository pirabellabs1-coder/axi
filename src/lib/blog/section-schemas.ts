/**
 * Schémas des sections de thème du blog (lot 2 D) : `blog-posts` (« Derniers articles »), `main-blog` (modèle blog),
 * `main-article` (modèle article). Enregistrés dans l'agrégateur de schémas du moteur de thème par une ligne.
 * Composants : src/components/storefront/sections/{blog-posts,main-blog,main-article}.tsx.
 *
 * La catégorie de la section « Derniers articles » est un réglage `blog_category` (sélecteur des catégories de la
 * boutique dans l'éditeur ; valeur = adresse de la catégorie, ce qui garde lisibles les valeurs de l'ancien champ texte).
 */
import type { SectionSchema, SettingField } from "@/lib/theme-engine/types";
import { HEADING, PADDING, SCHEME } from "@/lib/theme-engine/section-schemas/_shared";

const IMAGE_RATIO: SettingField = {
  type: "segmented",
  id: "image_ratio",
  label: "Format des images",
  default: "landscape",
  options: [
    { value: "landscape", label: "Paysage" },
    { value: "square", label: "Carré" },
    { value: "portrait", label: "Portrait" },
  ],
};

export const blogPostsSchema: SectionSchema = {
  type: "blog-posts",
  name: "Derniers articles",
  category: "Texte",
  settings: [
    ...HEADING("Derniers articles"),
    { type: "range", id: "limit", label: "Articles affichés", default: 3, min: 2, max: 12 },
    // Consolidation vague 2 : sélecteur dédié (valeur = adresse de la catégorie, comme l'ancien champ texte, toujours lu).
    { type: "blog_category", id: "category", label: "Catégorie", default: "", info: "Vide : tous les articles." },
    {
      type: "segmented",
      id: "layout",
      label: "Disposition",
      default: "grid",
      options: [
        { value: "grid", label: "Grille" },
        { value: "featured", label: "À la une" },
        { value: "list", label: "Liste" },
      ],
    },
    { type: "segmented", id: "columns", label: "Colonnes (grille)", default: "3", options: [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }] },
    { type: "checkbox", id: "show_image", label: "Image de couverture", default: true },
    IMAGE_RATIO,
    { type: "checkbox", id: "show_excerpt", label: "Extrait", default: true },
    { type: "checkbox", id: "show_date", label: "Date et temps de lecture", default: true },
    { type: "checkbox", id: "show_category", label: "Catégorie", default: true },
    { type: "checkbox", id: "show_view_all", label: "Lien « Tous les articles »", default: true },
    { type: "paragraph", content: "Affiche les articles publiés du blog (Blog dans le menu de gauche). Masquée tant qu'aucun article n'est publié." },
    SCHEME,
    ...PADDING,
  ],
  presets: [{ name: "Derniers articles" }],
};

export const mainBlogSchema: SectionSchema = {
  type: "main-blog",
  name: "Liste des articles",
  category: "Modèle",
  templates: ["blog"],
  required: true,
  settings: [
    { type: "text", id: "heading", label: "Titre du blog", default: "Le blog", maxLength: 80 },
    { type: "textarea", id: "description", label: "Présentation", default: "", maxLength: 300 },
    { type: "checkbox", id: "show_categories", label: "Filtre par catégorie", default: true },
    { type: "checkbox", id: "feature_first", label: "Premier article à la une", default: true },
    { type: "segmented", id: "layout", label: "Disposition", default: "grid", options: [{ value: "grid", label: "Grille" }, { value: "list", label: "Liste" }] },
    { type: "segmented", id: "columns", label: "Colonnes (grille)", default: "3", options: [{ value: "2", label: "2" }, { value: "3", label: "3" }] },
    { type: "range", id: "per_page", label: "Articles par page", default: 9, min: 3, max: 24, step: 3 },
    { type: "header", content: "Cartes d'article" },
    { type: "checkbox", id: "show_image", label: "Image de couverture", default: true },
    IMAGE_RATIO,
    { type: "checkbox", id: "show_excerpt", label: "Extrait", default: true },
    { type: "checkbox", id: "show_author", label: "Auteur", default: false },
    { type: "checkbox", id: "show_reading_time", label: "Temps de lecture", default: true },
    ...PADDING.map((f) => (f.type === "range" ? { ...f, default: f.id === "padding_top" ? 32 : 64 } : f)),
  ],
  presets: [{ name: "Liste des articles" }],
};

export const mainArticleSchema: SectionSchema = {
  type: "main-article",
  name: "Article",
  category: "Modèle",
  templates: ["article"],
  required: true,
  settings: [
    { type: "segmented", id: "width", label: "Largeur du texte", default: "narrow", options: [{ value: "narrow", label: "Étroite" }, { value: "wide", label: "Large" }] },
    { type: "segmented", id: "header_align", label: "Alignement de l'en-tête", default: "left", options: [{ value: "left", label: "Gauche" }, { value: "center", label: "Centre" }] },
    { type: "checkbox", id: "show_breadcrumbs", label: "Fil d'Ariane", default: true },
  ],
  blocks: [
    { type: "title", name: "Titre", limit: 1, settings: [{ type: "segmented", id: "size", label: "Taille", default: "lg", options: [{ value: "md", label: "Moyen" }, { value: "lg", label: "Grand" }, { value: "xl", label: "Très grand" }] }, { type: "checkbox", id: "show_category", label: "Catégorie au-dessus du titre", default: true }] },
    { type: "meta", name: "Date et auteur", limit: 1, settings: [{ type: "checkbox", id: "show_date", label: "Date", default: true }, { type: "checkbox", id: "show_author", label: "Auteur", default: true }, { type: "checkbox", id: "show_reading_time", label: "Temps de lecture", default: true }] },
    { type: "image", name: "Image de couverture", limit: 1, settings: [{ type: "segmented", id: "size", label: "Largeur", default: "wide", options: [{ value: "text", label: "Comme le texte" }, { value: "wide", label: "Large" }] }, { type: "segmented", id: "ratio", label: "Format", default: "landscape", options: [{ value: "landscape", label: "Paysage" }, { value: "wide", label: "Panoramique" }, { value: "square", label: "Carré" }] }] },
    { type: "body", name: "Contenu", limit: 1, settings: [{ type: "checkbox", id: "show_tags", label: "Étiquettes en fin d'article", default: true }] },
    { type: "share", name: "Partager", limit: 1, settings: [{ type: "text", id: "label", label: "Texte", default: "Partager cet article", maxLength: 60 }] },
    { type: "related", name: "Articles liés", limit: 1, settings: [{ type: "text", id: "heading", label: "Titre", default: "À lire aussi", maxLength: 80 }, { type: "range", id: "limit", label: "Articles", default: 3, min: 2, max: 6 }] },
  ],
  maxBlocks: 6,
  presets: [{ name: "Article", blocks: [{ type: "title" }, { type: "meta" }, { type: "image" }, { type: "body" }, { type: "share" }, { type: "related" }] }],
};

/** Schémas du blog, ajoutés par l'agrégateur `SECTION_SCHEMAS` (src/lib/theme-engine/schemas.ts) après ceux du cœur. */
export const BLOG_SECTION_SCHEMAS: SectionSchema[] = [blogPostsSchema, mainBlogSchema, mainArticleSchema];

/**
 * Moteur de thèmes Axi v2 — contrat partagé entre l'éditeur (espace marchand) et le rendu (boutique publique).
 *
 * Modèle inspiré de Shopify « Online Store 2.0 » :
 *  - un DOCUMENT de thème par boutique (`Store.themeDocDraft` brouillon, `Store.themeDoc` publié, historique `ThemeVersion`) ;
 *  - des RÉGLAGES GLOBAUX (couleurs, typographie, boutons, cartes produit, en-tête, pied de page) ;
 *  - des MODÈLES DE PAGE (accueil, produit, collection, catalogue, page, panier) composés de SECTIONS ordonnées ;
 *  - chaque section a des réglages et une liste ordonnée de BLOCS, décrits par un SCHÉMA (SECTION_SCHEMAS) :
 *    l'éditeur génère ses formulaires à partir du schéma, le rendu lit les valeurs.
 * Aucun JavaScript ni HTML libre du commerçant : uniquement des valeurs typées et validées (sécurité, §11).
 */

export const THEME_DOC_VERSION = 2;

/* ───────────── Champs de réglage (générateur de formulaires) ───────────── */

export type SettingField =
  | { type: "text"; id: string; label: string; default?: string; placeholder?: string; maxLength?: number; info?: string }
  | { type: "textarea"; id: string; label: string; default?: string; maxLength?: number; info?: string }
  | { type: "richtext"; id: string; label: string; default?: string; info?: string } // Markdown limité (gras, italique, liens, listes)
  | { type: "number"; id: string; label: string; default?: number; min?: number; max?: number; step?: number; unit?: string }
  | { type: "range"; id: string; label: string; default: number; min: number; max: number; step?: number; unit?: string }
  | { type: "checkbox"; id: string; label: string; default?: boolean; info?: string }
  | { type: "select"; id: string; label: string; default?: string; options: { value: string; label: string }[] }
  | { type: "segmented"; id: string; label: string; default?: string; options: { value: string; label: string }[] }
  | { type: "color"; id: string; label: string; default?: string }
  | { type: "image"; id: string; label: string; info?: string } // valeur : { url, alt } | null
  | { type: "video"; id: string; label: string; info?: string } // URL YouTube/Vimeo/MP4 https
  | { type: "url"; id: string; label: string; default?: string } // lien interne (/collections/x) ou https
  | { type: "collection"; id: string; label: string } // id de Category
  | { type: "product"; id: string; label: string } // id de Product
  | { type: "product_list"; id: string; label: string; limit?: number } // ids de Product
  | { type: "menu"; id: string; label: string; default?: string } // handle de StoreMenu
  | { type: "blog_category"; id: string; label: string; default?: string; info?: string } // adresse (slug) d'une BlogCategory, "" = toutes
  | { type: "font"; id: string; label: string; default?: FontId }
  | { type: "header"; content: string } // séparateur visuel dans le formulaire
  | { type: "paragraph"; content: string };

/**
 * Lot 4 §5 : source dynamique. Un réglage compatible (DYNAMIC_SOURCE_FIELD_TYPES) peut valoir `{ "$source": "product.title" }`
 * au lieu d'une valeur fixe ; grammaire fermée DYNAMIC_SOURCE_RE ; résolue au rendu puis repassée par `sanitizeFieldValue`.
 * Les lecteurs `S.*` (theme-doc.ts) renvoient le défaut tant que la résolution n'est pas branchée.
 */
export type DynamicSource = { $source: string };

/** Valeur d'un réglage `blog_category` : adresse de catégorie du blog (minuscules, chiffres, tirets ; 80 caractères), ou "". */
export const BLOG_CATEGORY_HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export type SettingValue = string | number | boolean | null | { url: string; alt?: string } | string[] | DynamicSource;
export type Settings = Record<string, SettingValue>;

export const DYNAMIC_SOURCE_RE =
  /^(product|variant|collection|store|page|article)\.(title|vendor|description|type|tags|price|compare_at_price|image|url|metafields\.[a-z0-9_]{1,32}\.[a-z0-9_]{1,64})$/;
/** Types de champ qui acceptent une source dynamique (matrice de compatibilité affinée par l'équipe Moteur). */
export const DYNAMIC_SOURCE_FIELD_TYPES = ["text", "textarea", "richtext", "image", "url", "color"] as const satisfies readonly SettingField["type"][];

export function isDynamicSource(v: unknown): v is DynamicSource {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  const src = (v as { $source?: unknown }).$source;
  return keys.length === 1 && keys[0] === "$source" && typeof src === "string" && src.length <= 120 && DYNAMIC_SOURCE_RE.test(src);
}

/* ───────────── Lot 4 : animations, audiences, modèles alternatifs ───────────── */

export const SECTION_ANIMATIONS = ["inherit", "none", "fade-up", "fade", "zoom-in", "slide-left"] as const;
export type SectionAnimation = (typeof SECTION_ANIMATIONS)[number];

export const MOTION_PRESETS = ["none", "subtle", "lively"] as const;
export type MotionSettings = { preset: (typeof MOTION_PRESETS)[number]; reveal: boolean; parallax: boolean; hoverZoom: boolean };
/** Défaut du lot 4 §2 : appliqué au rendu quand `GlobalSettings.motion` est absent, et aux clés manquantes d'un `motion` partiel. */
export const DEFAULT_MOTION: MotionSettings = { preset: "subtle", reveal: true, parallax: false, hoverZoom: true };

export const AUDIENCE_CUSTOMER_SEGMENTS = ["anonymous", "new", "returning", "loyal", "has_points"] as const;
export const AUDIENCE_SOURCES = ["whatsapp", "instagram", "tiktok", "facebook", "google", "direct", "campaign"] as const;
export const AUDIENCE_DEVICES = ["mobile", "desktop"] as const;

/** Règle d'audience (lot 4 §12), évaluée côté serveur ; jamais utilisée pour masquer ou modifier un prix. */
export type AudienceRule =
  | { type: "city"; values: string[] } // villes (≤ 50, ≤ 80 caractères)
  | { type: "customer"; values: (typeof AUDIENCE_CUSTOMER_SEGMENTS)[number][] }
  | { type: "source"; values: (typeof AUDIENCE_SOURCES)[number][] }
  | { type: "locale"; values: string[] } // codes de langue ^[a-z]{2,3}$
  | { type: "schedule"; days: number[] /* 0 = dimanche */; from: string /* HH:MM */; to: string /* HH:MM */ } // fuseau de la boutique
  | { type: "device"; values: (typeof AUDIENCE_DEVICES)[number][] };

export type SectionVisibility = { match: "all" | "any"; mode: "show" | "hide"; rules: AudienceRule[] };

export const ALTERNATE_TEMPLATE_TYPES = ["product", "collection", "page", "article"] as const;
export type AlternateTemplateType = (typeof ALTERNATE_TEMPLATE_TYPES)[number];
export const ALTERNATE_SUFFIX_RE = /^[a-z0-9-]{1,24}$/;

/** Plafonds du lot 4 §1. */
export const MAX_ALTERNATE_TEMPLATES = 20;
export const MAX_VISIBILITY_RULES = 10;
export const MAX_PERSONALIZED_SECTIONS_PER_TEMPLATE = 30;

/* ───────────── Document ───────────── */

export type BlockInstance = {
  id: string;
  type: string;
  settings: Settings;
  disabled?: boolean;
};

export type SectionInstance = {
  id: string;
  type: SectionType;
  settings: Settings;
  blocks: BlockInstance[];
  disabled?: boolean;
  /** Lot 4 §12 : visibilité par audience (absente = visible pour tous). */
  visibility?: SectionVisibility;
  /** Lot 4 §2 : animation d'apparition (absente = « inherit », réglage global). */
  animation?: SectionAnimation;
};

/** `blog` et `article` : lot 2 (blog de la boutique) ; complétés par le défaut pour les documents antérieurs. */
export type TemplateId = "home" | "product" | "collection" | "catalog" | "page" | "cart" | "search" | "not_found" | "blog" | "article";

export type Template = {
  /** Ordre d'affichage des sections. */
  order: string[];
  sections: Record<string, SectionInstance>;
};

export type FontId =
  | "geist"
  | "inter-tight"
  | "manrope"
  | "dm-sans"
  | "plus-jakarta"
  | "outfit"
  | "fraunces"
  | "playfair"
  | "cormorant"
  | "space-grotesk"
  | "system";

export type GlobalSettings = {
  colors: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    primary: string; // boutons principaux
    primaryText: string;
    accent: string; // badges, promotions
    border: string;
    /**
     * Schémas de couleur alternatifs utilisables par section (ex. « sombre », « marque »).
     * Rôles avancés optionnels (absents des documents antérieurs) : si `null`/absent, le rendu conserve la dérivation
     * automatique (surface/bordure via color-mix, lien = couleur du texte, bouton secondaire = contour du bouton primaire).
     */
    schemes: {
      id: string;
      name: string;
      background: string;
      text: string;
      primary: string;
      primaryText: string;
      /** Surface des cartes/encadrés. Absent → dérivée (`text` mélangé au fond). */
      surface?: string | null;
      /** Couleur des bordures/lignes. Absent → dérivée. */
      border?: string | null;
      /** Couleur des liens. Absent → couleur du texte. */
      link?: string | null;
      /** Fond du bouton secondaire. Absent → contour (bouton secondaire en style « contour »). */
      secondaryButton?: string | null;
      /** Texte du bouton secondaire. Absent → contraste calculé. */
      secondaryButtonText?: string | null;
    }[];
  };
  typography: {
    heading: FontId;
    body: FontId;
    headingWeight: 500 | 600 | 700 | 800;
    scale: number /* 0.85..1.3 — échelle générale, pilote surtout les titres */;
    uppercaseButtons: boolean;
    /** Interlettrage des titres (em, −0.05..0.1). Absent des documents antérieurs → 0 (rendu inchangé). */
    headingTracking: number;
    /** Casse des titres de section. Absent → « none » (rendu inchangé). */
    headingTransform: "none" | "uppercase" | "small-caps";
    /** Échelle du texte courant (0.9..1.2), distincte des titres. Absent → reprend `scale` (rendu inchangé). */
    bodyScale: number;
    /** Interligne du texte courant. Absent → « normal » (1.6). */
    bodyLeading: "tight" | "normal" | "relaxed";
    /** Interligne des titres. Absent → « tight » (1.05). */
    headingLineHeight: "tight" | "normal";
  };
  buttons: {
    radius: number /* px */;
    style: "solid" | "outline" | "soft";
    shadow: boolean;
    /** Épaisseur de contour des boutons (0–3 px). Absent des documents antérieurs → complété par défaut. */
    borderWidth: number;
    /** Gabarit des boutons (hauteur + padding). Absent des documents antérieurs → « normal ». */
    size: "compact" | "normal" | "large";
  };
  cards: {
    radius: number;
    imageRatio: "square" | "portrait" | "landscape" | "natural";
    showVendor: boolean;
    showSecondImage: boolean;
    quickAdd: boolean;
    border: boolean;
    /** Lot 1 : cœur « favori » sur les cartes produit (comptes acheteurs). Défaut false ; absent des anciens documents. */
    showFavorite: boolean;
    /** Badge promo : « -20 % » (percent, défaut), « Promo » (text) ou aucun (hidden). Seuil ≥ 5 % inchangé. Absent → percent. */
    saleBadge: "percent" | "text" | "hidden";
    /** Présentation : image puis texte (standard, défaut) ou texte superposé en bas de l'image (overlay). Absent → standard. */
    style: "standard" | "overlay";
    /** Badge « Nouveau » sur les produits récents (≤ 30 j). Défaut false ; absent des anciens documents. */
    showNewBadge: boolean;
  };
  layout: { pageWidth: number /* 1100..1600 */; sectionSpacing: number /* px */; gutter: number };
  header: {
    logo: { url: string; alt?: string } | null;
    logoWidth: number;
    layout: "logo-left" | "logo-center" | "minimal";
    sticky: boolean;
    menu: string; // handle StoreMenu
    showSearch: boolean;
    /** Lot 1 : icône « Compte » (lien /compte) dans l'en-tête. Défaut true ; absent des anciens documents. */
    showAccount: boolean;
    /** Vague 2 : sélecteur de devise d'affichage (si la boutique en propose au moins deux). Défaut true ; absent des anciens documents. */
    showCurrencyPicker: boolean;
    /**
     * En-tête transparent superposé à la 1re bannière (type Shopify) : si la 1re section du corps est une bannière
     * éligible (fond image plein cadre ou schéma sombre), l'en-tête se superpose en transparent (texte clair) en haut
     * de page, puis devient opaque au défilement. Défaut false ; absent des anciens documents (rendu inchangé).
     */
    transparentOverHero: boolean;
    announcement: { enabled: boolean; text: string; link?: string; scheme?: string };
  };
  footer: {
    menus: string[]; // handles
    showSocial: boolean;
    social: { instagram?: string; facebook?: string; tiktok?: string; youtube?: string; whatsapp?: string };
    text: string;
    showPaymentIcons: boolean;
    newsletter: boolean;
  };
  product: {
    gallery: "stacked" | "carousel" | "thumbnails-left" | "thumbnails-bottom" | "grid-2";
    variantPicker: "buttons" | "dropdown" | "swatches";
    stickyAddToCart: boolean;
    showSku: boolean;
    showStock: boolean;
    showShareButtons: boolean;
  };
  cart: { type: "drawer" | "page"; showNote: boolean; freeShippingBar: boolean };
  social: { favicon: { url: string } | null; shareImage: { url: string } | null };
  /** Lot 4 §2 : préréglages d'animation (absent = DEFAULT_MOTION au rendu ; aucune animation sous prefers-reduced-motion). */
  motion?: MotionSettings;
};

export type ThemeDocument = {
  version: typeof THEME_DOC_VERSION;
  /** Modèle de départ (général, restaurant, mode…) — informatif. */
  preset: string;
  settings: GlobalSettings;
  templates: Record<TemplateId, Template>;
  /**
   * Lot 4 §6 : modèles alternatifs par type, indexés par suffixe (ALTERNATE_SUFFIX_RE), choisis par `templateSuffix`
   * (Product, Category, StorePage, BlogPost). Rendu : `alternates[type][suffix] ?? templates[type]`. 20 au total.
   */
  alternates?: Partial<Record<AlternateTemplateType, Record<string, Template>>>;
  updatedAt?: string;
};

/* ───────────── Types de sections ───────────── */

export type SectionType =
  | "announcement-bar"
  | "hero-banner"
  | "slideshow"
  | "image-with-text"
  | "rich-text"
  | "featured-collection"
  | "featured-product"
  | "collection-list"
  | "product-grid" // catalogue filtrable
  | "multicolumn"
  | "image-gallery"
  | "video"
  | "testimonials"
  | "reviews"
  | "faq"
  | "newsletter"
  | "whatsapp-cta"
  | "contact"
  | "opening-hours"
  | "map"
  | "logo-list"
  | "countdown"
  | "trust-badges"
  | "custom-spacer"
  // Sections propres aux modèles
  | "main-product" // fiche produit (blocs : titre, prix, variantes, quantité, boutons, description, onglets, avis, partage…)
  | "product-recommendations"
  | "main-collection" // en-tête de collection + grille + filtres
  | "main-search" // modèle « Recherche » (vague 2) : champ, résultats, filtres, suggestions
  | "main-page"
  | "main-cart"
  // Lot 1 : barre d'offres (paliers de panier, progression), modèles panier et accueil
  | "blog-posts" | "main-blog" | "main-article" // Lot 2 (équipe Blog) : schémas src/lib/blog/section-schemas.ts
  | "product-specs" | "hero-split-video" | "lookbook" | "before-after" | "size-guide" | "comparison-table" | "marquee" // Lot 4 (équipe T3) : section-schemas/_t3-sections.ts
  | "shoppable-video" | "stories" | "live-shopping" // Lot 4D (équipe CAN) : section-schemas/_can-sections.ts
  | "cart-progress";

export type BlockSchema = {
  type: string;
  name: string;
  /** Nombre maximum d'instances dans la section (défaut : illimité). */
  limit?: number;
  settings: SettingField[];
};

export type SectionSchema = {
  type: SectionType;
  name: string;
  /** Catégorie dans le sélecteur « Ajouter une section ». */
  category: "Mise en avant" | "Produits" | "Texte" | "Médias" | "Confiance" | "Contact" | "Structure" | "Modèle";
  /** Modèles où la section peut être ajoutée (défaut : tous sauf sections de modèle). */
  templates?: TemplateId[];
  /** Section obligatoire et unique d'un modèle (ex. main-product). */
  required?: boolean;
  settings: SettingField[];
  blocks?: BlockSchema[];
  maxBlocks?: number;
  /** Instance par défaut lors de l'ajout. */
  presets: { name: string; settings?: Settings; blocks?: { type: string; settings?: Settings }[] }[];
};

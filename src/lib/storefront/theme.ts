/**
 * Thèmes de boutique : personnalisation encadrée par composants (jamais de JS marchand).
 *
 * Deux niveaux :
 *  - `ThemeConfig` : réglages visuels enregistrés par le marchand (couleurs, police, disposition, sections).
 *  - `ThemePreset` : modèle par secteur (restaurant, pâtisserie, mode…) qui fournit une config par défaut
 *    ET des libellés / comportements adaptés (« Voir le menu », « Prendre rendez-vous »…).
 *
 * Compatibilité : les anciens ids (`market`, `fashion`, `beauty`) restent résolus vers leur équivalent sectoriel.
 */
export type SectionId = "hero" | "categories" | "featured" | "products" | "about" | "hours" | "contact" | "faq" | "testimonials";

export type ThemeConfig = {
  primary: string;
  accent: string;
  font: "sans" | "display" | "serif";
  radius: "sharp" | "soft" | "round";
  layout: "grid" | "list";
  heroStyle: "banner" | "minimal" | "split";
  sections: SectionId[];
  announcement?: string | null;
  faq?: { q: string; a: string }[];
  testimonials?: { name: string; text: string }[];
  about?: string | null;
};

export type Sector = "general" | "restaurant" | "patisserie" | "mode" | "beaute" | "salon" | "clinique";

/** Libellés de la vitrine adaptés au secteur. Tous en français, vouvoiement, sans tiret cadratin. */
export type SectorCopy = {
  browseCta: string; // CTA du hero
  catalogTitle: string; // titre de la grille
  featuredTitle: string;
  addLabel: string; // bouton d'ajout
  searchPlaceholder: string;
  emptyCatalog: string;
  pickupTitle: string; // mode « retrait »
  pickupHint: string;
  slotLabel: string;
  checkoutTitle: string;
  confirmLabel: string; // bouton final (suivi du montant)
  itemNoun: string; // « article », « plat », « prestation »
};

export type ThemePreset = {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  sector: Sector;
  /** Rendez-vous : le mode « retrait » devient « rendez-vous sur place » (salon, clinique). */
  booking: boolean;
  copy: SectorCopy;
  config: ThemeConfig;
  /** Ancien id conservé pour compatibilité ; masqué des nouveaux choix. */
  legacy?: boolean;
};

const SHOP_COPY: SectorCopy = {
  browseCta: "Voir les produits",
  catalogTitle: "Nos produits",
  featuredTitle: "Coups de cœur",
  addLabel: "Ajouter",
  searchPlaceholder: "Rechercher un produit",
  emptyCatalog: "Le catalogue sera bientôt disponible.",
  pickupTitle: "Retrait sur place",
  pickupHint: "Vous venez chercher votre commande.",
  slotLabel: "Créneau de retrait",
  checkoutTitle: "Finaliser ma commande",
  confirmLabel: "Commander",
  itemNoun: "article",
};

const FOOD_COPY: SectorCopy = {
  ...SHOP_COPY,
  browseCta: "Voir le menu",
  catalogTitle: "Le menu",
  featuredTitle: "Les incontournables",
  searchPlaceholder: "Rechercher un plat",
  emptyCatalog: "Le menu sera bientôt disponible.",
  pickupTitle: "À emporter",
  pickupHint: "Vous récupérez votre commande sur place.",
  itemNoun: "plat",
};

const BOOKING_COPY: SectorCopy = {
  ...SHOP_COPY,
  browseCta: "Prendre rendez-vous",
  catalogTitle: "Nos prestations",
  featuredTitle: "Prestations phares",
  addLabel: "Réserver",
  searchPlaceholder: "Rechercher une prestation",
  emptyCatalog: "Les prestations seront bientôt disponibles.",
  pickupTitle: "Rendez-vous sur place",
  pickupHint: "Vous venez au salon au créneau choisi.",
  slotLabel: "Créneau souhaité",
  checkoutTitle: "Prendre rendez-vous",
  confirmLabel: "Confirmer le rendez-vous",
  itemNoun: "prestation",
};

const BASE_SECTIONS: SectionId[] = ["hero", "categories", "featured", "products", "about", "hours", "faq", "contact"];

/** Modèles par secteur (ordre d'affichage dans l'éditeur). */
export const SECTOR_PRESETS: ThemePreset[] = [
  {
    id: "general",
    name: "Boutique",
    description: "Polyvalent, photo plein cadre, grille de produits aérée.",
    bestFor: "Boutique générale, épicerie, électronique",
    sector: "general",
    booking: false,
    copy: SHOP_COPY,
    config: { primary: "#0D3B2E", accent: "#B8F06A", font: "sans", radius: "round", layout: "grid", heroStyle: "banner", sections: BASE_SECTIONS },
  },
  {
    id: "restaurant",
    name: "Table",
    description: "Menu en liste, suppléments visibles, commande en deux gestes.",
    bestFor: "Restaurant, maquis, traiteur",
    sector: "restaurant",
    booking: false,
    copy: FOOD_COPY,
    config: { primary: "#9A3412", accent: "#F5B82E", font: "sans", radius: "soft", layout: "list", heroStyle: "split", sections: ["hero", "categories", "featured", "products", "hours", "faq", "contact"] },
  },
  {
    id: "patisserie",
    name: "Douceur",
    description: "Grandes photos gourmandes, best-sellers mis en avant.",
    bestFor: "Pâtisserie, boulangerie, jus et glaces",
    sector: "patisserie",
    booking: false,
    copy: { ...FOOD_COPY, catalogTitle: "Nos douceurs", featuredTitle: "Les préférées", searchPlaceholder: "Rechercher une douceur" },
    config: { primary: "#7A2E3A", accent: "#F4C7A1", font: "display", radius: "round", layout: "grid", heroStyle: "banner", sections: ["hero", "featured", "categories", "products", "about", "hours", "faq", "contact"] },
  },
  {
    id: "mode",
    name: "Atelier",
    description: "Visuels éditoriaux, typographie élégante, grille aérée.",
    bestFor: "Mode, pagnes, accessoires, artisanat",
    sector: "mode",
    booking: false,
    copy: { ...SHOP_COPY, catalogTitle: "La collection", featuredTitle: "Nouveautés", searchPlaceholder: "Rechercher une pièce" },
    config: { primary: "#14201B", accent: "#C8553D", font: "serif", radius: "sharp", layout: "grid", heroStyle: "minimal", sections: ["hero", "featured", "categories", "products", "about", "faq", "contact"] },
  },
  {
    id: "beaute",
    name: "Éclat",
    description: "Doux et lumineux, routines et best-sellers en vitrine.",
    bestFor: "Cosmétiques, soins, parfums",
    sector: "beaute",
    booking: false,
    copy: { ...SHOP_COPY, featuredTitle: "Best-sellers", searchPlaceholder: "Rechercher un soin" },
    config: { primary: "#6B2A4F", accent: "#E9B7C8", font: "display", radius: "round", layout: "grid", heroStyle: "banner", sections: ["hero", "featured", "categories", "products", "about", "faq", "contact"] },
  },
  {
    id: "salon",
    name: "Salon",
    description: "Prestations en liste, réservation de créneau, rendez-vous sur place.",
    bestFor: "Coiffure, barbier, onglerie, spa",
    sector: "salon",
    booking: true,
    copy: BOOKING_COPY,
    config: { primary: "#2E2A4A", accent: "#E8B04B", font: "display", radius: "round", layout: "list", heroStyle: "split", sections: ["hero", "categories", "products", "about", "hours", "faq", "contact"] },
  },
  {
    id: "clinique",
    name: "Cabinet",
    description: "Sobre et rassurant : consultations, horaires, accès.",
    bestFor: "Clinique, cabinet, laboratoire, pharmacie",
    sector: "clinique",
    booking: true,
    copy: { ...BOOKING_COPY, catalogTitle: "Consultations et soins", featuredTitle: "Consultations fréquentes", searchPlaceholder: "Rechercher une consultation", pickupHint: "Vous vous présentez au cabinet au créneau choisi." },
    config: { primary: "#0F4C5C", accent: "#7CC6B6", font: "sans", radius: "soft", layout: "list", heroStyle: "minimal", sections: ["hero", "categories", "products", "about", "hours", "faq", "contact"] },
  },
];

/** Anciens ids (v1) : conservés pour ne casser ni les boutiques existantes ni l'éditeur. */
const LEGACY_ALIASES: Record<string, Sector> = { market: "general", fashion: "mode", beauty: "beaute" };

const LEGACY_PRESETS: ThemePreset[] = Object.entries(LEGACY_ALIASES).map(([id, sector]) => {
  const p = SECTOR_PRESETS.find((x) => x.sector === sector)!;
  return { ...p, id, name: `${p.name} (v1)`, legacy: true };
});

/** Liste complète (les entrées `legacy` doivent être masquées des nouveaux choix par l'éditeur). */
export const THEME_PRESETS: ThemePreset[] = [...SECTOR_PRESETS, ...LEGACY_PRESETS];

export function isKnownPreset(id: string): boolean {
  return THEME_PRESETS.some((p) => p.id === id);
}

export function getPreset(id: string): ThemePreset {
  return THEME_PRESETS.find((t) => t.id === id) ?? SECTOR_PRESETS[0];
}

const SECTOR_ALIASES: Record<string, Sector> = {
  ...LEGACY_ALIASES,
  food: "restaurant",
  bakery: "patisserie",
  pastry: "patisserie",
  beauty: "beaute",
  beauté: "beaute",
  coiffure: "salon",
  health: "clinique",
  sante: "clinique",
  santé: "clinique",
};

/** Modèle du secteur (Store.sector). Accepte les anciens ids et quelques synonymes ; repli sur `general`. */
export function presetForSector(sector: string | null | undefined): ThemePreset {
  const raw = (sector ?? "").toLowerCase().trim();
  const s = (SECTOR_PRESETS.some((p) => p.sector === raw) ? raw : SECTOR_ALIASES[raw]) as Sector | undefined;
  return SECTOR_PRESETS.find((p) => p.sector === s) ?? SECTOR_PRESETS[0];
}

/**
 * Modèle effectif d'une boutique : le secteur déclaré s'il est spécifique, sinon celui du thème choisi.
 * (Une boutique `general` sur le thème `restaurant` reçoit les libellés « menu ».)
 */
export function storefrontPreset(sector: string | null | undefined, themeId: string): ThemePreset {
  const bySector = presetForSector(sector);
  if (bySector.sector !== "general") return bySector;
  const byTheme = getPreset(themeId);
  return presetForSector(byTheme.sector);
}

export function resolveTheme(themeId: string, config: unknown): ThemeConfig {
  const base = getPreset(themeId).config;
  if (!config || typeof config !== "object") return base;
  const c = config as Partial<ThemeConfig>;
  const sections = Array.isArray(c.sections) ? (c.sections.filter((s) => ALL_SECTIONS.includes(s as SectionId)) as SectionId[]) : [];
  return {
    ...base,
    ...c,
    primary: isHex(c.primary) ? c.primary! : base.primary,
    accent: isHex(c.accent) ? c.accent! : base.accent,
    font: c.font === "sans" || c.font === "display" || c.font === "serif" ? c.font : base.font,
    radius: c.radius === "sharp" || c.radius === "soft" || c.radius === "round" ? c.radius : base.radius,
    layout: c.layout === "grid" || c.layout === "list" ? c.layout : base.layout,
    heroStyle: c.heroStyle === "banner" || c.heroStyle === "minimal" || c.heroStyle === "split" ? c.heroStyle : base.heroStyle,
    sections: sections.length ? sections : base.sections,
  };
}

export const ALL_SECTIONS: SectionId[] = ["hero", "categories", "featured", "products", "about", "hours", "testimonials", "faq", "contact"];

export const SECTION_LABELS: Record<SectionId, string> = {
  hero: "En-tête (logo, bannière, nom)",
  categories: "Catégories",
  featured: "Produits mis en avant",
  products: "Tous les produits",
  about: "À propos",
  hours: "Horaires d'ouverture",
  testimonials: "Témoignages",
  faq: "Questions fréquentes",
  contact: "Contact et adresse",
};

function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

/**
 * Jetons du thème clair d'Axi, réappliqués sur le conteneur de la boutique : la vitrine reste claire
 * même si le visiteur (ou le marchand connecté) est en thème sombre.
 */
export const STORE_LIGHT_TOKENS: Record<string, string> = {
  "--c-canvas": "#f6f6f3",
  "--c-canvas-deep": "#ecece6",
  "--c-surface": "#ffffff",
  "--c-surface-2": "#f1f1ec",
  "--c-line": "#e4e4dd",
  "--c-line-strong": "#d0d0c7",
  "--c-ink": "#111412",
  "--c-ink-muted": "#575e59",
  "--c-ink-faint": "#7d847f",
  "--c-primary": "#0d3b2e",
  "--c-primary-hover": "#0a2f24",
  "--c-primary-soft": "#e3eee8",
  "--c-primary-deep": "#072319",
  "--c-on-primary": "#ffffff",
  "--c-accent": "#b8f06a",
  "--c-accent-hover": "#a6e352",
  "--c-accent-soft": "#eef9dc",
  "--c-on-accent": "#0b1a10",
  "--c-sun": "#f2b53a",
  "--c-sun-soft": "#fdf3dc",
  "--c-info": "#2459d6",
  "--c-info-soft": "#e7eefc",
  "--c-warning": "#a35208",
  "--c-warning-soft": "#fcefdf",
  "--c-danger": "#c42b2b",
  "--c-danger-soft": "#fbe7e5",
  "--c-whatsapp": "#25d366",
  "--c-whatsapp-deep": "#0f7a5c",
  "--c-shadow": "17 20 18",
  "--c-highlight": "255 255 255",
  colorScheme: "light",
};

/** Variables CSS inline pour la boutique. Contraste du texte sur la couleur primaire calculé. */
export function themeCssVars(t: ThemeConfig): Record<string, string> {
  const radius = { sharp: "6px", soft: "14px", round: "999px" }[t.radius];
  const cardRadius = { sharp: "8px", soft: "18px", round: "24px" }[t.radius];
  const mediaRadius = { sharp: "4px", soft: "14px", round: "18px" }[t.radius];
  return {
    "--store-primary": t.primary,
    "--store-primary-contrast": contrastText(t.primary),
    "--store-primary-soft": hexToRgba(t.primary, 0.08),
    "--store-primary-ring": hexToRgba(t.primary, 0.22),
    "--store-accent": t.accent,
    "--store-accent-contrast": contrastText(t.accent),
    "--store-accent-soft": hexToRgba(t.accent, 0.18),
    "--store-radius": radius,
    "--store-card-radius": cardRadius,
    "--store-media-radius": mediaRadius,
  };
}

export function contrastText(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const lum = relLum(r, g, b);
  const withWhite = 1.05 / (lum + 0.05);
  const withBlack = (lum + 0.05) / 0.05;
  return withWhite >= withBlack ? "#ffffff" : "#14201b";
}

function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function relLum(r: number, g: number, b: number) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * Documents de thème par défaut (un par secteur) et migration de l'ancien thème v1.
 * Module pur : importable par l'éditeur (client) comme par le rendu (serveur).
 */
import { SECTION_SCHEMAS } from "./schemas";
import { lateMainSections } from "./editor-defaults";
import { THEME_DOC_VERSION, type BlockInstance, type FontId, type GlobalSettings, type SectionInstance, type SectionType, type Settings, type Template, type TemplateId, type ThemeDocument } from "./types";
import { presetForSector, resolveTheme, storefrontPreset, type Sector, type SectionId as LegacySectionId } from "@/lib/storefront/theme";

export const SECTORS: Sector[] = ["general", "restaurant", "patisserie", "mode", "beaute", "salon", "clinique"];

/** Informations de la boutique utilisées pour pré-remplir les textes (facultatives). */
export type DefaultsStoreInfo = { name?: string | null; tagline?: string | null; description?: string | null; bannerUrl?: string | null; logoUrl?: string | null };

/* ───────────────────────── Fabrique de sections ───────────────────────── */

function schemaDefaults(fields: { type: string; id?: string; default?: unknown }[]): Settings {
  const out: Settings = {};
  for (const f of fields) if (f.id && f.default !== undefined) out[f.id] = f.default as Settings[string];
  return out;
}

type BlockSpec = { type: string; settings?: Settings };

/** Instance de section avec les valeurs par défaut du schéma, complétées par `settings`. */
export function buildSection(id: string, type: SectionType, settings: Settings = {}, blocks?: BlockSpec[]): SectionInstance {
  const schema = SECTION_SCHEMAS[type];
  const specs = blocks ?? schema.presets[0]?.blocks ?? [];
  const built: BlockInstance[] = specs.map((b, i) => {
    const bs = schema.blocks?.find((x) => x.type === b.type);
    return { id: `${id}-${b.type}-${i + 1}`, type: b.type, settings: { ...schemaDefaults(bs?.settings ?? []), ...(b.settings ?? {}) } };
  });
  return { id, type, settings: { ...schemaDefaults(schema.settings), ...(schema.presets[0]?.settings ?? {}), ...settings }, blocks: built };
}

function template(...sections: SectionInstance[]): Template {
  return { order: sections.map((s) => s.id), sections: Object.fromEntries(sections.map((s) => [s.id, s])) };
}

/* ───────────────────────── Réglages globaux par secteur ───────────────────────── */

type Palette = { background: string; surface: string; text: string; muted: string; primary: string; primaryText: string; accent: string; border: string };

const SECTOR_LOOK: Record<Sector, { colors: Palette; heading: FontId; body: FontId; weight: 500 | 600 | 700 | 800; btn: number; card: number; ratio: GlobalSettings["cards"]["imageRatio"]; gallery: GlobalSettings["product"]["gallery"]; uppercase?: boolean }> = {
  general: {
    colors: { background: "#F7F6F2", surface: "#FFFFFF", text: "#141816", muted: "#5A615C", primary: "#0D3B2E", primaryText: "#FFFFFF", accent: "#B8F06A", border: "#E3E2DA" },
    heading: "geist", body: "geist", weight: 600, btn: 999, card: 16, ratio: "portrait", gallery: "thumbnails-left",
  },
  restaurant: {
    colors: { background: "#FBF7F1", surface: "#FFFFFF", text: "#1E1410", muted: "#6A5B52", primary: "#9A3412", primaryText: "#FFFFFF", accent: "#F5B82E", border: "#EADFD2" },
    heading: "outfit", body: "dm-sans", weight: 700, btn: 12, card: 14, ratio: "square", gallery: "carousel",
  },
  patisserie: {
    colors: { background: "#FDF6F2", surface: "#FFFFFF", text: "#2A1519", muted: "#6E5559", primary: "#7A2E3A", primaryText: "#FFFFFF", accent: "#F4C7A1", border: "#F0DDD6" },
    heading: "fraunces", body: "dm-sans", weight: 600, btn: 999, card: 20, ratio: "portrait", gallery: "thumbnails-bottom",
  },
  mode: {
    colors: { background: "#F5F3EF", surface: "#FFFFFF", text: "#14201B", muted: "#585E5A", primary: "#14201B", primaryText: "#FFFFFF", accent: "#C8553D", border: "#E2DFD8" },
    heading: "cormorant", body: "manrope", weight: 600, btn: 0, card: 0, ratio: "portrait", gallery: "thumbnails-left", uppercase: true,
  },
  beaute: {
    colors: { background: "#FBF6F7", surface: "#FFFFFF", text: "#2B1622", muted: "#6C5662", primary: "#6B2A4F", primaryText: "#FFFFFF", accent: "#E9B7C8", border: "#EFDFE5" },
    heading: "playfair", body: "dm-sans", weight: 600, btn: 999, card: 18, ratio: "portrait", gallery: "thumbnails-bottom",
  },
  salon: {
    colors: { background: "#F6F5F9", surface: "#FFFFFF", text: "#1D1B2E", muted: "#5D5A70", primary: "#2E2A4A", primaryText: "#FFFFFF", accent: "#E8B04B", border: "#E2E0EA" },
    heading: "outfit", body: "manrope", weight: 600, btn: 999, card: 16, ratio: "square", gallery: "carousel",
  },
  clinique: {
    colors: { background: "#F3F7F7", surface: "#FFFFFF", text: "#0F2328", muted: "#4E6168", primary: "#0F4C5C", primaryText: "#FFFFFF", accent: "#7CC6B6", border: "#DCE6E7" },
    heading: "plus-jakarta", body: "plus-jakarta", weight: 600, btn: 10, card: 14, ratio: "landscape", gallery: "stacked",
  },
};

export function defaultGlobalSettings(sector: Sector, store: DefaultsStoreInfo = {}): GlobalSettings {
  const look = SECTOR_LOOK[sector] ?? SECTOR_LOOK.general;
  return {
    colors: {
      ...look.colors,
      schemes: [
        { id: "sombre", name: "Sombre", background: look.colors.text, text: look.colors.background, primary: look.colors.accent, primaryText: look.colors.text },
        { id: "doux", name: "Doux", background: mix(look.colors.primary, look.colors.background, 0.08), text: look.colors.text, primary: look.colors.primary, primaryText: look.colors.primaryText },
      ],
    },
    typography: { heading: look.heading, body: look.body, headingWeight: look.weight, scale: 1, uppercaseButtons: !!look.uppercase, headingTracking: 0, headingTransform: "none", bodyScale: 1, bodyLeading: "normal", headingLineHeight: "tight" },
    buttons: { radius: look.btn, style: "solid", shadow: look.btn > 20, borderWidth: 1, size: "normal" },
    cards: { radius: look.card, imageRatio: look.ratio, showVendor: sector === "mode" || sector === "beaute", showSecondImage: true, quickAdd: true, border: false, showFavorite: false, saleBadge: "percent", style: "standard", showNewBadge: false },
    layout: { pageWidth: 1280, sectionSpacing: sector === "mode" ? 72 : 56, gutter: 20 },
    header: {
      logo: store.logoUrl && /^https:\/\//.test(store.logoUrl) ? { url: store.logoUrl, alt: store.name ?? "" } : null,
      logoWidth: 120,
      layout: sector === "mode" || sector === "beaute" ? "logo-center" : "logo-left",
      sticky: true,
      menu: "main",
      showSearch: true,
      showAccount: true,
      showCurrencyPicker: true,
      transparentOverHero: false,
      announcement: { enabled: false, text: "", scheme: "brand" },
    },
    footer: { menus: ["footer"], showSocial: true, social: {}, text: store.tagline ?? "", showPaymentIcons: true, newsletter: false },
    product: { gallery: look.gallery, variantPicker: sector === "mode" ? "swatches" : "buttons", stickyAddToCart: true, showSku: false, showStock: true, showShareButtons: true },
    cart: { type: "drawer", showNote: sector === "restaurant" || sector === "patisserie", freeShippingBar: true },
    social: { favicon: null, shareImage: null },
  };
}

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((x, i) => Math.round(x * t + pb[i] * (1 - t)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/* ───────────────────────── Modèles de page ───────────────────────── */

function productTemplate(sector: Sector): Template {
  const booking = sector === "salon" || sector === "clinique";
  const food = sector === "restaurant" || sector === "patisserie";
  const blocks: BlockSpec[] = [
    ...(sector === "mode" || sector === "beaute" ? [{ type: "vendor" }] : []),
    { type: "title" },
    { type: "rating" },
    { type: "price", settings: { show_savings: true } },
    { type: "discount_badges", settings: { heading: "Offres disponibles" } },
    { type: "variant_picker", settings: { style: sector === "mode" ? "swatches" : "buttons", show_sold_out: true } },
    { type: "options" },
    ...(booking ? [] : [{ type: "stock" }]),
    { type: "quantity" },
    { type: "gift_card_form" },
    { type: "buy_buttons", settings: { show_whatsapp: true, show_buy_now: !booking } },
    { type: "complementary", settings: { heading: "Souvent achetés ensemble", max: 3 } },
    { type: "delivery_info" },
    { type: "description", settings: { collapsed: false } },
    { type: "collapsible_tab", settings: { title: "Détails", use_product_details: true, content: "" } },
    {
      type: "collapsible_tab",
      settings: {
        title: booking ? "Déroulement du rendez-vous" : food ? "Commande et retrait" : "Livraison et échanges",
        use_product_details: false,
        content: booking
          ? "Choisissez un créneau à l'étape suivante. La boutique vous confirme l'horaire exact sur WhatsApp."
          : food
            ? "Préparé à la commande. Livraison dans votre quartier ou retrait sur place, selon votre choix."
            : "Livraison dans les zones indiquées au moment de commander. Une question ? Écrivez-nous sur WhatsApp.",
      },
    },
    { type: "share" },
  ];
  return template(
    buildSection("main", "main-product", { gallery: SECTOR_LOOK[sector].gallery, zoom: true, sticky_info: true, sticky_add_to_cart: true }, blocks),
    buildSection("reviews", "reviews", { heading: "Avis clients", layout: "list", show_summary: true, show_product: false, limit: 6 }),
    buildSection("recommendations", "product-recommendations", { heading: booking ? "Autres prestations" : food ? "À commander avec" : "Vous aimerez aussi", limit: 4 }),
  );
}

function listingTemplate(): Template {
  return template(buildSection("main", "main-collection", { show_banner: true, show_filters: true, show_sort: true, per_page: 24, columns: "4" }));
}

/** Vague 2 : modèle « Recherche », commun à tous les préréglages de secteur (section `main-search` obligatoire). */
function searchTemplate(): Template {
  return template(buildSection("main", "main-search", { show_filters: true, show_sort: true, per_page: 24, columns: "4", show_suggestions: true, empty_content: "both" }));
}

function homeTemplate(sector: Sector, store: DefaultsStoreInfo): Template {
  const p = presetForSector(sector);
  const copy = p.copy;
  const banner = store.bannerUrl && /^https:\/\//.test(store.bannerUrl) ? { url: store.bannerUrl, alt: store.name ?? "" } : null;
  const title = store.name || "Bienvenue";
  const sub = store.tagline || store.description?.slice(0, 160) || "Commandez en ligne, payez par Mobile Money, recevez chez vous.";
  const hero = (layout: "overlay" | "split" | "below", height = "large", position = "bottom-left") =>
    buildSection("hero", "hero-banner", { image: banner, layout, height, content_position: position, overlay_opacity: layout === "overlay" ? 35 : 0 }, [
      { type: "heading", settings: { text: title, size: "xl" } },
      { type: "text", settings: { text: sub } },
      { type: "button", settings: { button_label: copy.browseCta, button_link: "/catalogue", button_style: "solid" } },
    ]);
  const about = store.description
    ? buildSection("about", "image-with-text", { image: null, image_position: "right", image_ratio: "portrait" }, [
        { type: "heading", settings: { text: "Notre histoire", size: "lg" } },
        { type: "text", settings: { text: store.description } },
      ])
    : null;
  const reviews = buildSection("reviews", "reviews", { heading: "Ils ont commandé", layout: "carousel", show_summary: true, show_product: true, limit: 8 });
  const faq = buildSection("faq", "faq", {}, [
    { type: "question", settings: { question: "Comment commander ?", answer: "Ajoutez vos articles au panier puis validez : sans compte, en moins d'une minute. Vous pouvez aussi commander sur WhatsApp." } },
    { type: "question", settings: { question: "Comment payer ?", answer: "Mobile Money, espèces à la livraison ou selon les moyens affichés au moment de commander." } },
    { type: "question", settings: { question: sector === "salon" || sector === "clinique" ? "Puis-je modifier mon rendez-vous ?" : "Livrez-vous chez moi ?", answer: sector === "salon" || sector === "clinique" ? "Oui, écrivez-nous sur WhatsApp au moins 24 h à l'avance." : "Les zones et frais de livraison s'affichent à l'étape de commande." } },
  ]);
  const wa = (heading: string, text: string, prefill: string) => buildSection("whatsapp", "whatsapp-cta", { heading, text, prefill, scheme: "brand" });
  const trust = buildSection("trust", "trust-badges", {}, [
    { type: "badge", settings: { icon: "truck", title: sector === "restaurant" ? "Livré chaud" : "Livraison rapide", text: "Dans votre quartier" } },
    { type: "badge", settings: { icon: "shield", title: "Paiement Mobile Money", text: "MTN, Moov, Wave ou espèces" } },
    { type: "badge", settings: { icon: "chat", title: "Réponse sur WhatsApp", text: "Une question ? On vous répond" } },
  ]);
  const contact = buildSection("contact", "contact", {});
  const hours = buildSection("hours", "opening-hours", {});
  const featured = (heading: string, layout: "grid" | "carousel" = "grid", columns = "4") => buildSection("featured", "featured-collection", { heading, collection: null, limit: 8, columns, layout, show_view_all: true });
  const grid = (heading: string, layout: "grid" | "list", columns = "4") => buildSection("catalog", "product-grid", { heading, layout, columns, per_page: 24, show_filters: false, show_search: false });
  const collections = (style: "tiles" | "chips" | "circles", heading = "Nos catégories") => buildSection("collections", "collection-list", { heading, style }, []);
  const keep = (...s: (SectionInstance | null)[]) => template(...s.filter((x): x is SectionInstance => !!x));

  switch (sector) {
    case "restaurant":
      return keep(hero("split", "medium"), featured(copy.featuredTitle, "carousel"), collections("chips", "Au menu"), grid(copy.catalogTitle, "list"), reviews, hours, wa("Commandez sur WhatsApp", "Une envie particulière, une grande commande ? Écrivez-nous, on prépare.", "Bonjour, je souhaite passer une commande."), faq, contact);
    case "patisserie":
      return keep(hero("overlay"), featured(copy.featuredTitle, "carousel"), collections("circles"), grid(copy.catalogTitle, "grid", "3"), about, reviews, hours, wa("Une commande sur mesure ?", "Gâteau d'anniversaire, plateau pour un événement : décrivez votre envie sur WhatsApp.", "Bonjour, je souhaite une commande sur mesure."), faq);
    case "mode": {
      const slides = buildSection("slideshow", "slideshow", { autoplay: true, speed: 6, height: "large" }, [
        { type: "slide", settings: { image: banner, heading: title, subheading: sub, button_label: "Découvrir la collection", button_link: "/catalogue", button_style: "solid" } },
        { type: "slide", settings: { image: null, heading: "Nouveautés", subheading: "Les dernières pièces de l'atelier.", button_label: "Voir les nouveautés", button_link: "/catalogue?tri=nouveautes", button_style: "solid" } },
      ]);
      return keep(slides, collections("tiles", "Par univers"), featured("Nouveautés", "grid", "4"), about, grid("Toute la collection", "grid", "4"), reviews, trust, buildSection("newsletter", "newsletter", { heading: "Les nouveautés en avant-première", text: "Recevez les nouvelles pièces sur WhatsApp, avant tout le monde.", channel: "whatsapp", scheme: "sombre" }));
    }
    case "beaute":
      return keep(
        hero("overlay", "large", "middle-left"),
        featured(copy.featuredTitle, "grid", "4"),
        buildSection("routine", "multicolumn", { heading: "Une routine simple", columns: "3", align: "left" }, [
          { type: "column", settings: { title: "Nettoyer", text: "Une peau propre absorbe mieux les soins." } },
          { type: "column", settings: { title: "Nourrir", text: "Beurres et huiles naturels, adaptés aux climats chauds." } },
          { type: "column", settings: { title: "Protéger", text: "Des gestes quotidiens pour un éclat durable." } },
        ]),
        collections("circles"),
        reviews,
        about,
        faq,
        buildSection("newsletter", "newsletter", { heading: "Conseils et nouveautés", text: "Recevez nos conseils beauté et nos offres sur WhatsApp.", channel: "whatsapp", scheme: "doux" }),
      );
    case "salon":
      return keep(hero("split", "medium"), grid(copy.catalogTitle, "list", "2"), hours, wa("Prendre rendez-vous", "Choisissez votre prestation puis votre créneau, ou écrivez-nous directement.", "Bonjour, je souhaite prendre rendez-vous."), reviews, about, faq, contact, buildSection("map", "map", { heading: "Venir au salon", address: "" }));
    case "clinique":
      return keep(hero("split", "medium"), trust, grid(copy.catalogTitle, "list", "2"), hours, wa("Prendre rendez-vous", "Écrivez-nous pour une consultation, une analyse ou un renseignement.", "Bonjour, je souhaite prendre rendez-vous."), contact, buildSection("map", "map", { heading: "Accès au cabinet", address: "" }), faq);
    default:
      return keep(hero("overlay"), collections("tiles"), featured(copy.featuredTitle, "grid", "4"), trust, grid(copy.catalogTitle, "grid", "4"), reviews, about, faq, wa("Une question ? Écrivez-nous", "Réponse rapide sur WhatsApp, du lundi au samedi.", "Bonjour, j'ai une question."), contact);
  }
}

/**
 * Lot 2 : modèles du blog. La section principale (`main-blog` / `main-article`, équipe Blog) est placée en tête dès que
 * son schéma existe ; en attendant, seules des sections existantes et neutres sont proposées.
 */
function blogTemplates(sector: Sector): { blog: Template; article: Template } {
  const food = sector === "restaurant" || sector === "patisserie";
  const main = (t: "blog" | "article") => lateMainSections(t).map((type) => buildSection("main", type));
  return {
    blog: template(
      ...main("blog"),
      buildSection("newsletter", "newsletter", { heading: "Ne manquez aucun article", text: food ? "Recevez nos recettes et nouveautés sur WhatsApp." : "Recevez nos nouveaux articles et conseils sur WhatsApp.", channel: "whatsapp" }),
    ),
    article: template(
      ...main("article"),
      buildSection("featured", "featured-collection", { heading: food ? "À goûter aussi" : "À découvrir aussi", collection: null, limit: 4, columns: "4", layout: "grid", show_view_all: true }),
    ),
  };
}

export function defaultTemplates(sector: Sector, store: DefaultsStoreInfo = {}): Record<TemplateId, Template> {
  const booking = sector === "salon" || sector === "clinique";
  return {
    home: homeTemplate(sector, store),
    product: productTemplate(sector),
    collection: listingTemplate(),
    catalog: listingTemplate(),
    search: searchTemplate(),
    page: template(buildSection("main", "main-page", { width: "narrow" })),
    cart: template(buildSection("main", "main-cart", { show_note: true }), buildSection("recommendations", "product-recommendations", { heading: booking ? "Autres prestations" : "Pour compléter votre commande", limit: 4 })),
    not_found: template(
      buildSection("message", "rich-text", { align: "center", padding_top: 80, padding_bottom: 32 }, [
        { type: "heading", settings: { text: "Page introuvable", size: "xl" } },
        { type: "text", settings: { text: "Ce produit ou cette page n'existe plus. Le reste de la boutique vous attend." } },
        { type: "button", settings: { button_label: "Retour à la boutique", button_link: "/", button_style: "solid" } },
      ]),
      buildSection("featured", "featured-collection", { heading: "Nos coups de cœur", collection: null, limit: 4, columns: "4", layout: "grid", show_view_all: true }),
    ),
    ...blogTemplates(sector),
  };
}

/** Document complet par défaut pour un secteur (repli : `general`). */
export function defaultThemeDocument(sector: string | null | undefined, store: DefaultsStoreInfo = {}): ThemeDocument {
  const s = presetForSector(sector).sector;
  return { version: THEME_DOC_VERSION, preset: s, settings: defaultGlobalSettings(s, store), templates: defaultTemplates(s, store) };
}

/* ───────────────────────── Migration v1 → v2 ───────────────────────── */

export type LegacyStore = DefaultsStoreInfo & { sector?: string | null; themeId?: string | null; themeConfig?: unknown; whatsappNumber?: string | null };

const LEGACY_FONT: Record<string, { heading: FontId; weight: 500 | 600 | 700 }> = {
  sans: { heading: "geist", weight: 600 },
  display: { heading: "outfit", weight: 700 },
  serif: { heading: "fraunces", weight: 600 },
};
const LEGACY_RADIUS = { sharp: { btn: 6, card: 8 }, soft: { btn: 14, card: 16 }, round: { btn: 999, card: 22 } } as const;

/**
 * Construit un document v2 à partir de l'ancien thème (themeId + themeConfig) et des visuels existants :
 * couleurs, police, arrondis, ordre des sections, annonce, FAQ, témoignages saisis et « à propos ».
 */
export function migrateLegacyTheme(store: LegacyStore): ThemeDocument {
  const preset = storefrontPreset(store.sector ?? null, store.themeId ?? "general");
  const sector = preset.sector;
  const legacy = resolveTheme(store.themeId ?? preset.id, store.themeConfig);
  const doc = defaultThemeDocument(sector, store);
  const s = doc.settings;

  s.colors.primary = legacy.primary;
  s.colors.primaryText = readable(legacy.primary);
  s.colors.accent = legacy.accent;
  const f = LEGACY_FONT[legacy.font] ?? LEGACY_FONT.sans;
  s.typography.heading = f.heading;
  s.typography.headingWeight = f.weight;
  s.typography.body = "geist";
  const r = LEGACY_RADIUS[legacy.radius] ?? LEGACY_RADIUS.round;
  s.buttons.radius = r.btn;
  s.cards.radius = r.card;
  if (legacy.announcement?.trim()) s.header.announcement = { enabled: true, text: legacy.announcement.trim().slice(0, 160), scheme: "brand" };

  const home = doc.templates.home;
  const take = (type: SectionType) => Object.values(home.sections).find((x) => x.type === type);
  const banner = store.bannerUrl && /^https:\/\//.test(store.bannerUrl) ? { url: store.bannerUrl, alt: store.name ?? "" } : null;
  const copy = preset.copy;
  const aboutText = legacy.about?.trim() || store.description?.trim() || "";

  const build: Record<LegacySectionId, () => SectionInstance | null> = {
    hero: () => {
      const layout = legacy.heroStyle === "split" ? "split" : legacy.heroStyle === "minimal" ? "below" : "overlay";
      return buildSection("hero", "hero-banner", { image: banner, layout, height: legacy.heroStyle === "banner" ? "large" : "medium", content_position: layout === "below" ? "bottom-center" : "bottom-left", overlay_opacity: layout === "overlay" ? 35 : 0 }, [
        { type: "heading", settings: { text: store.name || "Bienvenue", size: "xl" } },
        ...(store.tagline ? [{ type: "text", settings: { text: store.tagline } }] : []),
        { type: "button", settings: { button_label: copy.browseCta, button_link: "/catalogue", button_style: "solid" } },
      ]);
    },
    categories: () => buildSection("collections", "collection-list", { heading: "Nos catégories", style: "chips" }, []),
    featured: () => buildSection("featured", "featured-collection", { heading: copy.featuredTitle, collection: null, limit: 8, columns: "4", layout: "carousel", show_view_all: true }),
    products: () => buildSection("catalog", "product-grid", { heading: copy.catalogTitle, layout: legacy.layout, columns: legacy.layout === "list" ? "2" : "4", per_page: 24, show_filters: false, show_search: false }),
    about: () => (aboutText ? buildSection("about", "rich-text", { align: "left" }, [{ type: "heading", settings: { text: "Notre histoire", size: "lg" } }, { type: "text", settings: { text: aboutText } }]) : null),
    hours: () => take("opening-hours") ?? buildSection("hours", "opening-hours", {}),
    contact: () => take("contact") ?? buildSection("contact", "contact", {}),
    faq: () => {
      const items = (legacy.faq ?? []).filter((x) => x && typeof x.q === "string" && typeof x.a === "string").slice(0, 20);
      return items.length ? buildSection("faq", "faq", {}, items.map((x) => ({ type: "question", settings: { question: x.q.slice(0, 200), answer: x.a.slice(0, 2000) } }))) : null;
    },
    testimonials: () => {
      const items = (legacy.testimonials ?? []).filter((x) => x && typeof x.name === "string" && typeof x.text === "string").slice(0, 12);
      return items.length ? buildSection("testimonials", "testimonials", { heading: "Ils en parlent", layout: "carousel" }, items.map((x) => ({ type: "testimonial", settings: { quote: x.text.slice(0, 280), author: x.name.slice(0, 60), role: "", avatar: null, rating: 5 } }))) : null;
    },
  };

  const sections: SectionInstance[] = [];
  for (const id of legacy.sections) {
    const sec = build[id]?.();
    if (!sec || sections.some((x) => x.id === sec.id)) continue;
    sections.push(sec);
    // Avis vérifiés juste après le catalogue (comme en v1).
    if (id === "products") sections.push(buildSection("reviews", "reviews", { heading: "Avis de nos clients", layout: "carousel", show_summary: true, show_product: true, limit: 8 }));
  }
  if (store.whatsappNumber) {
    const wa = take("whatsapp-cta");
    if (wa) sections.push(wa);
  }
  doc.templates.home = template(...sections);
  doc.preset = sector;
  return doc;
}

function readable(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#FFFFFF" : "#14201B";
}

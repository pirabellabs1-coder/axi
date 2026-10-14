/**
 * « Réglages du thème » : groupes de champs des réglages globaux, décrits comme les schémas de sections
 * (l'éditeur réutilise le même générateur de formulaires). `id` = chemin dans `ThemeDocument.settings`.
 */
import { FONT_OPTIONS } from "./editor-defaults";
import type { SettingField } from "./types";

export type GlobalField =
  | (SettingField & {
      /** Valeurs numériques pour un select/segmented (ex. graisse 500/600/700). */
      numeric?: boolean;
      /** Champ couleur : chemin de la couleur de fond pour afficher le contraste. */
      contrastWith?: string;
      /** Image sans texte alternatif (favicon). */
      noAlt?: boolean;
    })
  | { type: "schemes"; id: string; label: string }
  | { type: "menus"; id: string; label: string; max: number };

export type GlobalGroup = { id: string; label: string; description: string; fields: GlobalField[] };

const yesNo = (id: string, label: string, info?: string): GlobalField => ({ type: "checkbox", id, label, info });

export const GLOBAL_GROUPS: GlobalGroup[] = [
  {
    id: "colors",
    label: "Couleurs",
    description: "Palette de la boutique et schémas réutilisables par section.",
    fields: [
      { type: "color", id: "colors.background", label: "Fond" },
      { type: "color", id: "colors.surface", label: "Surface (cartes, encadrés)" },
      { type: "color", id: "colors.text", label: "Texte", contrastWith: "colors.background" },
      { type: "color", id: "colors.muted", label: "Texte secondaire", contrastWith: "colors.background" },
      { type: "color", id: "colors.primary", label: "Boutons principaux", contrastWith: "colors.background" },
      { type: "color", id: "colors.primaryText", label: "Texte des boutons", contrastWith: "colors.primary" },
      { type: "color", id: "colors.accent", label: "Accent (badges, promotions)" },
      { type: "color", id: "colors.border", label: "Bordures" },
      { type: "header", content: "Schémas de couleurs" },
      { type: "schemes", id: "colors.schemes", label: "Schémas" },
    ],
  },
  {
    id: "typography",
    label: "Typographie",
    description: "Polices, tailles et réglages fins des titres et du texte.",
    fields: [
      { type: "header", content: "Titres" },
      { type: "font", id: "typography.heading", label: "Police des titres" },
      { type: "segmented", id: "typography.headingWeight", label: "Graisse des titres", numeric: true, options: [{ value: "500", label: "Normale" }, { value: "600", label: "Demi-gras" }, { value: "700", label: "Gras" }, { value: "800", label: "Très gras" }] },
      { type: "paragraph", content: "La taille des titres pilote l'échelle générale de la boutique." },
      { type: "range", id: "typography.scale", label: "Taille des titres", min: 0.85, max: 1.3, step: 0.05, default: 1, unit: "×" },
      { type: "range", id: "typography.headingTracking", label: "Interlettrage des titres", min: -0.05, max: 0.1, step: 0.01, default: 0, unit: "em" },
      { type: "segmented", id: "typography.headingTransform", label: "Casse des titres", options: [{ value: "none", label: "Normale" }, { value: "uppercase", label: "MAJUSCULES" }, { value: "small-caps", label: "Petites capitales" }] },
      { type: "segmented", id: "typography.headingLineHeight", label: "Interligne des titres", options: [{ value: "tight", label: "Serré" }, { value: "normal", label: "Normal" }] },
      { type: "header", content: "Texte courant" },
      { type: "font", id: "typography.body", label: "Police du texte" },
      { type: "range", id: "typography.bodyScale", label: "Taille du texte", min: 0.9, max: 1.2, step: 0.05, default: 1, unit: "×" },
      { type: "segmented", id: "typography.bodyLeading", label: "Interligne du texte", options: [{ value: "tight", label: "Serré" }, { value: "normal", label: "Normal" }, { value: "relaxed", label: "Aéré" }] },
      { type: "header", content: "Boutons" },
      yesNo("typography.uppercaseButtons", "Boutons en majuscules"),
    ],
  },
  {
    id: "buttons",
    label: "Boutons",
    description: "Forme et style des boutons d'action.",
    fields: [
      { type: "segmented", id: "buttons.radius", label: "Forme", numeric: true, options: [{ value: "0", label: "Carrée" }, { value: "10", label: "Arrondie" }, { value: "999", label: "Pilule" }] },
      { type: "segmented", id: "buttons.style", label: "Style", options: [{ value: "solid", label: "Plein" }, { value: "outline", label: "Contour" }, { value: "soft", label: "Doux" }] },
      { type: "segmented", id: "buttons.size", label: "Taille", options: [{ value: "compact", label: "Compacte" }, { value: "normal", label: "Normale" }, { value: "large", label: "Grande" }] },
      { type: "paragraph", content: "L'épaisseur du contour s'applique aux boutons « Contour » et aux boutons secondaires." },
      { type: "range", id: "buttons.borderWidth", label: "Épaisseur du contour", min: 0, max: 3, step: 1, default: 1, unit: "px" },
      yesNo("buttons.shadow", "Ombre portée"),
    ],
  },
  {
    id: "cards",
    label: "Cartes produit",
    description: "Présentation des produits dans les grilles.",
    fields: [
      { type: "segmented", id: "cards.style", label: "Présentation", options: [{ value: "standard", label: "Standard" }, { value: "overlay", label: "Superposition" }] },
      { type: "select", id: "cards.imageRatio", label: "Format des photos", options: [{ value: "portrait", label: "Portrait (4:5)" }, { value: "square", label: "Carré" }, { value: "landscape", label: "Paysage" }, { value: "natural", label: "Format d'origine" }] },
      { type: "range", id: "cards.radius", label: "Arrondi", min: 0, max: 40, step: 2, default: 10, unit: "px" },
      yesNo("cards.showSecondImage", "Deuxième photo au survol"),
      yesNo("cards.quickAdd", "Ajout rapide au panier"),
      yesNo("cards.showVendor", "Afficher la marque"),
      yesNo("cards.border", "Bordure autour des cartes"),
      yesNo("cards.showFavorite", "Cœur « favori » (cartes et fiche produit)", "Visible si les comptes clients sont activés. Non connecté, le visiteur est invité à se connecter."),
      { type: "header", content: "Badges" },
      { type: "select", id: "cards.saleBadge", label: "Badge promo", options: [{ value: "percent", label: "Pourcentage (-20 %)" }, { value: "text", label: "Texte (Promo)" }, { value: "hidden", label: "Masqué" }] },
      yesNo("cards.showNewBadge", "Badge « Nouveau »", "Affiché sur les produits ajoutés depuis moins de 30 jours."),
    ],
  },
  {
    id: "layout",
    label: "Mise en page",
    description: "Largeur du contenu et espacements.",
    fields: [
      { type: "range", id: "layout.pageWidth", label: "Largeur maximale", min: 1100, max: 1600, step: 20, default: 1280, unit: "px" },
      { type: "range", id: "layout.sectionSpacing", label: "Espace entre les sections", min: 0, max: 160, step: 8, default: 48, unit: "px" },
      { type: "range", id: "layout.gutter", label: "Marges latérales", min: 8, max: 48, step: 4, default: 16, unit: "px" },
    ],
  },
  {
    id: "header",
    label: "En-tête",
    description: "Logo, menu, recherche et bandeau d'annonce.",
    fields: [
      { type: "image", id: "header.logo", label: "Logo" },
      { type: "range", id: "header.logoWidth", label: "Largeur du logo", min: 40, max: 300, step: 4, default: 120, unit: "px" },
      { type: "select", id: "header.layout", label: "Disposition", options: [{ value: "logo-left", label: "Logo à gauche" }, { value: "logo-center", label: "Logo centré" }, { value: "minimal", label: "Minimale" }] },
      { type: "menu", id: "header.menu", label: "Menu" },
      yesNo("header.sticky", "En-tête fixe au défilement"),
      yesNo("header.transparentOverHero", "En-tête transparent sur la bannière", "Quand la page commence par une grande bannière (image plein cadre ou fond sombre), l'en-tête se superpose à elle en transparent, puis devient opaque au défilement."),
      yesNo("header.showSearch", "Recherche"),
      yesNo("header.showAccount", "Icône « Compte »", "Lien vers l'espace client (commandes, favoris, avoir). Masquée si les comptes clients sont désactivés."),
      yesNo("header.showCurrencyPicker", "Afficher le sélecteur de devise", "Affiché seulement si la boutique propose au moins deux devises (menu Devises)."),
      { type: "header", content: "Bandeau d'annonce" },
      yesNo("header.announcement.enabled", "Afficher le bandeau"),
      { type: "text", id: "header.announcement.text", label: "Texte de l'annonce", maxLength: 160, placeholder: "Livraison offerte dès 20 000 FCFA" },
      { type: "url", id: "header.announcement.link", label: "Lien de l'annonce" },
      { type: "select", id: "header.announcement.scheme", label: "Couleurs du bandeau", options: [{ value: "brand", label: "Couleur de marque" }, { value: "inverse", label: "Inversé" }, { value: "default", label: "Par défaut" }] },
    ],
  },
  {
    id: "footer",
    label: "Pied de page",
    description: "Menus, texte et moyens de paiement.",
    fields: [
      { type: "menus", id: "footer.menus", label: "Menus affichés", max: 4 },
      { type: "textarea", id: "footer.text", label: "Texte", maxLength: 500 },
      yesNo("footer.showPaymentIcons", "Logos des moyens de paiement"),
      yesNo("footer.newsletter", "Inscription aux nouveautés"),
      yesNo("footer.showSocial", "Liens vers les réseaux sociaux"),
    ],
  },
  {
    id: "product",
    label: "Fiche produit",
    description: "Réglages par défaut des pages produit.",
    fields: [
      { type: "select", id: "product.gallery", label: "Galerie", options: [{ value: "thumbnails-left", label: "Vignettes à gauche" }, { value: "thumbnails-bottom", label: "Vignettes en dessous" }, { value: "carousel", label: "Carrousel" }, { value: "stacked", label: "Images empilées" }, { value: "grid-2", label: "Grille 2 colonnes" }] },
      { type: "segmented", id: "product.variantPicker", label: "Choix des variantes", options: [{ value: "buttons", label: "Boutons" }, { value: "dropdown", label: "Liste" }, { value: "swatches", label: "Pastilles" }] },
      yesNo("product.stickyAddToCart", "Bouton d'ajout collant (mobile)"),
      yesNo("product.showStock", "Afficher le stock"),
      yesNo("product.showSku", "Afficher la référence (SKU)"),
      yesNo("product.showShareButtons", "Boutons de partage"),
    ],
  },
  {
    id: "cart",
    label: "Panier",
    description: "Type de panier et options.",
    fields: [
      { type: "segmented", id: "cart.type", label: "Type de panier", options: [{ value: "drawer", label: "Tiroir" }, { value: "page", label: "Page" }] },
      yesNo("cart.showNote", "Note de commande"),
      yesNo("cart.freeShippingBar", "Barre « livraison offerte »"),
    ],
  },
  {
    id: "social",
    label: "Réseaux sociaux",
    description: "Liens affichés dans le pied de page.",
    fields: [
      { type: "text", id: "footer.social.instagram", label: "Instagram", placeholder: "https://instagram.com/…", maxLength: 300 },
      { type: "text", id: "footer.social.facebook", label: "Facebook", placeholder: "https://facebook.com/…", maxLength: 300 },
      { type: "text", id: "footer.social.tiktok", label: "TikTok", placeholder: "https://tiktok.com/@…", maxLength: 300 },
      { type: "text", id: "footer.social.youtube", label: "YouTube", placeholder: "https://youtube.com/@…", maxLength: 300 },
      { type: "text", id: "footer.social.whatsapp", label: "Chaîne WhatsApp", placeholder: "https://whatsapp.com/channel/…", maxLength: 300 },
    ],
  },
  {
    id: "favicon",
    label: "Favicon et partage",
    description: "Icône de l'onglet et image des liens partagés.",
    fields: [
      { type: "image", id: "social.favicon", label: "Favicon", noAlt: true, info: "Image carrée, 64 × 64 px minimum." },
      { type: "image", id: "social.shareImage", label: "Image de partage", noAlt: true, info: "Affichée quand un lien de la boutique est partagé (1200 × 630 px)." },
    ],
  },
];

export { FONT_OPTIONS };

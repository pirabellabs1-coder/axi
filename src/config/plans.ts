/**
 * Plans, zones tarifaires, options et crédits Axi — cahier des charges V4 (§5, §6, §7).
 *
 * Deux zones de prix :
 *  - WORLD  : facturation en euros (montants en centimes d'euro)
 *  - AFRICA : facturation en FCFA (montants entiers, sans décimales)
 * La zone est déduite du pays de la boutique (devise XOF / XAF → AFRICA).
 * Paiement annuel : 10 mois payés pour 12 (2 mois offerts).
 * 0 % de commission sur les ventes, sur tous les plans.
 *
 * Plus de plan Gratuit (décision du 18/10/2026) : toute boutique démarre par TRIAL_DAYS jours d'essai
 * TRIAL_PLAN sans carte, puis passe EN PAUSE sans plan payant (src/lib/billing/pause.ts). La valeur
 * `FREE` reste dans PlanId pour la compatibilité des données : c'est le niveau interne « sans plan »
 * (boutique en pause, fonctions de base de l'espace marchand), JAMAIS vendu ni affiché comme une offre.
 */
export type PlanId = "FREE" | "STARTER" | "BUSINESS" | "SCALE" | "ENTERPRISE";
export type PricingZone = "WORLD" | "AFRICA";
export type Interval = "MONTHLY" | "YEARLY";

export const ZONE_CURRENCY: Record<PricingZone, string> = { WORLD: "EUR", AFRICA: "XOF" };
export const ZONE_LABEL: Record<PricingZone, string> = { WORLD: "Monde (EUR)", AFRICA: "Afrique francophone (FCFA)" };

export function zoneForCurrency(currency: string): PricingZone {
  return currency === "XOF" || currency === "XAF" ? "AFRICA" : "WORLD";
}

export type PlanLimits = {
  stores: number | null; // null = illimité
  products: number | null;
  ordersPerMonth: number | null;
  members: number | null;
  photosPerProduct: number;
  deliveryZones: number | null;
  themes: number | null;
  customPages: number | null;
  automations: number | null;
  whatsappMessagesPerMonth: number | null;
  aiCreditsPerMonth: number | null;
  languages: number | null;
  // Lot 2 : international et contenu (0 = non inclus, null = illimité)
  /** Devises d'affichage en plus de la devise de la boutique. */
  currencies: number | null;
  /** Articles de blog (tous statuts confondus). */
  blogPosts: number | null;
  /** Points de webhook sortants. */
  webhookEndpoints: number | null;
  // Lot 4 : personnalisation
  /** Définitions de champs personnalisés (metafields), tous propriétaires confondus. */
  metafieldDefinitions: number | null;
  /** Modèles alternatifs par type (produit, collection, page, article) ; plafond technique : 20 par document. */
  alternateTemplatesPerType: number | null;
  /** Sections enregistrées. */
  savedSections: number | null;
  /** Thèmes programmés à venir ou en cours (SCHEDULED, ACTIVE). */
  scheduledThemes: number | null;
  /** Tests A/B simultanés (RUNNING). */
  concurrentExperiments: number | null;
  /** Notifications push marketing par mois (le transactionnel n'est pas décompté). */
  pushPerMonth: number | null;
  // Lot 3 : opérations
  /** Dépôts (dont le dépôt principal) : 1 en Gratuit et Starter, illimité en Enterprise. */
  locations: number | null;
  /** Appareils de caisse enregistrés (0 = caisse non incluse). */
  posDevices: number | null;
};

export type PlanFeatures = {
  // Boutique et design
  removeBranding: boolean;
  customDomain: boolean;
  advancedEditor: boolean;
  // Catalogue
  variants: boolean;
  options: boolean;
  stockTracking: boolean;
  csvImport: boolean;
  csvExport: boolean;
  /** Produits numériques (fichiers téléchargeables) et services : inclus dans tous les plans, bornés par le quota de stockage. */
  digitalProducts: boolean;
  // Commandes
  orderExport: boolean;
  scheduledOrders: boolean;
  refunds: boolean;
  // Paiements
  onlinePayments: boolean;
  reconciliation: boolean;
  // Livraison
  pickupSlots: boolean;
  couriers: boolean;
  carriers: boolean;
  // WhatsApp et canaux
  whatsappApi: boolean;
  inbox: boolean;
  pipeline: boolean;
  campaigns: boolean;
  socialInbox: boolean;
  chatbot: boolean;
  // Clients et marketing
  crm: boolean;
  coupons: boolean;
  segments: boolean;
  loyalty: boolean;
  reviews: boolean;
  automations: boolean;
  abandonedCart: boolean;
  // Ventes et fidélité (lot 1)
  /** Comptes acheteurs : connexion par code, historique, adresses, favoris, réachat. */
  customerAccounts: boolean;
  /** Remises automatiques PRODUCT_AMOUNT et CART_TIER. */
  automaticDiscounts: boolean;
  /** Remises automatiques BUY_X_GET_Y et BUNDLE. */
  advancedDiscounts: boolean;
  /** Offres au panier (ventes croisées, montées en gamme). */
  cartOffers: boolean;
  /** Cartes cadeaux (vente et émission). Les cartes émises restent utilisables après une baisse de plan. */
  giftCards: boolean;
  /** Avoirs clients (geste commercial, remboursement en avoir). */
  storeCredit: boolean;
  /** Retours et échanges en libre-service côté acheteur. */
  returnsPortal: boolean;
  // International et contenu (lot 2)
  /** Affichage multi-devises (nombre : limits.currencies). */
  multiCurrency: boolean;
  /** TVA par pays, prix TTC / HT. */
  taxes: boolean;
  /** Factures et avoirs fiscaux numérotés. */
  invoices: boolean;
  /** Blog de la boutique (nombre d'articles : limits.blogPosts). */
  blog: boolean;
  /** Webhooks sortants signés (nombre : limits.webhookEndpoints). */
  webhooks: boolean;
  /** API REST /api/v1 (niveau : REST_API_ACCESS). */
  restApi: boolean;
  /** Traduction des contenus par l'IA (crédits IA). */
  aiTranslation: boolean;
  // Personnalisation (lot 4)
  /** Boutique générée par l'IA (crédits IA ; AI_STORE_BUILDER_FREE_GENERATIONS offerte une seule fois). */
  aiStoreBuilder: boolean;
  /** Assistant de design conversationnel. */
  designAssistant: boolean;
  /** Édition directe dans l'aperçu. */
  inlineEditing: boolean;
  /** Champs personnalisés (nombre : limits.metafieldDefinitions). */
  metafields: boolean;
  /** Modèles alternatifs (nombre par type : limits.alternateTemplatesPerType). */
  alternateTemplates: boolean;
  /** Sections enregistrées (nombre : limits.savedSections). */
  savedSections: boolean;
  /** Sections premium de la bibliothèque (contrôle `minPlan` côté serveur à l'insertion). */
  premiumSections: boolean;
  /** Thèmes programmés (nombre : limits.scheduledThemes). */
  scheduledThemes: boolean;
  /** Personnalisation par audience (règles permises : AUDIENCE_RULES_BY_PLAN). */
  audiencePersonalization: boolean;
  /** Tests A/B de sections (nombre : limits.concurrentExperiments). */
  abTests: boolean;
  /** Scores qualité en direct dans l'éditeur. */
  qualityScores: boolean;
  /** Préréglages d'animation. */
  motionPresets: boolean;
  /** Boutique installable (PWA) et mode économie de données. */
  pwa: boolean;
  /** Notifications push (volume : limits.pushPerMonth). */
  webPush: boolean;
  /** Flux catalogues publics (Meta, Google, TikTok). */
  catalogFeeds: boolean;
  /** Synchronisation par API du catalogue WhatsApp Business / Meta Commerce (lot 1 bis ; exige l'intégration WhatsApp Cloud). */
  catalogSync: boolean;
  /** Vidéos et stories achetables. */
  shoppableMedia: boolean;
  /** Live shopping. */
  liveShopping: boolean;
  // Opérations (lot 3) ; les étiquettes internes et la page livreur suivent `couriers`,
  // l'API transporteurs `carriers`, la caisse `pos` (limites : locations, posDevices).
  /** Transferts de stock entre dépôts (exige au moins 2 dépôts). */
  stockTransfers: boolean;
  // Analyses et IA
  advancedAnalytics: boolean;
  pixels: boolean;
  aiAssistant: boolean;
  aiSummary: boolean;
  // Équipe et entreprise
  customRoles: boolean;
  auditLog: boolean;
  api: boolean;
  pos: boolean;
  resellers: boolean;
  // Support
  prioritySupport: boolean;
  sla: boolean;
};

export type Plan = {
  id: PlanId;
  name: string;
  audience: string;
  tagline: string;
  /** Prix mensuel par zone (EUR en centimes, XOF entier). null = sur devis. */
  price: Record<PricingZone, number | null>;
  /** Enterprise : prix « à partir de ». */
  fromPrice?: boolean;
  highlight?: boolean;
  /** false = jamais proposé à la vente (niveau interne FREE). Absent = vendable. */
  sellable?: boolean;
  support: string;
  limits: PlanLimits;
  features: PlanFeatures;
  bullets: string[];
};

export const TRIAL_DAYS = 14;
export const TRIAL_PLAN: PlanId = "BUSINESS";
export const YEARLY_MONTHS_PAID = 10; // 2 mois offerts
export const PAST_DUE_GRACE_DAYS = 7;
export const RENEWAL_LINK_DAYS_BEFORE = 3;

const NONE: PlanFeatures = {
  removeBranding: false, customDomain: false, advancedEditor: false,
  // Vague 2 : produits numériques et services inclus DÈS LE PLAN GRATUIT (décision du 11/10/2026) : l'entrée de
  // gamme n'est pas bridée et la taille totale est déjà bornée par le quota de stockage du plan (100 Mo en Gratuit,
  // voir src/lib/storage/quota.ts). Un fichier vendu et une photo consomment le même compteur « media_kb ».
  variants: true, options: false, stockTracking: false, csvImport: false, csvExport: false, digitalProducts: true,
  orderExport: false, scheduledOrders: false, refunds: false,
  onlinePayments: false, reconciliation: false,
  pickupSlots: false, couriers: false, carriers: false,
  whatsappApi: false, inbox: false, pipeline: false, campaigns: false, socialInbox: false, chatbot: false,
  crm: false, coupons: false, segments: false, loyalty: false, reviews: false, automations: false, abandonedCart: false,
  customerAccounts: true, automaticDiscounts: false, advancedDiscounts: false, cartOffers: false, giftCards: false, storeCredit: false, returnsPortal: false,
  multiCurrency: false, taxes: false, invoices: false, blog: false, webhooks: false, restApi: false, aiTranslation: false,
  // Lot 4 : génération IA ouverte à tous (1 offerte, puis crédits) ; édition en place, scores et animations pour tous.
  aiStoreBuilder: true, designAssistant: false, inlineEditing: true, metafields: false, alternateTemplates: false, savedSections: false,
  premiumSections: false, scheduledThemes: false, audiencePersonalization: false, abTests: false, qualityScores: true, motionPresets: true,
  pwa: false, webPush: false, catalogFeeds: false, catalogSync: false, shoppableMedia: false, liveShopping: false,
  stockTransfers: false,
  advancedAnalytics: false, pixels: false, aiAssistant: false, aiSummary: false,
  customRoles: false, auditLog: false, api: false, pos: false, resellers: false,
  prioritySupport: false, sla: false,
};

const STARTER_F: PlanFeatures = {
  ...NONE,
  removeBranding: true, options: true, stockTracking: true, orderExport: true, scheduledOrders: true,
  onlinePayments: true, pickupSlots: true, crm: true, coupons: true, automaticDiscounts: true,
  multiCurrency: true, taxes: true, invoices: true, blog: true,
  metafields: true, savedSections: true, pwa: true,
};

const BUSINESS_F: PlanFeatures = {
  ...STARTER_F,
  customDomain: true, advancedEditor: true, csvImport: true, csvExport: true, refunds: true,
  reconciliation: true, couriers: true, whatsappApi: true, inbox: true, pipeline: true, campaigns: true, socialInbox: true,
  segments: true, loyalty: true, reviews: true, automations: true, advancedAnalytics: true, pixels: true, aiAssistant: true,
  prioritySupport: true,
  advancedDiscounts: true, cartOffers: true, giftCards: true, storeCredit: true, returnsPortal: true,
  webhooks: true, restApi: true, aiTranslation: true,
  designAssistant: true, alternateTemplates: true, premiumSections: true, scheduledThemes: true, audiencePersonalization: true,
  webPush: true, catalogFeeds: true, catalogSync: true, shoppableMedia: true,
  stockTransfers: true,
};

const SCALE_F: PlanFeatures = {
  ...BUSINESS_F,
  carriers: true, chatbot: true, abandonedCart: true, aiSummary: true, customRoles: true, auditLog: true, api: true, pos: true,
  abTests: true, liveShopping: true,
};

const ENTERPRISE_F: PlanFeatures = { ...SCALE_F, resellers: true, sla: true };

export const PLANS: Record<PlanId, Plan> = {
  // Niveau interne « sans plan » (boutique en pause) : non vendable, absent de PUBLIC_PLANS et SELF_SERVE_PLANS.
  FREE: {
    id: "FREE",
    name: "Sans plan",
    audience: "Boutique en pause",
    tagline: "Aucun plan actif : choisissez un plan pour rouvrir votre boutique.",
    price: { WORLD: 0, AFRICA: 0 },
    support: "Centre d'aide",
    sellable: false,
    // Lot 1 bis (analyse concurrentielle §8.1) : 100 produits et 50 commandes par mois (niveau de Take App Basic),
    // en restant sous le Starter (200 produits) pour garder une montée en gamme lisible.
    limits: {
      stores: 1, products: 100, ordersPerMonth: 50, members: 1, photosPerProduct: 1, deliveryZones: 1, themes: 2, customPages: 0, automations: 0, whatsappMessagesPerMonth: 0, aiCreditsPerMonth: 0, languages: 1,
      currencies: 0, blogPosts: 0, webhookEndpoints: 0,
      metafieldDefinitions: 0, alternateTemplatesPerType: 0, savedSections: 0, scheduledThemes: 0, concurrentExperiments: 0, pushPerMonth: 0,
      locations: 1, posDevices: 0,
    },
    features: NONE,
    bullets: ["Boutique en pause : vitrine fermée", "Données conservées", "Choisissez un plan pour rouvrir"],
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    audience: "Vendeur seul",
    tagline: "Tout pour vendre seul, sans limite de commandes.",
    price: { WORLD: 900, AFRICA: 5000 },
    support: "E-mail",
    limits: {
      stores: 1, products: 200, ordersPerMonth: null, members: 1, photosPerProduct: 5, deliveryZones: null, themes: null, customPages: 3, automations: 0, whatsappMessagesPerMonth: 0, aiCreditsPerMonth: 0, languages: 1,
      currencies: 1, blogPosts: 20, webhookEndpoints: 0,
      metafieldDefinitions: 10, alternateTemplatesPerType: 0, savedSections: 20, scheduledThemes: 0, concurrentExperiments: 0, pushPerMonth: 0,
      locations: 1, posDevices: 0,
    },
    features: STARTER_F,
    bullets: ["Commandes illimitées, 200 produits", "Mobile Money et carte sur votre compte", "Stock, options et suppléments", "Coupons, créneaux et commandes planifiées", "Sans logo Axi, tous les thèmes"],
  },
  BUSINESS: {
    id: "BUSINESS",
    name: "Business",
    audience: "Boutique qui grandit",
    tagline: "Le plan complet pour vendre en équipe sur WhatsApp.",
    price: { WORLD: 2900, AFRICA: 15000 },
    highlight: true,
    support: "Chat prioritaire",
    limits: {
      stores: 1, products: null, ordersPerMonth: null, members: 3, photosPerProduct: 10, deliveryZones: null, themes: null, customPages: null, automations: 3, whatsappMessagesPerMonth: 300, aiCreditsPerMonth: 50, languages: 2,
      currencies: 3, blogPosts: null, webhookEndpoints: 2,
      metafieldDefinitions: 100, alternateTemplatesPerType: 5, savedSections: null, scheduledThemes: 3, concurrentExperiments: 0, pushPerMonth: 2_000,
      locations: 2, posDevices: 1,
    },
    features: BUSINESS_F,
    bullets: ["Produits illimités, 3 membres", "Domaine personnalisé", "WhatsApp officiel, boîte partagée, 300 messages", "CRM, segments, fidélité et avis", "Entonnoir de vente et campagnes", "Rapports avancés, Pixel Meta"],
  },
  SCALE: {
    id: "SCALE",
    name: "Scale",
    audience: "Marque multicanal",
    tagline: "Automatisez et pilotez plusieurs boutiques.",
    price: { WORLD: 7900, AFRICA: 45000 },
    support: "Chat et appel",
    limits: {
      stores: 3, products: null, ordersPerMonth: null, members: 10, photosPerProduct: 10, deliveryZones: null, themes: null, customPages: null, automations: null, whatsappMessagesPerMonth: 1500, aiCreditsPerMonth: 500, languages: 5,
      currencies: 10, blogPosts: null, webhookEndpoints: 10,
      metafieldDefinitions: null, alternateTemplatesPerType: 20, savedSections: null, scheduledThemes: null, concurrentExperiments: 3, pushPerMonth: 20_000,
      locations: 10, posDevices: 5,
    },
    features: SCALE_F,
    bullets: ["3 boutiques, 10 membres", "Automatisations illimitées", "Relance des paniers abandonnés", "1 500 messages et 500 crédits IA", "Rôles personnalisés, journal d'audit", "API, webhooks et caisse"],
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    audience: "Agences et franchises",
    tagline: "Réseaux de boutiques, revendeurs et engagement de service.",
    price: { WORLD: 19900, AFRICA: 130000 },
    fromPrice: true,
    support: "Gestionnaire dédié et SLA",
    limits: {
      stores: null, products: null, ordersPerMonth: null, members: null, photosPerProduct: 10, deliveryZones: null, themes: null, customPages: null, automations: null, whatsappMessagesPerMonth: null, aiCreditsPerMonth: null, languages: null,
      currencies: null, blogPosts: null, webhookEndpoints: null,
      // Push « sur mesure » : illimité côté produit, plafonné par contrat.
      metafieldDefinitions: null, alternateTemplatesPerType: 20, savedSections: null, scheduledThemes: null, concurrentExperiments: 10, pushPerMonth: null,
      locations: null, posDevices: null,
    },
    features: ENTERPRISE_F,
    bullets: ["Boutiques et membres illimités", "Revendeurs et marque blanche", "Engagement de service (SLA)", "Messages et crédits IA sur mesure", "Gestionnaire de compte dédié"],
  },
};

/** Ordre de rang INTERNE (comparaisons de niveau) : FREE = « sans plan », toujours le plus bas. */
export const PLAN_ORDER: PlanId[] = ["FREE", "STARTER", "BUSINESS", "SCALE", "ENTERPRISE"];

/** Plans proposés (site public, comparatif, choix de plan) : le niveau interne FREE n'en fait jamais partie. */
export const PUBLIC_PLANS: PlanId[] = PLAN_ORDER.filter((p) => PLANS[p].sellable !== false);

/** Le plan peut-il être souscrit (contrôle serveur, pas seulement UI) ? */
export function isSellablePlan(id: string): id is PlanId {
  return (PUBLIC_PLANS as string[]).includes(id);
}

/* ───────────────────────── Niveaux (lots 2 et 4) ───────────────────────── */

/** API REST /api/v1 (lot 2 §7) : aucune, lecture seule (GET), complète. Combinée aux scopes du jeton et au rôle. */
export type RestApiAccess = "none" | "read" | "full";
export const REST_API_ACCESS: Record<PlanId, RestApiAccess> = { FREE: "none", STARTER: "none", BUSINESS: "read", SCALE: "full", ENTERPRISE: "full" };

/** Règles d'audience utilisables par plan (lot 4 §12) : Business = règle « client » seulement ; Scale et plus = toutes. */
export type AudienceRuleType = "city" | "customer" | "source" | "locale" | "schedule" | "device";
const ALL_AUDIENCE_RULES: AudienceRuleType[] = ["city", "customer", "source", "locale", "schedule", "device"];
export const AUDIENCE_RULES_BY_PLAN: Record<PlanId, AudienceRuleType[]> = { FREE: [], STARTER: [], BUSINESS: ["customer"], SCALE: ALL_AUDIENCE_RULES, ENTERPRISE: ALL_AUDIENCE_RULES };

/** Générations de boutique par l'IA offertes une seule fois par boutique (lot 4 §9), avant tout débit de crédits. */
export const AI_STORE_BUILDER_FREE_GENERATIONS = 1;
/** Plans vendus en libre-service (Enterprise passe par un devis). */
export const SELF_SERVE_PLANS: PlanId[] = ["STARTER", "BUSINESS", "SCALE"];

export function getPlan(id: PlanId): Plan {
  return PLANS[id] ?? PLANS.FREE;
}

export function planRank(id: PlanId): number {
  return PLAN_ORDER.indexOf(id);
}

/** Prix d'un plan pour une zone et une période. */
export function planPrice(id: PlanId, zone: PricingZone, interval: Interval = "MONTHLY"): { amount: number | null; currency: string; perMonth: number | null } {
  const monthly = PLANS[id].price[zone];
  const currency = ZONE_CURRENCY[zone];
  if (monthly == null) return { amount: null, currency, perMonth: null };
  if (interval === "YEARLY") {
    const amount = monthly * YEARLY_MONTHS_PAID;
    return { amount, currency, perMonth: Math.round(amount / 12) };
  }
  return { amount: monthly, currency, perMonth: monthly };
}

/* ───────────────────────── Connecteur IA (MCP, jetons API, OAuth) ───────────────────────── */

/**
 * Accès des assistants IA (Claude, ChatGPT, Cursor…) au serveur MCP marchand `/api/mcp`.
 *  - scopes : "read" (lecture seule) | "standard" (+ catalogue, stock, commandes) | "all" (tout, dont promotions)
 *  - maxTokens : jetons API actifs simultanés (null = illimité)
 *  - oauth : connexion « en un clic » depuis Claude.ai / ChatGPT (OAuth 2.1)
 *  - callsPerMinute / callsPerDay : quotas d'appels par boutique (null = sans plafond journalier)
 * Le MCP vitrine public (`/api/mcp/store/{slug}`) est inclus dans tous les plans (limité par IP).
 * Détail des scopes : src/lib/mcp/scopes.ts.
 */
export type McpPlanLimits = {
  scopes: "read" | "standard" | "all";
  maxTokens: number | null;
  oauth: boolean;
  callsPerMinute: number;
  callsPerDay: number | null;
};

export const MCP_LIMITS: Record<PlanId, McpPlanLimits> = {
  FREE: { scopes: "read", maxTokens: 1, oauth: false, callsPerMinute: 20, callsPerDay: 300 },
  STARTER: { scopes: "standard", maxTokens: 3, oauth: false, callsPerMinute: 60, callsPerDay: 3_000 },
  BUSINESS: { scopes: "all", maxTokens: 10, oauth: true, callsPerMinute: 120, callsPerDay: 20_000 },
  SCALE: { scopes: "all", maxTokens: null, oauth: true, callsPerMinute: 300, callsPerDay: 100_000 },
  ENTERPRISE: { scopes: "all", maxTokens: null, oauth: true, callsPerMinute: 600, callsPerDay: null },
};

export const MCP_TIER_LABEL: Record<PlanId, string> = {
  FREE: "Lecture seule, 1 jeton",
  STARTER: "Lecture et écriture, 3 jetons",
  BUSINESS: "Complet, OAuth, 10 jetons",
  SCALE: "Complet, jetons illimités",
  ENTERPRISE: "Complet, quotas sur mesure",
};

/* ───────────────────────── Options payantes (§7) ───────────────────────── */

export type AddOnId =
  | "EXTRA_MEMBER"
  | "EXTRA_WHATSAPP_NUMBER"
  | "EXTRA_STORE"
  | "PACK_WA_UTILITY_500"
  | "PACK_WA_MARKETING_200"
  | "PACK_AI_1000"
  | "STORAGE_10GB"
  | "DOMAIN_NAME"
  | "SECTOR_TEMPLATE"
  | "DONE_FOR_YOU";

export type AddOnBilling = "MONTHLY" | "YEARLY" | "ONE_TIME" | "PACK";

export type AddOn = {
  id: AddOnId;
  name: string;
  description: string;
  price: Record<PricingZone, number>;
  billing: AddOnBilling;
  plans: PlanId[];
  /** Crédits ajoutés au portefeuille (packs). */
  credits?: { type: CreditType; amount: number };
};

export type CreditType = "WA_UTILITY" | "WA_MARKETING" | "AI";

export const CREDIT_LABELS: Record<CreditType, string> = {
  WA_UTILITY: "Messages WhatsApp utilitaires",
  WA_MARKETING: "Messages WhatsApp marketing",
  AI: "Crédits IA",
};

const PAID: PlanId[] = ["STARTER", "BUSINESS", "SCALE", "ENTERPRISE"];
// Plus d'option pour une boutique sans plan (en pause) : elle choisit d'abord un plan.
const ALL: PlanId[] = PAID;

export const ADD_ONS: AddOn[] = [
  { id: "EXTRA_MEMBER", name: "Membre d'équipe en plus", description: "Ajoutez un employé au-delà de la limite de votre plan.", price: { WORLD: 500, AFRICA: 2000 }, billing: "MONTHLY", plans: ["BUSINESS", "SCALE"] },
  { id: "EXTRA_WHATSAPP_NUMBER", name: "Numéro WhatsApp en plus", description: "Gérez un deuxième numéro : autre boutique ou service client.", price: { WORLD: 1200, AFRICA: 6000 }, billing: "MONTHLY", plans: ["BUSINESS", "SCALE"] },
  { id: "EXTRA_STORE", name: "Boutique en plus", description: "Ouvrez une autre boutique sur le même compte.", price: { WORLD: 900, AFRICA: 4000 }, billing: "MONTHLY", plans: ["BUSINESS", "SCALE"] },
  { id: "PACK_WA_UTILITY_500", name: "500 messages WhatsApp utilitaires", description: "Confirmations, suivi de livraison, reçus. Valable 12 mois.", price: { WORLD: 900, AFRICA: 5000 }, billing: "PACK", plans: ["BUSINESS", "SCALE", "ENTERPRISE"], credits: { type: "WA_UTILITY", amount: 500 } },
  { id: "PACK_WA_MARKETING_200", name: "200 messages WhatsApp marketing", description: "Promotions et relances aux clients consentants. Valable 12 mois.", price: { WORLD: 1500, AFRICA: 8000 }, billing: "PACK", plans: ["BUSINESS", "SCALE", "ENTERPRISE"], credits: { type: "WA_MARKETING", amount: 200 } },
  { id: "PACK_AI_1000", name: "1 000 crédits IA", description: "Descriptions, traductions, génération de boutique, suggestions de réponses. Valable 12 mois.", price: { WORLD: 900, AFRICA: 5000 }, billing: "PACK", plans: ["STARTER", "BUSINESS", "SCALE"], credits: { type: "AI", amount: 1000 } },
  { id: "STORAGE_10GB", name: "Stockage +10 Go", description: "Plus de photos et de fichiers pour votre catalogue.", price: { WORLD: 400, AFRICA: 2000 }, billing: "MONTHLY", plans: PAID },
  { id: "DOMAIN_NAME", name: "Nom de domaine", description: "Achat et renouvellement de votre domaine via Axi.", price: { WORLD: 1500, AFRICA: 9000 }, billing: "YEARLY", plans: ["BUSINESS", "SCALE", "ENTERPRISE"] },
  { id: "SECTOR_TEMPLATE", name: "Modèle de boutique par secteur", description: "Restaurant, mode, beauté, salon, clinique, pâtisserie : prêt à vendre.", price: { WORLD: 2900, AFRICA: 15000 }, billing: "ONE_TIME", plans: ALL },
  { id: "DONE_FOR_YOU", name: "Création de boutique clé en main", description: "Notre équipe crée votre boutique et ajoute vos produits.", price: { WORLD: 9900, AFRICA: 50000 }, billing: "ONE_TIME", plans: ALL },
];

export const ADD_ON_BILLING_LABEL: Record<AddOnBilling, string> = {
  MONTHLY: "par mois",
  YEARLY: "par an",
  ONE_TIME: "une fois",
  PACK: "par pack",
};

export function getAddOn(id: string): AddOn | null {
  return ADD_ONS.find((a) => a.id === id) ?? null;
}

/* ───────────────────────── Comparatif (page tarifs) ───────────────────────── */

type Cell = boolean | string;
export type ComparisonRow = { label: string; values: Record<PlanId, Cell> };
export type ComparisonGroup = { title: string; rows: ComparisonRow[] };

const f = (key: keyof PlanFeatures): Record<PlanId, Cell> =>
  Object.fromEntries(PLAN_ORDER.map((p) => [p, PLANS[p].features[key]])) as Record<PlanId, Cell>;
const lim = (key: keyof PlanLimits, unit = ""): Record<PlanId, Cell> =>
  Object.fromEntries(
    PLAN_ORDER.map((p) => {
      const v = PLANS[p].limits[key];
      return [p, v == null ? "Illimité" : v === 0 ? false : `${v.toLocaleString("fr-FR")}${unit}`];
    }),
  ) as Record<PlanId, Cell>;

const byPlan = (fn: (p: PlanId) => Cell): Record<PlanId, Cell> => Object.fromEntries(PLAN_ORDER.map((p) => [p, fn(p)])) as Record<PlanId, Cell>;

export const COMPARISON: ComparisonGroup[] = [
  {
    title: "Boutique et design",
    rows: [
      { label: "Boutique en ligne (sous-domaine)", values: { FREE: true, STARTER: true, BUSINESS: true, SCALE: true, ENTERPRISE: true } },
      { label: "Thèmes prêts à l'emploi", values: { FREE: "2", STARTER: "Tous", BUSINESS: "Tous", SCALE: "Tous", ENTERPRISE: "Tous" } },
      { label: "Retrait du logo Axi", values: f("removeBranding") },
      { label: "Pages personnalisées", values: lim("customPages") },
      { label: "Domaine personnalisé", values: f("customDomain") },
      { label: "Éditeur avancé et versions", values: f("advancedEditor") },
    ],
  },
  {
    title: "Personnalisation",
    rows: [
      { label: "Boutique générée par l'IA", values: { FREE: "1 offerte", STARTER: "Crédits IA (packs)", BUSINESS: "50 crédits / mois", SCALE: "500 crédits / mois", ENTERPRISE: "Sur mesure" } },
      { label: "Édition dans l'aperçu, scores qualité, animations", values: f("inlineEditing") },
      { label: "Assistant de design", values: f("designAssistant") },
      { label: "Champs personnalisés", values: lim("metafieldDefinitions") },
      { label: "Modèles alternatifs (par type de page)", values: lim("alternateTemplatesPerType") },
      { label: "Sections enregistrées", values: lim("savedSections") },
      { label: "Sections premium", values: f("premiumSections") },
      { label: "Thèmes programmés (fêtes, soldes)", values: lim("scheduledThemes") },
      { label: "Contenus par audience", values: byPlan((p) => (AUDIENCE_RULES_BY_PLAN[p].length === 0 ? false : AUDIENCE_RULES_BY_PLAN[p].length === 1 ? "Nouveaux / fidèles" : "Complet")) },
      { label: "Tests A/B simultanés", values: lim("concurrentExperiments") },
      { label: "Boutique installable (PWA)", values: f("pwa") },
      { label: "Notifications push par mois", values: { ...lim("pushPerMonth"), ENTERPRISE: "Sur mesure" } },
      { label: "Vidéos et stories achetables", values: f("shoppableMedia") },
      { label: "Live shopping", values: f("liveShopping") },
    ],
  },
  {
    title: "Catalogue et commandes",
    rows: [
      { label: "Produits", values: lim("products") },
      { label: "Photos par produit", values: lim("photosPerProduct") },
      { label: "Commandes par mois", values: lim("ordersPerMonth") },
      { label: "Options et suppléments", values: f("options") },
      { label: "Stock et alertes", values: f("stockTracking") },
      // Vague 2 : inclus partout, la limite réelle est l'espace de stockage du plan.
      { label: "Produits numériques et services", values: f("digitalProducts") },
      { label: "Import et export CSV", values: f("csvImport") },
      { label: "Commandes planifiées", values: f("scheduledOrders") },
      { label: "Retours et remboursements partiels", values: f("refunds") },
    ],
  },
  {
    title: "Paiements et livraison",
    rows: [
      { label: "Commission sur les ventes", values: { FREE: "0 %", STARTER: "0 %", BUSINESS: "0 %", SCALE: "0 %", ENTERPRISE: "0 %" } },
      { label: "Paiement à la livraison ou manuel", values: { FREE: true, STARTER: true, BUSINESS: true, SCALE: true, ENTERPRISE: true } },
      { label: "Mobile Money et carte", values: f("onlinePayments") },
      { label: "Rapprochement automatique", values: f("reconciliation") },
      { label: "Zones de livraison", values: lim("deliveryZones") },
      { label: "Créneaux et capacité", values: f("pickupSlots") },
      { label: "Livreurs internes et suivi", values: f("couriers") },
      { label: "TVA, prix TTC ou HT", values: f("taxes") },
      { label: "Factures et avoirs numérotés", values: f("invoices") },
    ],
  },
  {
    title: "International et contenu",
    rows: [
      { label: "Langues de la boutique", values: lim("languages") },
      { label: "Devises affichées en plus", values: lim("currencies") },
      { label: "Traduction par l'IA", values: f("aiTranslation") },
      { label: "Articles de blog", values: lim("blogPosts") },
    ],
  },
  {
    title: "WhatsApp et clients",
    rows: [
      { label: "Commande par lien WhatsApp", values: { FREE: true, STARTER: true, BUSINESS: true, SCALE: true, ENTERPRISE: true } },
      { label: "WhatsApp officiel (API)", values: f("whatsappApi") },
      { label: "Messages inclus par mois", values: lim("whatsappMessagesPerMonth") },
      { label: "Boîte de réception partagée", values: f("inbox") },
      { label: "Entonnoir de vente", values: f("pipeline") },
      { label: "Campagnes WhatsApp", values: f("campaigns") },
      { label: "Flux catalogues (Meta, Google, TikTok)", values: f("catalogFeeds") },
      { label: "Catalogue WhatsApp synchronisé", values: f("catalogSync") },
      { label: "Fichier clients", values: { FREE: "Simple", STARTER: true, BUSINESS: true, SCALE: true, ENTERPRISE: true } },
      { label: "Coupons et promotions", values: f("coupons") },
      { label: "Comptes clients (historique, adresses, favoris, réachat)", values: f("customerAccounts") },
      { label: "Remises automatiques et paliers de panier", values: f("automaticDiscounts") },
      { label: "Lots et « X achetés = Y offerts »", values: f("advancedDiscounts") },
      { label: "Offres au panier (ventes croisées)", values: f("cartOffers") },
      { label: "Cartes cadeaux", values: f("giftCards") },
      { label: "Avoirs clients", values: f("storeCredit") },
      { label: "Retours et échanges en libre-service", values: f("returnsPortal") },
      { label: "Fidélité et avis clients", values: f("loyalty") },
      { label: "Points de fidélité utilisables au paiement", values: f("loyalty") },
      { label: "Automatisations", values: lim("automations") },
      { label: "Relance des paniers abandonnés", values: f("abandonedCart") },
    ],
  },
  {
    title: "Équipe et pilotage",
    rows: [
      { label: "Membres de l'équipe", values: lim("members") },
      { label: "Boutiques", values: lim("stores") },
      { label: "Rapports avancés et Pixel Meta", values: f("advancedAnalytics") },
      { label: "Crédits IA par mois", values: lim("aiCreditsPerMonth") },
      { label: "Rôles personnalisés et audit", values: f("customRoles") },
      { label: "Webhooks sortants", values: lim("webhookEndpoints") },
      { label: "API REST", values: byPlan((p) => ({ none: false, read: "Lecture", full: "Complète" } as const)[REST_API_ACCESS[p]]) },
      // Droit réel = limits.posDevices (vérifié côté serveur par src/lib/pos/plan.ts), pas features.pos.
      {
        label: "Caisse en magasin",
        values: byPlan((p) => {
          const v = PLANS[p].limits.posDevices;
          return v == null ? "Illimité" : v === 0 ? false : `${v} appareil${v > 1 ? "s" : ""}`;
        }),
      },
      { label: "Connecteur IA (MCP)", values: MCP_TIER_LABEL },
      { label: "Revendeurs et marque blanche", values: f("resellers") },
      { label: "Support", values: { FREE: "Centre d'aide", STARTER: "E-mail", BUSINESS: "Chat prioritaire", SCALE: "Chat et appel", ENTERPRISE: "Dédié + SLA" } },
    ],
  },
];

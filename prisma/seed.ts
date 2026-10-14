/**
 * Seed de démonstration Axi V4 — `pnpm exec prisma db seed` (tsx prisma/seed.ts).
 *
 * Idempotent : utilisateurs upsert par e-mail, boutiques par slug, produits par (storeId, slug),
 * abonnements par storeId. Les données volatiles d'une boutique de démo (commandes, clients, zones,
 * créneaux, moyens de paiement, coupons, factures, options, crédits, conversations, campagnes, avis,
 * fidélité, pages) sont supprimées puis régénérées à chaque run de façon déterministe (PRNG à graine
 * fixe). Seules les boutiques dont le slug figure dans STORES sont touchées : aucun compte réel.
 *
 * Ce script n'importe aucun module `server-only` : il tourne hors Next. Il lit le catalogue des
 * plans (src/config/plans.ts) et les photos (src/config/media.ts), modules purs.
 */
import { PrismaClient, Prisma, type OrderStatus, type PaymentStatus, type FulfillmentType, type ConversationStage, type PlanId as DbPlanId } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { unsplash, MEDIA, PRODUCT_PHOTOS } from "../src/config/media";
import { PLANS, getAddOn, planPrice, zoneForCurrency, ZONE_CURRENCY, type AddOnId, type PlanId } from "../src/config/plans";
import { seedLibrary } from "../src/lib/section-library/seed";

type LoadEnvFile = (path?: string) => void;
const loadEnv = (process as unknown as { loadEnvFile?: LoadEnvFile }).loadEnvFile;
if (typeof loadEnv === "function") {
  try {
    loadEnv(".env");
  } catch {
    /* pas de .env */
  }
}

// Garde : le seed de démonstration (comptes à mot de passe connu, données fictives) ne tourne jamais en production.
if (process.env.NODE_ENV === "production") {
  console.error("Seed refusé : NODE_ENV=production. Ce script crée des comptes de démonstration à mot de passe connu.");
  process.exit(1);
}

const db = new PrismaClient();

// Mêmes paramètres que src/lib/auth/password.ts (module server-only, non importable ici)
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 };
const hashPassword = (p: string) => hash(p, ARGON_OPTS);

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@axi.africa";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin-Axi-2026!";
const DEMO_EMAIL = "demo@axi.africa";
const DEMO_PASSWORD = "Demo-Axi-2026!";

// ───────────────────────────── utilitaires ─────────────────────────────

/** PRNG déterministe (mulberry32) : mêmes données à chaque seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;
const pick = <T,>(rand: Rand, arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

function slugify(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function reference(rand: Rand): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return `AX-${out}`;
}
function token(rand: Rand, bytes = 24): string {
  let out = "";
  for (let i = 0; i < bytes; i++) out += Math.floor(rand() * 256).toString(16).padStart(2, "0");
  return out;
}
const now = new Date();
const daysAgo = (d: number, hour = 10, minute?: number) => {
  const r = new Date(now);
  r.setDate(r.getDate() - d);
  r.setHours(hour, minute ?? Math.floor(d * 7) % 60, 0, 0);
  return r;
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
const addMonths = (d: Date, n: number) => {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
};
const period = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const utcPeriod = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
/** 1er du mois suivant (UTC) : même règle que endOfCurrentMonth() de src/lib/credits.ts. */
const firstOfNextMonthUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const firstOfMonthUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const json = (v: unknown) => v as Prisma.InputJsonValue;
const photo = (id: string, alt: string) => ({ url: unsplash(id, 900, 1125), alt });
const P = PRODUCT_PHOTOS;
const M = MEDIA;

/** Même règle que normalizePhone() (src/lib/utils.ts). */
function e164(local: string, dialCode: string): string {
  let digits = local.replace(/\D/g, "");
  // Numéro déjà international (indicatif inclus, 11 chiffres ou plus)
  if (!digits.startsWith("0") && digits.length >= 11) return digits;
  if (digits.startsWith("0")) digits = digits.slice(1);
  return `${dialCode}${digits}`;
}

// ───────────────────────────── modèle des données de démo ─────────────────────────────

type Sector = "general" | "restaurant" | "patisserie" | "mode" | "beaute" | "salon" | "clinique";
type OptionSpec = { name: string; required?: boolean; maxSelect?: number; options: { name: string; priceDelta?: number }[] };
type VariantSpec = { attributes: Record<string, string>; price?: number; stock: number };
type ProductSpec = {
  name: string;
  category: string;
  price: number;
  description: string;
  img: string;
  compareAtPrice?: number;
  promo?: { price: number; start: Date; end: Date };
  trackStock?: boolean;
  stock?: number;
  isFeatured?: boolean;
  options?: OptionSpec[];
  variants?: VariantSpec[];
};
type SubSpec = {
  plan: Exclude<PlanId, "ENTERPRISE">;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE";
  interval: "MONTHLY" | "YEARLY";
  /** Facture de renouvellement émise (à payer) en plus des factures réglées. */
  renewalOpen?: boolean;
  /** Essai démarré il y a N jours (boutique plus ancienne passée en essai Business). */
  trialStartedDaysAgo?: number;
};
type AddOnSpec = { id: AddOnId; status: "ACTIVE" | "PENDING"; quantity?: number; daysAgo: number };
type ManualMethod = { kind: "MOBILE_MONEY_MANUAL" | "BANK_TRANSFER_MANUAL"; label: string; number: string; name: string };
type StoreSpec = {
  slug: string;
  owner: string; // e-mail du propriétaire
  name: string;
  tagline: string;
  description: string;
  sector: Sector;
  category: string;
  country: string;
  city: string;
  currency: "XOF" | "EUR";
  timezone: string;
  dialCode: string;
  whatsappNumber: string;
  contactEmail: string;
  address: string;
  logo: string;
  banner: string;
  featured?: boolean;
  deliveryEnabled?: boolean;
  openingHours: Record<string, [string, string][]>;
  categories: string[];
  products: ProductSpec[];
  zones: { name: string; fee: number; freeAbove?: number; etaLabel: string }[];
  pickupSlots?: { days: number[]; start: string; end: string; capacity: number }[];
  methods: ManualMethod[];
  coupon: { code: string; type: "PERCENT" | "FIXED" | "FREE_DELIVERY"; value: number; minSubtotal: number; maxUses?: number };
  customers: { name: string; local: string; email?: string; address: string }[];
  subscription: SubSpec;
  addOns?: AddOnSpec[];
  orderCount: number;
  createdDaysAgo: number;
  /** Vocabulaire du secteur pour les conversations et avis. */
  voice: { item: string; ask: string; delivery: string; thanks: string };
  about: string;
  faq: [string, string][];
  seed: number;
};

type MerchantSpec = { email: string; name: string; phone: string };

const MERCHANTS: MerchantSpec[] = [
  { email: "rosine@maquis-tanti-rosine.demo", name: "Rosine Houngbédji", phone: "2290196451230" },
  { email: "nafi@atelier-beaute-nafi.demo", name: "Nafissatou Diop", phone: "221771234567" },
  { email: "akossiwa@belle-tresse.demo", name: "Akossiwa Mensah", phone: "22890123456" },
  { email: "dr.adjovi@sante-plus.demo", name: "Dr Codjo Adjovi", phone: "2290164781122" },
  { email: "awa@saveurs-afrique.demo", name: "Awa Traoré", phone: "33612457890" },
  { email: "senan@bijoux-ganvie.demo", name: "Sènan Hounsou", phone: "2290197553311" },
];
/** Employée (membre STAFF) de Dantokpa Mode : justifie l'option « membre en plus ». */
const STAFF: MerchantSpec = { email: "benedicte@dantokpa-mode.demo", name: "Bénédicte Agossa", phone: "2290195880022" };

const WEEKDAYS = (open: string, close: string, sat?: [string, string], sun?: [string, string]) => ({
  mon: [[open, close]] as [string, string][],
  tue: [[open, close]] as [string, string][],
  wed: [[open, close]] as [string, string][],
  thu: [[open, close]] as [string, string][],
  fri: [[open, close]] as [string, string][],
  sat: sat ? [sat] : [],
  sun: sun ? [sun] : [],
});

const STORES: StoreSpec[] = [
  {
    slug: "chez-aicha",
    owner: DEMO_EMAIL,
    name: "Chez Aïcha Pâtisserie",
    tagline: "Gâteaux, viennoiseries et jus maison, livrés à Abidjan.",
    description: "Pâtisserie artisanale à Cocody : gâteaux sur commande, viennoiseries chaque matin dès 7 h, box petit-déjeuner pour vos réunions. Commandez la veille pour le retrait ou la livraison.",
    sector: "patisserie",
    category: "food",
    country: "CI",
    city: "Abidjan",
    currency: "XOF",
    timezone: "Africa/Abidjan",
    dialCode: "225",
    whatsappNumber: "2250700000001",
    contactEmail: "aicha@chez-aicha.demo",
    address: "Cocody Angré, 8e tranche, Abidjan",
    logo: P.croissants,
    banner: M.bakery.id,
    featured: true,
    openingHours: WEEKDAYS("07:00", "19:00", ["07:00", "20:00"]),
    categories: ["Gâteaux", "Viennoiseries", "Boissons"],
    products: [
      { name: "Gâteau au chocolat", category: "Gâteaux", price: 12000, img: P.chocolateCake, isFeatured: true, description: "Gâteau moelleux au chocolat noir, ganache maison. Commande 24 h à l'avance.", options: [
        { name: "Taille", required: true, options: [{ name: "6 parts" }, { name: "10 parts", priceDelta: 6000 }, { name: "15 parts", priceDelta: 11000 }] },
        { name: "Inscription", options: [{ name: "Prénom ou message court", priceDelta: 500 }] },
      ] },
      { name: "Tarte aux fruits de saison", category: "Gâteaux", price: 9000, compareAtPrice: 10500, img: P.fruitTart, description: "Pâte sablée, crème pâtissière vanille, mangue, ananas et fruits de la passion." },
      { name: "Cake au citron", category: "Gâteaux", price: 6500, img: P.lemonCake, description: "Cake citron glacé, 8 parts. Se conserve 3 jours." },
      { name: "Croissants au beurre (x6)", category: "Viennoiseries", price: 2400, img: P.croissants, description: "Pur beurre, cuits chaque matin. Retrait avant 11 h conseillé." },
      { name: "Pains au chocolat (x6)", category: "Viennoiseries", price: 2700, img: P.painChocolat, description: "Deux barres de chocolat, feuilletage croustillant." },
      { name: "Beignets soufflés (x10)", category: "Viennoiseries", price: 1500, img: P.beignets, description: "Beignets moelleux, nature ou nappés.", options: [
        { name: "Finition", required: true, options: [{ name: "Sucre glace" }, { name: "Nappage chocolat", priceDelta: 300 }, { name: "Cannelle" }] },
      ] },
      { name: "Box petit-déjeuner", category: "Viennoiseries", price: 7500, img: P.breakfastBox, isFeatured: true, description: "2 viennoiseries, 1 cake, 1 jus et 1 boisson chaude. Idéal pour vos réunions.", options: [
        { name: "Boisson chaude", required: true, options: [{ name: "Café" }, { name: "Thé" }, { name: "Chocolat chaud", priceDelta: 200 }] },
        { name: "Extras", maxSelect: 3, options: [{ name: "Fruits coupés", priceDelta: 1000 }, { name: "Yaourt", priceDelta: 700 }, { name: "Jus supplémentaire", priceDelta: 1500 }] },
      ] },
      { name: "Jus de bissap 1 L", category: "Boissons", price: 1500, img: P.bissap, description: "Hibiscus, gingembre et menthe, sans conservateur. À consommer sous 48 h." },
    ],
    zones: [
      { name: "Abidjan, Cocody", fee: 1000, etaLabel: "Sous 2 h" },
      { name: "Abidjan, Plateau et Marcory", fee: 2000, freeAbove: 25000, etaLabel: "Sous 3 h" },
    ],
    pickupSlots: [
      { days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "12:00", capacity: 10 },
      { days: [1, 2, 3, 4, 5, 6], start: "15:00", end: "18:00", capacity: 8 },
    ],
    methods: [
      { kind: "MOBILE_MONEY_MANUAL", label: "Orange Money", number: "07 00 00 00 01", name: "Aïcha Koné" },
      { kind: "MOBILE_MONEY_MANUAL", label: "Wave", number: "07 00 00 00 01", name: "Aïcha Koné" },
    ],
    coupon: { code: "BIENVENUE10", type: "PERCENT", value: 10, minSubtotal: 5000 },
    customers: [
      { name: "Mariam Touré", local: "0701020304", email: "mariam.toure@example.com", address: "Cocody Riviera 3, villa 12" },
      { name: "Jean-Marc Kouassi", local: "0505060708", address: "Plateau, immeuble Alpha 2000" },
      { name: "Fatou Diabaté", local: "0102030405", email: "fatou.d@example.com", address: "Marcory Zone 4, rue du Canal" },
      { name: "Yves Brou", local: "0708091011", address: "Cocody Angré 7e tranche" },
      { name: "Aminata Cissé", local: "0511121314", address: "Yopougon Niangon" },
      { name: "Serge Aka", local: "0115161718", email: "serge.aka@example.com", address: "Cocody Deux-Plateaux Vallon" },
      { name: "Adjoua N'Guessan", local: "0719202122", address: "Bingerville, cité Ebrié" },
      { name: "Koffi Yao", local: "0523242526", address: "Cocody Saint-Jean" },
    ],
    subscription: { plan: "BUSINESS", status: "TRIALING", interval: "MONTHLY", trialStartedDaysAgo: 5 },
    orderCount: 38,
    createdDaysAgo: 70,
    voice: { item: "gâteau", ask: "pour samedi", delivery: "Livraison à Cocody en moins de 2 h.", thanks: "Merci Aïcha, le gâteau était délicieux !" },
    about: "Aïcha a ouvert sa pâtisserie à Cocody en 2019, après dix ans en hôtellerie. Tout est fait maison chaque matin, avec du beurre de qualité et des fruits de saison achetés au marché.",
    faq: [
      ["Combien de temps à l'avance commander un gâteau ?", "24 h pour les gâteaux classiques, 48 h pour les pièces de plus de 15 parts."],
      ["Livrez-vous le dimanche ?", "Non, nous sommes fermés le dimanche. Les commandes du week-end se retirent le samedi."],
      ["Comment payer ?", "Orange Money, Wave ou en espèces au retrait. Nous confirmons chaque commande sur WhatsApp."],
    ],
    seed: 11,
  },
  {
    slug: "dantokpa-mode",
    owner: DEMO_EMAIL,
    name: "Dantokpa Mode",
    tagline: "Wax, pagne tissé et accessoires faits à Cotonou.",
    description: "Atelier de couture et boutique au marché Dantokpa. Robes, chemises et ensembles en wax, tailles S à XL, retouches gratuites. Livraison à Cotonou, Porto-Novo et Lomé.",
    sector: "mode",
    category: "fashion",
    country: "BJ",
    city: "Cotonou",
    currency: "XOF",
    timezone: "Africa/Porto-Novo",
    dialCode: "229",
    whatsappNumber: "22997000002",
    contactEmail: "contact@dantokpa-mode.demo",
    address: "Marché Dantokpa, allée des tissus, Cotonou",
    logo: P.waxFabric,
    banner: M.seamstresses.id,
    featured: true,
    openingHours: WEEKDAYS("09:00", "18:30", ["09:00", "17:00"]),
    categories: ["Femme", "Homme", "Accessoires"],
    products: [
      { name: "Robe wax Abomey", category: "Femme", price: 18000, img: P.dress, isFeatured: true, trackStock: true, description: "Robe mi-longue en wax hollandais, coupe évasée, poches latérales.", variants: [
        { attributes: { Taille: "S", Couleur: "Bleu" }, stock: 3 }, { attributes: { Taille: "M", Couleur: "Bleu" }, stock: 5 }, { attributes: { Taille: "L", Couleur: "Bleu" }, stock: 2 },
        { attributes: { Taille: "S", Couleur: "Orange" }, stock: 4 }, { attributes: { Taille: "M", Couleur: "Orange" }, stock: 0 }, { attributes: { Taille: "L", Couleur: "Orange" }, stock: 6 },
      ] },
      { name: "Robe soleil en pagne", category: "Femme", price: 16000, img: P.dressYellow, trackStock: true, description: "Robe légère à bretelles, pagne jaune soleil, doublée coton.", variants: [
        { attributes: { Taille: "S" }, stock: 6 }, { attributes: { Taille: "M" }, stock: 7 }, { attributes: { Taille: "L" }, stock: 3 },
      ] },
      { name: "Coupon de wax 6 yards", category: "Femme", price: 12000, img: P.waxFabric2, trackStock: true, stock: 25, description: "Wax hollandais 100 % coton, 6 yards. Motifs renouvelés chaque semaine." },
      { name: "Chemise wax homme", category: "Homme", price: 15000, img: P.menShirt, trackStock: true, description: "Chemise manches courtes, col mao, coton wax.", variants: [
        { attributes: { Taille: "S" }, stock: 5 }, { attributes: { Taille: "M" }, stock: 8 }, { attributes: { Taille: "L" }, stock: 6 }, { attributes: { Taille: "XL" }, stock: 2 },
      ] },
      { name: "Sac en pagne tissé", category: "Accessoires", price: 8500, img: P.waxBag, trackStock: true, description: "Sac cabas doublé, anses en cuir.", variants: [
        { attributes: { Couleur: "Rouge" }, stock: 9 }, { attributes: { Couleur: "Vert" }, stock: 5 },
      ] },
      { name: "Sandales en cuir", category: "Accessoires", price: 14000, img: P.sandals, trackStock: true, description: "Cuir pleine fleur, semelle gomme. Fabriquées à Abomey.", variants: [
        { attributes: { Pointure: "38" }, stock: 3 }, { attributes: { Pointure: "40" }, stock: 5 }, { attributes: { Pointure: "42" }, stock: 4 }, { attributes: { Pointure: "44" }, price: 15000, stock: 2 },
      ] },
      { name: "Sac à main cuir et wax", category: "Accessoires", price: 22000, img: P.handbag, trackStock: true, stock: 6, description: "Cuir tanné à Cotonou, rabat en wax, bandoulière amovible." },
      { name: "Collier de perles", category: "Accessoires", price: 4500, img: P.necklace, trackStock: true, stock: 20, description: "Perles de verre recyclé, fermoir laiton." },
    ],
    zones: [
      { name: "Cotonou centre (Dantokpa, Ganhi, Haie Vive)", fee: 1000, etaLabel: "Le jour même" },
      { name: "Fidjrossè et Abomey-Calavi", fee: 1500, freeAbove: 40000, etaLabel: "Sous 24 h" },
      { name: "Porto-Novo", fee: 2500, freeAbove: 50000, etaLabel: "24 à 48 h" },
      { name: "Lomé (livraison interurbaine)", fee: 4000, etaLabel: "2 à 4 jours" },
    ],
    methods: [
      { kind: "MOBILE_MONEY_MANUAL", label: "MTN MoMo", number: "97 00 00 02", name: "Dantokpa Mode" },
      { kind: "MOBILE_MONEY_MANUAL", label: "Moov Money", number: "95 00 00 02", name: "Dantokpa Mode" },
    ],
    coupon: { code: "WAX15", type: "FIXED", value: 1500, minSubtotal: 10000 },
    customers: [
      { name: "Grâce Hounkpatin", local: "0197010203", email: "grace.h@example.com", address: "Haie Vive, rue 12.345" },
      { name: "Rodrigue Ahouansou", local: "0196040506", address: "Fidjrossè, carrefour Kpota" },
      { name: "Nadège Dossou", local: "0195070809", email: "nadege.d@example.com", address: "Calavi, Arconville" },
      { name: "Kossi Mensah", local: "22890111222", address: "Lomé, Bè-Kpota" },
      { name: "Ornella Gbaguidi", local: "0164101112", address: "Porto-Novo, Ouando" },
      { name: "Boris Adjovi", local: "0197131415", address: "Akpakpa, Sègbèya" },
      { name: "Clarisse Zinsou", local: "0191161718", email: "clarisse.z@example.com", address: "Cadjèhoun, près de l'aéroport" },
      { name: "Merveille Kiki", local: "0196192021", address: "Gbégamey, rue de la pharmacie" },
    ],
    subscription: { plan: "BUSINESS", status: "ACTIVE", interval: "MONTHLY" },
    addOns: [
      { id: "EXTRA_MEMBER", status: "ACTIVE", daysAgo: 18 },
      { id: "PACK_WA_MARKETING_200", status: "ACTIVE", daysAgo: 24 },
    ],
    orderCount: 42,
    createdDaysAgo: 120,
    voice: { item: "robe", ask: "en taille M", delivery: "Livraison à Cotonou le jour même.", thanks: "La robe tombe parfaitement, merci !" },
    about: "Atelier familial installé au marché Dantokpa depuis 2012. Nos couturières coupent et cousent chaque pièce sur place, avec des tissus choisis à la main.",
    faq: [
      ["Faites-vous les retouches ?", "Oui, les retouches sont gratuites dans les 15 jours suivant l'achat, à l'atelier."],
      ["Livrez-vous hors du Bénin ?", "Nous livrons Lomé en 2 à 4 jours. Pour les autres pays, écrivez-nous sur WhatsApp."],
      ["Puis-je commander sur mesure ?", "Oui, envoyez vos mesures et une photo du modèle : délai de 5 à 7 jours."],
    ],
    seed: 22,
  },
  {
    slug: "tech-hub-cotonou",
    owner: DEMO_EMAIL,
    name: "Tech Hub Cotonou",
    tagline: "Smartphones et accessoires garantis, livrés dans l'heure.",
    description: "Boutique d'électronique à Ganhi : smartphones neufs sous garantie 12 mois, accessoires et petit matériel. Paiement à la livraison ou MoMo.",
    sector: "general",
    category: "electronics",
    country: "BJ",
    city: "Cotonou",
    currency: "XOF",
    timezone: "Africa/Porto-Novo",
    dialCode: "229",
    whatsappNumber: "22997000003",
    contactEmail: "ventes@techhub.demo",
    address: "Ganhi, face à la pharmacie Camp Guézo, Cotonou",
    logo: P.smartphone,
    banner: M.electronicsShop.id,
    openingHours: WEEKDAYS("08:30", "19:00", ["09:00", "18:00"], ["10:00", "14:00"]),
    categories: ["Téléphones", "Audio", "Accessoires"],
    products: [
      { name: "Samsung Galaxy A15 128 Go", category: "Téléphones", price: 95000, img: P.smartphone, isFeatured: true, description: "Écran 6,5 pouces AMOLED, 128 Go, garantie 12 mois. Facture fournie.", promo: { price: 89000, start: addDays(now, -2), end: addDays(now, 7) } },
      { name: "Montre connectée sport", category: "Téléphones", price: 25000, img: P.smartwatch, description: "Cardio, sommeil, notifications WhatsApp. Autonomie 7 jours." },
      { name: "Écouteurs Bluetooth", category: "Audio", price: 8500, img: P.earbuds, description: "Boîtier de charge, 24 h d'autonomie, réduction de bruit." },
      { name: "Casque sans fil", category: "Audio", price: 18000, compareAtPrice: 22000, img: P.headphones, description: "Pliable, 30 h d'autonomie, micro intégré." },
      { name: "Enceinte portable", category: "Audio", price: 15000, img: P.speaker, description: "Étanche, 12 h d'autonomie, son 360 degrés." },
      { name: "Batterie externe 20 000 mAh", category: "Accessoires", price: 12000, img: P.powerBank, description: "Charge rapide 22,5 W, 2 ports USB-A et 1 USB-C." },
      { name: "Chargeur rapide 25 W USB-C", category: "Accessoires", price: 4500, img: P.charger, description: "Compatible Samsung, Tecno, Infinix. Câble inclus." },
      { name: "Coques de protection", category: "Accessoires", price: 3000, img: P.phoneCases, description: "Silicone renforcé, pour les modèles les plus vendus." },
    ],
    zones: [
      { name: "Cotonou, Ganhi et Haie Vive", fee: 1000, etaLabel: "Sous 1 h" },
      { name: "Abomey-Calavi et Akpakpa", fee: 2000, freeAbove: 100000, etaLabel: "Sous 3 h" },
    ],
    pickupSlots: [{ days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00", capacity: 20 }],
    methods: [
      { kind: "MOBILE_MONEY_MANUAL", label: "MTN MoMo", number: "97 00 00 03", name: "Tech Hub SARL" },
      { kind: "MOBILE_MONEY_MANUAL", label: "Moov Money", number: "95 00 00 03", name: "Tech Hub SARL" },
    ],
    coupon: { code: "TECH5", type: "PERCENT", value: 5, minSubtotal: 20000, maxUses: 50 },
    customers: [
      { name: "Eric Sossou", local: "0197202122", email: "eric.sossou@example.com", address: "Ganhi, rue des Cheminots" },
      { name: "Larissa Kpadonou", local: "0196232425", address: "Calavi, Tankpè" },
      { name: "Hermann Agossou", local: "0195262728", address: "Akpakpa, Suru-Léré" },
      { name: "Sandrine Lokossou", local: "0164293031", email: "sandrine.l@example.com", address: "Haie Vive" },
      { name: "Patrick Dégbé", local: "0197323334", address: "Fidjrossè plage" },
      { name: "Imelda Tossou", local: "0191353637", address: "Cadjèhoun" },
    ],
    subscription: { plan: "STARTER", status: "ACTIVE", interval: "MONTHLY", renewalOpen: true },
    orderCount: 26,
    createdDaysAgo: 75,
    voice: { item: "téléphone", ask: "en noir", delivery: "Livraison en moins d'une heure à Cotonou.", thanks: "Téléphone reçu, tout fonctionne." },
    about: "Tech Hub vend uniquement du matériel neuf, importé avec facture. Chaque téléphone est testé devant vous à la livraison.",
    faq: [
      ["Les téléphones sont-ils garantis ?", "Oui, 12 mois de garantie constructeur avec facture."],
      ["Puis-je payer à la livraison ?", "Oui, en espèces ou par MoMo au moment de la remise."],
    ],
    seed: 33,
  },
  {
    slug: "maquis-tanti-rosine",
    owner: "rosine@maquis-tanti-rosine.demo",
    name: "Le Maquis de Tanti Rosine",
    tagline: "Cuisine béninoise généreuse, à emporter ou livrée à Calavi.",
    description: "Amiwo, riz au gras, poisson braisé et grillades du soir. Commandez avant 11 h pour le déjeuner de bureau, livraison sur tout Abomey-Calavi.",
    sector: "restaurant",
    category: "food",
    country: "BJ",
    city: "Abomey-Calavi",
    currency: "XOF",
    timezone: "Africa/Porto-Novo",
    dialCode: "229",
    whatsappNumber: "2290196451230",
    contactEmail: "rosine@maquis-tanti-rosine.demo",
    address: "Carrefour IITA, Abomey-Calavi",
    logo: P.jollof,
    banner: M.chef.id,
    openingHours: WEEKDAYS("10:30", "22:00", ["11:00", "23:00"], ["11:00", "16:00"]),
    categories: ["Plats", "Grillades", "Boissons"],
    products: [
      { name: "Riz au gras et poisson braisé", category: "Plats", price: 3500, img: P.jollof, isFeatured: true, description: "Riz rouge mijoté, poisson braisé au feu de bois, piment à part.", options: [
        { name: "Accompagnement", required: true, options: [{ name: "Alloco", priceDelta: 500 }, { name: "Salade" }, { name: "Sans accompagnement" }] },
        { name: "Piment", options: [{ name: "Doux" }, { name: "Fort" }] },
      ] },
      { name: "Amiwo au poulet", category: "Plats", price: 3000, img: P.riceDish, description: "Pâte de maïs rouge à la tomate, poulet bicyclette en sauce." },
      { name: "Atchèkè poisson frit", category: "Plats", price: 3000, img: P.foodTray, description: "Semoule de manioc, poisson frit, oignons et tomates fraîches." },
      { name: "Plateau grillades pour 4", category: "Grillades", price: 12000, img: P.foodTray, isFeatured: true, description: "Brochettes de boeuf, poulet braisé, saucisses, alloco et frites." },
      { name: "Beignets de haricot (x10)", category: "Grillades", price: 1000, img: P.beignets, description: "Ata croustillants, servis avec piment frais." },
      { name: "Box déjeuner bureau", category: "Plats", price: 4500, img: P.breakfastBox, description: "Plat du jour, jus et fruit. Livrée avant 13 h si commandée avant 11 h." },
      { name: "Jus de bissap 1 L", category: "Boissons", price: 1000, img: P.bissap, description: "Bissap maison au gingembre, bien frais." },
    ],
    zones: [
      { name: "Abomey-Calavi centre", fee: 500, etaLabel: "30 à 45 min" },
      { name: "Godomey et Togoudo", fee: 1000, freeAbove: 15000, etaLabel: "Sous 1 h" },
    ],
    methods: [
      { kind: "MOBILE_MONEY_MANUAL", label: "MTN MoMo", number: "01 96 45 12 30", name: "Rosine Houngbédji" },
      { kind: "MOBILE_MONEY_MANUAL", label: "Celtiis Cash", number: "01 40 45 12 30", name: "Rosine Houngbédji" },
    ],
    coupon: { code: "MIDI500", type: "FIXED", value: 500, minSubtotal: 4000 },
    customers: [
      { name: "Fiacre Dossa", local: "0197445566", address: "Campus d'Abomey-Calavi, entrée nord" },
      { name: "Prisca Hounsa", local: "0196778899", email: "prisca.h@example.com", address: "Godomey, échangeur" },
      { name: "Junior Akpovi", local: "0195112233", address: "Togoudo, rue du lycée" },
      { name: "Mireille Assogba", local: "0167445599", address: "Calavi Kpota" },
      { name: "Gildas Tchibozo", local: "0161223344", address: "Zoca, bureaux SBEE" },
      { name: "Edwige Sossa", local: "0194556677", address: "IITA, résidence Les Palmiers" },
    ],
    subscription: { plan: "BUSINESS", status: "ACTIVE", interval: "YEARLY" },
    orderCount: 45,
    createdDaysAgo: 150,
    voice: { item: "plat", ask: "pour midi", delivery: "Livraison à Calavi en 30 à 45 minutes.", thanks: "Le riz au gras était excellent, comme d'habitude !" },
    about: "Tanti Rosine cuisine pour les étudiants et les bureaux de Calavi depuis quinze ans. Les recettes sont celles de sa mère, à Ouidah.",
    faq: [
      ["Jusqu'à quelle heure livrez-vous ?", "Jusqu'à 21 h 30 en semaine, 22 h 30 le samedi."],
      ["Faites-vous les commandes d'événements ?", "Oui, à partir de 20 plats, avec 48 h de délai. Écrivez-nous sur WhatsApp."],
    ],
    seed: 44,
  },
  {
    slug: "atelier-beaute-nafi",
    owner: "nafi@atelier-beaute-nafi.demo",
    name: "Atelier Beauté Nafi",
    tagline: "Soins naturels au karité et au baobab, faits main à Dakar.",
    description: "Cosmétiques naturels préparés en petites séries à Dakar : beurre de karité, huiles capillaires, coffrets cadeaux. Livraison à Dakar et expédition dans toute l'Afrique de l'Ouest.",
    sector: "beaute",
    category: "beauty",
    country: "SN",
    city: "Dakar",
    currency: "XOF",
    timezone: "Africa/Dakar",
    dialCode: "221",
    whatsappNumber: "221771234567",
    contactEmail: "nafi@atelier-beaute-nafi.demo",
    address: "Sacré-Coeur 3, villa 9120, Dakar",
    logo: P.sheaButter,
    banner: M.braids.id,
    featured: true,
    openingHours: WEEKDAYS("09:00", "19:00", ["10:00", "18:00"]),
    categories: ["Visage et corps", "Cheveux", "Coffrets"],
    products: [
      { name: "Beurre de karité brut 250 g", category: "Visage et corps", price: 4000, img: P.sheaButter, isFeatured: true, trackStock: true, stock: 60, description: "Karité pur du Burkina, non raffiné, sans parfum ajouté." },
      { name: "Crème visage karité et bissap", category: "Visage et corps", price: 7500, img: P.sheaButter, trackStock: true, stock: 35, description: "Hydratation légère, extrait d'hibiscus antioxydant. Peaux mixtes." },
      { name: "Huile capillaire au chébé", category: "Cheveux", price: 8000, img: M.braids.id, trackStock: true, stock: 40, description: "Fortifie les longueurs et limite la casse. Flacon de 100 ml." },
      { name: "Coffret soin en pagne", category: "Coffrets", price: 15000, img: P.waxBag, isFeatured: true, trackStock: true, stock: 12, description: "Trousse en wax, karité, huile capillaire et savon noir. Idéal à offrir." },
      { name: "Collier de perles de Thiès", category: "Coffrets", price: 6000, img: P.necklace, trackStock: true, stock: 18, description: "Perles de verre travaillées à la main, à glisser dans un coffret." },
    ],
    zones: [
      { name: "Dakar Plateau, Mermoz, Sacré-Coeur", fee: 1500, etaLabel: "Le jour même" },
      { name: "Pikine, Guédiawaye, Rufisque", fee: 2500, freeAbove: 30000, etaLabel: "Sous 24 h" },
      { name: "Expédition Afrique de l'Ouest", fee: 7500, etaLabel: "3 à 6 jours" },
    ],
    methods: [
      { kind: "MOBILE_MONEY_MANUAL", label: "Wave", number: "77 123 45 67", name: "Nafissatou Diop" },
      { kind: "MOBILE_MONEY_MANUAL", label: "Orange Money", number: "77 123 45 67", name: "Nafissatou Diop" },
    ],
    coupon: { code: "GLOW10", type: "PERCENT", value: 10, minSubtotal: 10000 },
    customers: [
      { name: "Awa Ndiaye", local: "771112233", email: "awa.ndiaye@example.com", address: "Mermoz, cité Comico" },
      { name: "Khady Sarr", local: "776654321", address: "Ouakam, près de la mosquée" },
      { name: "Mame Diarra Fall", local: "781239876", address: "Sicap Liberté 6" },
      { name: "Aïssatou Ba", local: "765554433", email: "aissatou.ba@example.com", address: "Point E, rue 4" },
      { name: "Coumba Sow", local: "709988776", address: "Pikine Icotaf" },
      { name: "Fatou Bintou Kane", local: "774433221", address: "Almadies, Ngor village" },
      { name: "Adjoa Mensah", local: "22890556677", address: "Lomé, Tokoin (expédition)" },
    ],
    subscription: { plan: "SCALE", status: "ACTIVE", interval: "MONTHLY" },
    addOns: [
      { id: "PACK_AI_1000", status: "ACTIVE", daysAgo: 40 },
      { id: "DOMAIN_NAME", status: "ACTIVE", daysAgo: 55 },
      { id: "PACK_WA_MARKETING_200", status: "ACTIVE", daysAgo: 21 },
      { id: "PACK_WA_UTILITY_500", status: "PENDING", daysAgo: 1 },
    ],
    orderCount: 48,
    createdDaysAgo: 210,
    voice: { item: "soin", ask: "pour peau sèche", delivery: "Livraison à Dakar le jour même.", thanks: "Ma peau n'a jamais été aussi douce, merci Nafi !" },
    about: "Nafi prépare chaque pot dans son atelier de Sacré-Coeur, avec du karité acheté directement aux coopératives de femmes du Burkina Faso.",
    faq: [
      ["Vos produits conviennent-ils aux peaux sensibles ?", "Oui, sans parfum de synthèse ni colorant. Faites un test sur le poignet avant la première utilisation."],
      ["Expédiez-vous à l'étranger ?", "Oui, dans toute l'Afrique de l'Ouest en 3 à 6 jours."],
    ],
    seed: 55,
  },
  {
    slug: "salon-belle-tresse",
    owner: "akossiwa@belle-tresse.demo",
    name: "Salon Belle Tresse",
    tagline: "Tresses, nattes et soins capillaires sur rendez-vous à Lomé.",
    description: "Salon de coiffure afro à Tokoin : box braids, nattes collées, tissages et soins. Réservez votre créneau en ligne et payez l'acompte par Flooz ou T-Money.",
    sector: "salon",
    category: "beauty",
    country: "TG",
    city: "Lomé",
    currency: "XOF",
    timezone: "Africa/Lome",
    dialCode: "228",
    whatsappNumber: "22890123456",
    contactEmail: "akossiwa@belle-tresse.demo",
    address: "Tokoin Hôpital, rue 245, Lomé",
    logo: M.braids.id,
    banner: M.braids.id,
    deliveryEnabled: false,
    openingHours: WEEKDAYS("08:00", "19:00", ["07:30", "20:00"]),
    categories: ["Tresses", "Soins"],
    products: [
      { name: "Box braids mi-longues", category: "Tresses", price: 15000, img: M.braids.id, isFeatured: true, description: "Environ 4 h de pose. Mèches fournies, couleur au choix.", options: [
        { name: "Longueur", required: true, options: [{ name: "Épaules" }, { name: "Mi-dos", priceDelta: 3000 }, { name: "Taille", priceDelta: 6000 }] },
      ] },
      { name: "Nattes collées", category: "Tresses", price: 6000, img: M.braids.id, description: "Motif simple ou géométrique, 1 h 30 à 2 h." },
      { name: "Pose de tissage", category: "Tresses", price: 12000, img: M.phonePink.id, description: "Tissage cousu, mèches non fournies. Rendu naturel." },
      { name: "Soin hydratant profond", category: "Soins", price: 5000, img: P.sheaButter, description: "Bain d'huile, masque au karité et vapeur, 45 min." },
      { name: "Coiffure de cérémonie", category: "Soins", price: 20000, img: M.laptopBraids.id, description: "Chignon ou attache sur tresses, essai inclus." },
    ],
    zones: [],
    pickupSlots: [
      { days: [1, 2, 3, 4, 5], start: "08:00", end: "12:00", capacity: 3 },
      { days: [1, 2, 3, 4, 5, 6], start: "13:00", end: "19:00", capacity: 4 },
    ],
    methods: [
      { kind: "MOBILE_MONEY_MANUAL", label: "Flooz", number: "90 12 34 56", name: "Akossiwa Mensah" },
      { kind: "MOBILE_MONEY_MANUAL", label: "T-Money", number: "90 12 34 56", name: "Akossiwa Mensah" },
    ],
    coupon: { code: "TRESSE20", type: "PERCENT", value: 20, minSubtotal: 12000, maxUses: 30 },
    customers: [
      { name: "Ama Kpodar", local: "90445566", address: "Bè Kpota" },
      { name: "Esi Lawson", local: "91223344", email: "esi.lawson@example.com", address: "Adidogomé" },
      { name: "Yawa Agbeko", local: "92334455", address: "Tokoin Wuiti" },
      { name: "Delali Amouzou", local: "93445566", address: "Agoè Zongo" },
      { name: "Afi Gbadoe", local: "98112233", address: "Nyékonakpoè" },
    ],
    subscription: { plan: "STARTER", status: "PAST_DUE", interval: "MONTHLY" },
    orderCount: 24,
    createdDaysAgo: 95,
    voice: { item: "rendez-vous", ask: "samedi matin", delivery: "Le salon est ouvert du lundi au samedi.", thanks: "Mes tresses sont magnifiques, merci Akossiwa !" },
    about: "Akossiwa coiffe depuis vingt ans. Son salon de Tokoin accueille quatre coiffeuses formées aux techniques de protection des cheveux crépus.",
    faq: [
      ["Faut-il verser un acompte ?", "Oui, 30 % à la réservation par Flooz ou T-Money. Il est déduit du prix final."],
      ["Les mèches sont-elles fournies ?", "Oui pour les box braids, non pour le tissage."],
    ],
    seed: 66,
  },
  {
    slug: "cabinet-sante-plus",
    owner: "dr.adjovi@sante-plus.demo",
    name: "Cabinet Médical Santé Plus",
    tagline: "Consultations, bilans et téléconsultation à Porto-Novo.",
    description: "Cabinet de médecine générale à Ouando : consultations sur rendez-vous, bilans de santé et téléconsultation par WhatsApp vidéo. Prise de rendez-vous en ligne.",
    sector: "clinique",
    category: "services",
    country: "BJ",
    city: "Porto-Novo",
    currency: "XOF",
    timezone: "Africa/Porto-Novo",
    dialCode: "229",
    whatsappNumber: "2290164781122",
    contactEmail: "dr.adjovi@sante-plus.demo",
    address: "Ouando, face au marché, Porto-Novo",
    logo: M.blazer.id,
    banner: M.laptopBraids.id,
    deliveryEnabled: false,
    openingHours: WEEKDAYS("08:00", "18:00", ["08:00", "13:00"]),
    categories: ["Consultations", "Bilans"],
    products: [
      { name: "Consultation de médecine générale", category: "Consultations", price: 10000, img: M.blazer.id, isFeatured: true, description: "Consultation de 20 minutes au cabinet, ordonnance si besoin." },
      { name: "Téléconsultation WhatsApp", category: "Consultations", price: 7000, img: M.phonePink.id, description: "Appel vidéo de 15 minutes. Ordonnance envoyée par message." },
      { name: "Bilan de santé complet", category: "Bilans", price: 35000, img: P.smartwatch, description: "Examen clinique, analyses de base et compte rendu écrit." },
      { name: "Suivi de grossesse", category: "Consultations", price: 12000, img: M.laptopBraids.id, description: "Consultation prénatale mensuelle, carnet de suivi inclus." },
    ],
    zones: [],
    pickupSlots: [
      { days: [1, 2, 3, 4, 5], start: "08:00", end: "12:00", capacity: 8 },
      { days: [1, 2, 3, 4, 5], start: "14:00", end: "18:00", capacity: 8 },
    ],
    methods: [{ kind: "MOBILE_MONEY_MANUAL", label: "MTN MoMo", number: "01 64 78 11 22", name: "Cabinet Santé Plus" }],
    coupon: { code: "BILAN10", type: "PERCENT", value: 10, minSubtotal: 30000, maxUses: 20 },
    customers: [
      { name: "Hortense Akpo", local: "0196334455", address: "Ouando" },
      { name: "Sylvain Kpossou", local: "0197667788", email: "sylvain.k@example.com", address: "Djègan Kpèvi" },
      { name: "Bernadette Dansou", local: "0195445566", address: "Tokpota" },
      { name: "Didier Hounyè", local: "0161778899", address: "Avakpa" },
    ],
    subscription: { plan: "FREE", status: "ACTIVE", interval: "MONTHLY" },
    orderCount: 14,
    createdDaysAgo: 40,
    voice: { item: "rendez-vous", ask: "demain matin", delivery: "Le cabinet reçoit du lundi au samedi matin.", thanks: "Merci docteur pour votre écoute." },
    about: "Le Dr Codjo Adjovi exerce la médecine générale à Porto-Novo depuis 2010. Le cabinet propose aussi la téléconsultation pour les patients éloignés.",
    faq: [
      ["Comment annuler un rendez-vous ?", "Écrivez-nous sur WhatsApp au moins 2 h avant l'heure prévue."],
      ["Acceptez-vous les assurances ?", "Oui, les principales mutuelles du Bénin. Apportez votre carte."],
    ],
    seed: 77,
  },
  {
    slug: "saveurs-afrique-paris",
    owner: "awa@saveurs-afrique.demo",
    name: "Saveurs d'Afrique Paris",
    tagline: "Épicerie fine africaine, livrée à Paris et en Île-de-France.",
    description: "Bissap, karité, épices et tissus wax sélectionnés auprès de producteurs d'Afrique de l'Ouest. Livraison en 24 h à Paris, retrait à la boutique de Château-Rouge.",
    sector: "general",
    category: "grocery",
    country: "FR",
    city: "Paris",
    currency: "EUR",
    timezone: "Europe/Paris",
    dialCode: "33",
    whatsappNumber: "33612457890",
    contactEmail: "awa@saveurs-afrique.demo",
    address: "12 rue Poulet, 75018 Paris",
    logo: P.bissap,
    banner: M.market.id,
    openingHours: WEEKDAYS("10:00", "19:30", ["10:00", "20:00"]),
    categories: ["Épicerie", "Boissons", "Cadeaux"],
    products: [
      { name: "Fleurs de bissap séchées 250 g", category: "Épicerie", price: 690, img: P.bissap, isFeatured: true, description: "Hibiscus du Sénégal, pour 4 litres de jus." },
      { name: "Beurre de karité bio 250 g", category: "Épicerie", price: 1290, img: P.sheaButter, description: "Karité brut certifié bio, coopérative de Koudougou." },
      { name: "Jus de bissap artisanal 1 L", category: "Boissons", price: 590, img: P.bissap, description: "Préparé chaque jour, gingembre et menthe fraîche." },
      { name: "Coffret découverte", category: "Cadeaux", price: 4500, img: P.breakfastBox, isFeatured: true, description: "Bissap, karité, épices yassa et biscuits au gingembre." },
      { name: "Tote bag en wax", category: "Cadeaux", price: 3900, img: P.waxBag, description: "Cousu à Cotonou, doublure coton, poche intérieure." },
      { name: "Coupon de wax 6 yards", category: "Cadeaux", price: 5900, img: P.waxFabric, description: "Wax hollandais 100 % coton, motifs renouvelés chaque mois." },
    ],
    zones: [
      { name: "Paris intra-muros", fee: 590, freeAbove: 6000, etaLabel: "Sous 24 h" },
      { name: "Petite couronne", fee: 990, freeAbove: 8000, etaLabel: "24 à 48 h" },
    ],
    pickupSlots: [{ days: [2, 3, 4, 5, 6], start: "10:00", end: "19:00", capacity: 15 }],
    methods: [{ kind: "BANK_TRANSFER_MANUAL", label: "Virement instantané", number: "FR76 0000 0000 0000 0000 0000 000", name: "Saveurs d'Afrique SAS" }],
    coupon: { code: "PARIS5", type: "FIXED", value: 500, minSubtotal: 3500 },
    customers: [
      { name: "Mariama Camara", local: "0611223344", email: "mariama.c@example.com", address: "Rue Myrha, 75018 Paris" },
      { name: "Thomas Lefèvre", local: "0622334455", email: "thomas.l@example.com", address: "Boulevard Voltaire, 75011 Paris" },
      { name: "Fatoumata Keïta", local: "0633445566", address: "Avenue Jean-Jaurès, 93100 Montreuil" },
      { name: "Kevin Mendy", local: "0644556677", address: "Rue des Pyrénées, 75020 Paris" },
      { name: "Clémence Dubois", local: "0655667788", email: "clemence.d@example.com", address: "Rue Oberkampf, 75011 Paris" },
      { name: "Ibrahim Sylla", local: "0766778899", address: "Rue de Paris, 93200 Saint-Denis" },
    ],
    subscription: { plan: "BUSINESS", status: "ACTIVE", interval: "MONTHLY" },
    addOns: [
      { id: "EXTRA_WHATSAPP_NUMBER", status: "ACTIVE", daysAgo: 12 },
      { id: "SECTOR_TEMPLATE", status: "ACTIVE", daysAgo: 58 },
      { id: "PACK_WA_MARKETING_200", status: "ACTIVE", daysAgo: 16 },
    ],
    orderCount: 36,
    createdDaysAgo: 62,
    voice: { item: "coffret", ask: "pour vendredi", delivery: "Livraison en 24 h dans Paris.", thanks: "Coffret offert à ma mère, elle a adoré." },
    about: "Awa a grandi entre Bamako et Paris. Sa boutique de Château-Rouge réunit les produits qu'elle rapportait dans ses valises, sélectionnés auprès de petits producteurs.",
    faq: [
      ["Livrez-vous hors d'Île-de-France ?", "Pas encore. Le retrait en boutique est possible du mardi au samedi."],
      ["Les produits sont-ils certifiés ?", "Le karité et le bissap sont certifiés bio. Les autres produits sont artisanaux."],
    ],
    seed: 88,
  },
  {
    slug: "bijoux-ganvie",
    owner: "senan@bijoux-ganvie.demo",
    name: "Bijoux de Ganvié",
    tagline: "Bijoux en perles, laiton et wax, créés au bord du lac Nokoué.",
    description: "Colliers, bracelets et sacs fabriqués par des artisanes de Ganvié et de Cotonou. Pièces uniques, emballage cadeau offert.",
    sector: "mode",
    category: "fashion",
    country: "BJ",
    city: "Cotonou",
    currency: "XOF",
    timezone: "Africa/Porto-Novo",
    dialCode: "229",
    whatsappNumber: "2290197553311",
    contactEmail: "senan@bijoux-ganvie.demo",
    address: "Haie Vive, rue des Ambassades, Cotonou",
    logo: P.necklace,
    banner: M.fabrics.id,
    openingHours: WEEKDAYS("10:00", "19:00", ["10:00", "18:00"]),
    categories: ["Bijoux", "Sacs et chaussures"],
    products: [
      { name: "Collier de perles Nokoué", category: "Bijoux", price: 9500, img: P.necklace, isFeatured: true, trackStock: true, stock: 14, description: "Trois rangs de perles de verre, fermoir laiton." },
      { name: "Sac pochette en wax", category: "Sacs et chaussures", price: 11000, img: P.waxBag, trackStock: true, stock: 9, description: "Pochette doublée, chaîne dorée amovible." },
      { name: "Sandales tressées", category: "Sacs et chaussures", price: 13000, img: P.sandals, trackStock: true, stock: 10, description: "Cuir et lanières tressées, semelle confort." },
      { name: "Baskets imprimé wax", category: "Sacs et chaussures", price: 24000, img: P.sneakers, trackStock: true, stock: 7, description: "Toile wax, semelle blanche cousue. Du 36 au 44." },
      { name: "Sac à main Ganvié", category: "Sacs et chaussures", price: 28000, img: P.handbag, trackStock: true, stock: 4, description: "Cuir pleine fleur, rabat en pagne tissé." },
    ],
    zones: [{ name: "Cotonou et Calavi", fee: 1000, freeAbove: 30000, etaLabel: "Sous 24 h" }],
    methods: [{ kind: "MOBILE_MONEY_MANUAL", label: "MTN MoMo", number: "01 97 55 33 11", name: "Sènan Hounsou" }],
    coupon: { code: "CADEAU", type: "FREE_DELIVERY", value: 0, minSubtotal: 15000 },
    customers: [
      { name: "Laure Agbo", local: "0196221100", email: "laure.agbo@example.com", address: "Haie Vive" },
      { name: "Christelle Houéto", local: "0197334400", address: "Cocotiers" },
      { name: "Arnaud Gnonlonfoun", local: "0195667700", address: "Fidjrossè" },
      { name: "Sabine Ahomadégbé", local: "0164889900", address: "Akpakpa Dodomey" },
    ],
    subscription: { plan: "STARTER", status: "ACTIVE", interval: "YEARLY" },
    orderCount: 22,
    createdDaysAgo: 48,
    voice: { item: "collier", ask: "en emballage cadeau", delivery: "Livraison sous 24 h à Cotonou.", thanks: "Le collier est encore plus beau en vrai." },
    about: "Sènan travaille avec six artisanes de Ganvié. Chaque bijou est signé et accompagné d'une carte racontant son origine.",
    faq: [["Les pièces sont-elles uniques ?", "Les colliers et les sacs sont fabriqués en séries de 5 à 10 pièces maximum."]],
    seed: 99,
  },
];

// ───────────────────────────── utilisateurs ─────────────────────────────

async function seedUsers() {
  const [adminHash, demoHash] = await Promise.all([hashPassword(ADMIN_PASSWORD), hashPassword(DEMO_PASSWORD)]);
  const admin = await db.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: { email: ADMIN_EMAIL, name: "Admin Axi", passwordHash: adminHash, isPlatformAdmin: true, emailVerifiedAt: now },
    update: { isPlatformAdmin: true, emailVerifiedAt: now, passwordHash: adminHash },
  });
  const users = new Map<string, { id: string; name: string }>();
  const demo = await db.user.upsert({
    where: { email: DEMO_EMAIL },
    create: { email: DEMO_EMAIL, name: "Marchand Démo", phone: "22997000000", passwordHash: demoHash, emailVerifiedAt: now },
    update: { emailVerifiedAt: now, passwordHash: demoHash },
  });
  users.set(DEMO_EMAIL, { id: demo.id, name: demo.name });
  for (const m of [...MERCHANTS, STAFF]) {
    const store = STORES.find((s) => s.owner === m.email);
    const createdAt = daysAgo((store?.createdDaysAgo ?? 100) + 1, 9);
    const u = await db.user.upsert({
      where: { email: m.email },
      create: { email: m.email, name: m.name, phone: m.phone, passwordHash: demoHash, emailVerifiedAt: createdAt, createdAt },
      update: { name: m.name, phone: m.phone, passwordHash: demoHash },
    });
    users.set(m.email, { id: u.id, name: u.name });
  }
  return { admin, demo, users };
}

// ───────────────────────────── conversations (modèles) ─────────────────────────────

type ConvScript = { stage: ConversationStage; status: "OPEN" | "PENDING" | "CLOSED"; labels: string[]; unread: number; lines: { dir: "INBOUND" | "OUTBOUND" | "NOTE"; body: string }[] };

function conversationScripts(spec: StoreSpec, products: { name: string; price: number }[], fmt: (n: number) => string): ConvScript[] {
  const [p1, p2, p3] = [products[0]!, products[1] ?? products[0]!, products[2] ?? products[0]!];
  const v = spec.voice;
  const appointment = spec.sector === "salon" || spec.sector === "clinique";
  return [
    {
      stage: "NEW", status: "OPEN", labels: ["Nouveau client"], unread: 2,
      lines: [
        { dir: "INBOUND", body: `Bonjour, je vous ai trouvés sur la marketplace Axi. ${appointment ? `Vous avez de la place ${v.ask} ?` : `Est-ce que ${p1.name} est encore disponible ?`}` },
        { dir: "INBOUND", body: appointment ? "C'est pour " + p1.name.toLowerCase() + "." : `Je le voudrais ${v.ask}.` },
      ],
    },
    {
      stage: "INTERESTED", status: "OPEN", labels: ["Prix demandé"], unread: 0,
      lines: [
        { dir: "INBOUND", body: `Bonsoir, c'est combien ${p2.name} ?` },
        { dir: "OUTBOUND", body: `Bonsoir, ${p2.name} est à ${fmt(p2.price)}. ${v.delivery}` },
        { dir: "INBOUND", body: "D'accord, je regarde avec mon budget et je reviens vers vous demain." },
        { dir: "NOTE", body: "Relancer demain en fin de matinée avec le code promo." },
      ],
    },
    {
      stage: "ORDERING", status: "PENDING", labels: ["Lien envoyé"], unread: 1,
      lines: [
        { dir: "INBOUND", body: appointment ? `Je veux réserver ${p1.name.toLowerCase()} ${v.ask}.` : `Je veux commander 2 ${p3.name} ${v.ask}.` },
        { dir: "OUTBOUND", body: `Très bien ! Voici le lien pour ${appointment ? "réserver votre créneau" : "valider votre commande"} : https://axi.africa/s/${spec.slug}` },
        { dir: "INBOUND", body: "Je peux payer à la livraison ?" },
        { dir: "OUTBOUND", body: appointment ? "Un acompte de 30 % est demandé, le reste se règle sur place." : "Oui, le paiement à la livraison est accepté. Vous pouvez aussi payer par Mobile Money." },
      ],
    },
    {
      stage: "PAID", status: "CLOSED", labels: ["Payé", "Fidèle"], unread: 0,
      lines: [
        { dir: "INBOUND", body: `Bonjour, j'ai payé ma commande ${appointment ? "pour le rendez-vous" : ""} ce matin.`.replace("  ", " ") },
        { dir: "OUTBOUND", body: "Paiement bien reçu, merci ! Vous recevrez une confirmation dès que c'est prêt." },
        { dir: "INBOUND", body: v.thanks },
        { dir: "OUTBOUND", body: "Avec plaisir, à très bientôt !" },
      ],
    },
    {
      stage: "LOST", status: "CLOSED", labels: ["Prix"], unread: 0,
      lines: [
        { dir: "INBOUND", body: `${p1.name}, c'est un peu cher pour moi.` },
        { dir: "OUTBOUND", body: `Je comprends. Avec le code ${spec.coupon.code}, vous avez une réduction sur votre première commande.` },
        { dir: "INBOUND", body: "Merci, ce sera pour une prochaine fois." },
      ],
    },
    {
      stage: "INTERESTED", status: "OPEN", labels: ["Question"], unread: 1,
      lines: [
        { dir: "INBOUND", body: spec.faq[0]![0] },
        { dir: "OUTBOUND", body: spec.faq[0]![1] },
        { dir: "INBOUND", body: "Parfait, merci pour la réponse rapide." },
      ],
    },
  ];
}

const REVIEW_BODIES = [
  (item: string) => `Très satisfaite, ${item} conforme à la photo et livré à l'heure. Je recommande.`,
  (item: string) => `Accueil chaleureux et réponse rapide sur WhatsApp. ${item.charAt(0).toUpperCase() + item.slice(1)} de qualité.`,
  () => "Bon rapport qualité prix, je reviendrai.",
  () => "Commande simple depuis mon téléphone, paiement Mobile Money sans souci.",
  () => "Un peu d'attente mais le résultat valait le coup.",
];

// ───────────────────────────── boutique ─────────────────────────────

async function seedStore(spec: StoreSpec, storeIndex: number, ctx: { ownerId: string; ownerName: string; adminId: string; staffId?: string }) {
  const rand = rng(spec.seed);
  const { ownerId, ownerName } = ctx;
  const createdAt = daysAgo(spec.createdDaysAgo, 9);
  const publishedAt = addDays(createdAt, 1);
  const fmt = (n: number) => (spec.currency === "EUR" ? `${(n / 100).toFixed(2).replace(".", ",")} €` : `${n.toLocaleString("fr-FR").replace(/ /g, " ")} FCFA`);
  const planFeatures = PLANS[spec.subscription.plan].features;
  const hasInbox = planFeatures.inbox;
  const hasLoyalty = planFeatures.loyalty;
  const isEur = spec.currency === "EUR";

  const storeData = {
    name: spec.name, tagline: spec.tagline, description: spec.description, category: spec.category, sector: spec.sector, themeId: spec.sector,
    country: spec.country, city: spec.city, currency: spec.currency, timezone: spec.timezone, status: "PUBLISHED" as const, statusReason: null, publishedAt,
    whatsappNumber: spec.whatsappNumber, contactEmail: spec.contactEmail, contactPhone: spec.whatsappNumber, address: spec.address,
    openingHours: json(spec.openingHours), logoUrl: unsplash(spec.logo, 240, 240), bannerUrl: unsplash(spec.banner, 1600, 640),
    listedInMarketplace: true, isFeatured: !!spec.featured, onboardingStep: 6, onboardingCompleted: true,
    deliveryEnabled: spec.deliveryEnabled ?? true, pickupEnabled: true, whatsappOrdering: true, showPoweredBy: spec.subscription.plan === "FREE",
    orderNotes: spec.sector === "salon" || spec.sector === "clinique" ? "Votre rendez-vous est confirmé sur WhatsApp dans l'heure." : "Nous confirmons chaque commande sur WhatsApp avant préparation.",
    loyaltyConfig: hasLoyalty ? json({ enabled: true, pointsPer1000: isEur ? 5 : 10, rewardPoints: 300, rewardValue: isEur ? 500 : 2500 }) : Prisma.DbNull,
    metaPixelId: planFeatures.pixels && storeIndex % 2 === 0 ? `10${String(spec.seed).padStart(4, "0")}5512345678` : null,
  };
  const store = await db.store.upsert({ where: { slug: spec.slug }, create: { slug: spec.slug, createdAt, ...storeData }, update: { createdAt, ...storeData } });
  const storeId = store.id;

  await db.membership.upsert({ where: { userId_storeId: { userId: ownerId, storeId } }, create: { userId: ownerId, storeId, role: "OWNER", createdAt }, update: { role: "OWNER" } });
  if (ctx.staffId) await db.membership.upsert({ where: { userId_storeId: { userId: ctx.staffId, storeId } }, create: { userId: ctx.staffId, storeId, role: "STAFF" }, update: { role: "STAFF" } });

  // ── Nettoyage des données régénérées (ordre : dépendances d'abord)
  await db.conversation.deleteMany({ where: { storeId } });
  await db.review.deleteMany({ where: { storeId } });
  await db.loyaltyLedger.deleteMany({ where: { storeId } });
  await db.campaign.deleteMany({ where: { storeId } });
  await db.quickReply.deleteMany({ where: { storeId } });
  await db.storePage.deleteMany({ where: { storeId } });
  await db.creditLedger.deleteMany({ where: { storeId } });
  await db.addOnPurchase.deleteMany({ where: { storeId } });
  await db.invoice.deleteMany({ where: { subscription: { storeId } } });
  await db.order.deleteMany({ where: { storeId } });
  await db.customer.deleteMany({ where: { storeId } });
  await db.usageCounter.deleteMany({ where: { storeId } });

  // ── Catalogue
  const categoryIds = new Map<string, string>();
  for (const [i, name] of spec.categories.entries()) {
    const c = await db.category.upsert({ where: { storeId_slug: { storeId, slug: slugify(name) } }, create: { storeId, name, slug: slugify(name), position: i }, update: { name, position: i } });
    categoryIds.set(name, c.id);
  }
  await db.category.deleteMany({ where: { storeId, slug: { notIn: spec.categories.map(slugify) } } });

  type SeededProduct = { id: string; price: number; name: string; variants: { id: string; name: string; price: number }[]; options: { groupName: string; name: string; priceDelta: number; required: boolean }[] };
  const products: SeededProduct[] = [];
  for (const [i, p] of spec.products.entries()) {
    const slug = slugify(p.name);
    const data = {
      name: p.name, description: p.description, price: p.price, compareAtPrice: p.compareAtPrice ?? null,
      promoPrice: p.promo?.price ?? null, promoStart: p.promo?.start ?? null, promoEnd: p.promo?.end ?? null,
      trackStock: !!p.trackStock, stock: p.stock ?? (p.variants ? p.variants.reduce((s, v) => s + v.stock, 0) : 0),
      isFeatured: !!p.isFeatured, position: i, status: "ACTIVE" as const, categoryId: categoryIds.get(p.category) ?? null,
      images: json([photo(p.img, p.name)]), sku: `${spec.slug.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, "0")}`,
    };
    const prod = await db.product.upsert({ where: { storeId_slug: { storeId, slug } }, create: { storeId, slug, createdAt, ...data }, update: data });
    await db.variant.deleteMany({ where: { productId: prod.id } });
    await db.optionGroup.deleteMany({ where: { productId: prod.id } });
    const variants: SeededProduct["variants"] = [];
    for (const [vi, v] of (p.variants ?? []).entries()) {
      const name = Object.values(v.attributes).join(" / ");
      const created = await db.variant.create({ data: { productId: prod.id, name, attributes: json(v.attributes), price: v.price ?? null, stock: v.stock, position: vi, sku: `${data.sku}-${vi + 1}` } });
      variants.push({ id: created.id, name, price: v.price ?? p.price });
    }
    const options: SeededProduct["options"] = [];
    for (const [gi, g] of (p.options ?? []).entries()) {
      await db.optionGroup.create({
        data: {
          productId: prod.id, name: g.name, required: !!g.required, minSelect: g.required ? 1 : 0, maxSelect: g.maxSelect ?? 1, position: gi,
          options: { create: g.options.map((o, oi) => ({ name: o.name, priceDelta: o.priceDelta ?? 0, position: oi })) },
        },
      });
      for (const o of g.options) options.push({ groupName: g.name, name: o.name, priceDelta: o.priceDelta ?? 0, required: !!g.required });
    }
    products.push({ id: prod.id, price: p.price, name: p.name, variants, options });
  }
  // Anciens produits de démo absents du catalogue actuel (ex. SVG d'initiales de la v1)
  await db.product.deleteMany({ where: { storeId, slug: { notIn: spec.products.map((p) => slugify(p.name)) } } });

  // ── Livraison, retrait, paiement, coupon
  await db.deliveryZone.deleteMany({ where: { storeId } });
  const zones: { id: string; name: string; fee: number; freeAbove: number | null }[] = [];
  for (const [i, z] of spec.zones.entries()) {
    const created = await db.deliveryZone.create({ data: { storeId, name: z.name, fee: z.fee, freeAbove: z.freeAbove ?? null, etaLabel: z.etaLabel, position: i } });
    zones.push({ id: created.id, name: z.name, fee: z.fee, freeAbove: z.freeAbove ?? null });
  }
  await db.pickupSlot.deleteMany({ where: { storeId } });
  const slots: string[] = [];
  for (const s of spec.pickupSlots ?? []) {
    for (const day of s.days) {
      const created = await db.pickupSlot.create({ data: { storeId, dayOfWeek: day, startTime: s.start, endTime: s.end, capacity: s.capacity } });
      slots.push(created.id);
    }
  }
  await db.paymentMethod.deleteMany({ where: { storeId } });
  const cod = await db.paymentMethod.create({ data: { storeId, kind: "CASH_ON_DELIVERY", label: isEur ? "Paiement au retrait" : "Paiement à la livraison ou au retrait", instructions: isEur ? "Carte ou espèces à la boutique." : "Réglez en espèces à la réception.", position: 0 } });
  const manual: { id: string; label: string }[] = [];
  for (const [i, m] of spec.methods.entries()) {
    const created = await db.paymentMethod.create({
      data: { storeId, kind: m.kind, label: m.label, instructions: m.kind === "BANK_TRANSFER_MANUAL" ? `Virement sur l'IBAN ${m.number} (${m.name}), avec la référence de commande en libellé.` : `Envoyez le montant sur ${m.label} au ${m.number} (${m.name}), puis saisissez la référence de la transaction.`, accountNumber: m.number.replace(/\s/g, ""), accountName: m.name, position: i + 1 },
    });
    manual.push({ id: created.id, label: m.label });
  }
  await db.coupon.deleteMany({ where: { storeId } });
  const coupon = await db.coupon.create({ data: { storeId, code: spec.coupon.code, type: spec.coupon.type, value: spec.coupon.value, minSubtotal: spec.coupon.minSubtotal, maxUses: spec.coupon.maxUses ?? null, startsAt: createdAt, endsAt: addDays(now, 60), active: true } });

  // ── Clients
  const customers: { id: string; name: string; phone: string; email: string | null; address: string; points: number }[] = [];
  for (const c of spec.customers) {
    const phone = e164(c.local, spec.dialCode);
    const created = await db.customer.create({
      data: {
        storeId, name: c.name, phone, email: c.email ?? null, address: c.address, createdAt,
        tags: customers.length === 0 ? ["VIP"] : customers.length === 1 ? ["Grossiste"] : [],
        consents: { create: [{ channel: "WHATSAPP", purpose: "TRANSACTIONAL", granted: true, source: "checkout" }, ...(customers.length % 3 !== 2 ? [{ channel: "WHATSAPP" as const, purpose: "MARKETING" as const, granted: true, source: "checkout" }] : [])] },
      },
    });
    customers.push({ id: created.id, name: c.name, phone, email: c.email ?? null, address: c.address, points: 0 });
  }

  // ── Commandes sur 60 jours (au plus `createdDaysAgo` jours)
  const span = Math.min(59, spec.createdDaysAgo - 1);
  const usedRefs = new Set<string>();
  const ordersPerPeriod = new Map<string, number>();
  const paidOrders: { id: string; total: number; customerId: string; createdAt: Date; productIds: string[] }[] = [];
  const allowDelivery = zones.length > 0 && (spec.deliveryEnabled ?? true);
  const loyaltyRate = isEur ? 5 : 10;

  for (let i = 0; i < spec.orderCount; i++) {
    // Répartition : plus dense sur les jours récents (croissance)
    const t01 = Math.pow(i / Math.max(1, spec.orderCount - 1), 0.8);
    const ageDays = Math.max(0, Math.round(span - t01 * span));
    const createdAtOrder = daysAgo(ageDays, 8 + Math.floor(rand() * 12), Math.floor(rand() * 60));
    if (createdAtOrder > now) createdAtOrder.setTime(now.getTime() - 3600_000 * (1 + i));

    // Statut et paiement selon l'âge
    let status: OrderStatus;
    let payment: PaymentStatus;
    const r = rand();
    if (ageDays > 4) {
      if (r < 0.78) [status, payment] = ["DELIVERED", "PAID"];
      else if (r < 0.88) [status, payment] = ["CANCELLED", "UNPAID"];
      else if (r < 0.94) [status, payment] = ["REFUNDED", "REFUNDED"];
      else [status, payment] = ["DELIVERED", "PARTIALLY_REFUNDED"];
    } else {
      const fresh: [OrderStatus, PaymentStatus][] = [["NEW", "UNPAID"], ["NEW", "PENDING"], ["CONFIRMED", "PENDING"], ["CONFIRMED", "FAILED"], ["PREPARING", "PAID"], ["READY", "PAID"], ["OUT_FOR_DELIVERY", "UNPAID"], ["DELIVERED", "PAID"]];
      [status, payment] = fresh[Math.floor(r * fresh.length)]!;
    }
    const fulfillment: FulfillmentType = !allowDelivery ? (rand() < 0.75 ? "PICKUP" : "WHATSAPP") : pick(rand, ["DELIVERY", "DELIVERY", "DELIVERY", "PICKUP", "WHATSAPP"] as const);
    if (status === "OUT_FOR_DELIVERY" && fulfillment !== "DELIVERY") status = "READY";
    const useManual = manual.length > 0 && (payment === "PENDING" || payment === "FAILED" || rand() < 0.55);
    const method = useManual ? pick(rand, manual) : cod;
    const customer = pick(rand, customers);

    const nItems = 1 + Math.floor(rand() * Math.min(3, products.length));
    const items: Prisma.OrderItemCreateWithoutOrderInput[] = [];
    let subtotal = 0;
    const picked = new Set<number>();
    for (let k = 0; k < nItems; k++) {
      let idx = Math.floor(rand() * products.length);
      while (picked.has(idx)) idx = (idx + 1) % products.length;
      picked.add(idx);
      const p = products[idx]!;
      const quantity = 1 + Math.floor(rand() * 2);
      const variant = p.variants.length ? pick(rand, p.variants) : null;
      const chosen = p.options.filter((o) => o.required).reduce<typeof p.options>((acc, o) => (acc.some((a) => a.groupName === o.groupName) ? acc : [...acc, o]), []);
      const unitPrice = (variant?.price ?? p.price) + chosen.reduce((s, o) => s + o.priceDelta, 0);
      const lineTotal = unitPrice * quantity;
      subtotal += lineTotal;
      items.push({ name: p.name, variantName: variant?.name ?? null, options: chosen.length ? json(chosen.map((o) => ({ name: `${o.groupName} : ${o.name}`, priceDelta: o.priceDelta }))) : undefined, unitPrice, quantity, lineTotal, product: { connect: { id: p.id } }, ...(variant ? { variant: { connect: { id: variant.id } } } : {}) });
    }
    let discount = 0;
    let couponCode: string | null = null;
    const zone = fulfillment === "DELIVERY" ? pick(rand, zones) : null;
    let deliveryFee = zone ? (zone.freeAbove != null && subtotal >= zone.freeAbove ? 0 : zone.fee) : 0;
    if (i % 6 === 2 && subtotal >= spec.coupon.minSubtotal) {
      couponCode = spec.coupon.code;
      if (spec.coupon.type === "PERCENT") discount = Math.round((subtotal * spec.coupon.value) / 100);
      else if (spec.coupon.type === "FIXED") discount = Math.min(subtotal, spec.coupon.value);
      else if (deliveryFee > 0) deliveryFee = 0;
      else couponCode = null;
    }
    const total = Math.max(0, subtotal - discount + deliveryFee);
    let ref = reference(rand);
    while (usedRefs.has(ref)) ref = reference(rand);
    usedRefs.add(ref);
    const isMomo = method.id !== cod.id;
    const paymentReference = isMomo && payment !== "UNPAID" ? `MP${period(createdAtOrder).replace("-", "")}${String(createdAtOrder.getDate()).padStart(2, "0")}.${Math.floor(rand() * 9000 + 1000)}.${token(rand, 3).toUpperCase()}` : null;

    const path: OrderStatus[] = { NEW: ["NEW"], CONFIRMED: ["NEW", "CONFIRMED"], PREPARING: ["NEW", "CONFIRMED", "PREPARING"], READY: ["NEW", "CONFIRMED", "PREPARING", "READY"], OUT_FOR_DELIVERY: ["NEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"], DELIVERED: ["NEW", "CONFIRMED", "PREPARING", "READY", "DELIVERED"], CANCELLED: ["NEW", "CANCELLED"], REFUNDED: ["NEW", "CONFIRMED", "PREPARING", "READY", "DELIVERED", "REFUNDED"] }[status] as OrderStatus[];
    const channelLabel = fulfillment === "WHATSAPP" ? "WhatsApp" : fulfillment === "PICKUP" ? "retrait" : "livraison";
    const events: Prisma.OrderEventUncheckedCreateWithoutOrderInput[] = [{ actorLabel: "Client", type: "status_changed", toValue: "NEW", message: `Commande passée via la boutique (${channelLabel})`, createdAt: createdAtOrder }];
    let t = createdAtOrder;
    for (let s = 1; s < path.length; s++) {
      t = addMinutes(t, 20 + Math.floor(rand() * 180));
      events.push({ actorId: ownerId, actorLabel: ownerName, type: "status_changed", fromValue: path[s - 1], toValue: path[s], message: path[s] === "CANCELLED" ? "Client injoignable" : null, createdAt: t });
    }
    if (t > now) t = new Date(now.getTime() - 60_000);
    const wasPaid = payment === "PAID" || payment === "REFUNDED" || payment === "PARTIALLY_REFUNDED";
    if (wasPaid) events.push({ actorId: ownerId, actorLabel: ownerName, type: "payment_changed", fromValue: isMomo ? "PENDING" : "UNPAID", toValue: "PAID", message: isMomo ? `Référence ${paymentReference} vérifiée` : "Espèces reçues", createdAt: addMinutes(t, 5) });
    const refundAmount = payment === "REFUNDED" ? total : payment === "PARTIALLY_REFUNDED" ? Math.round(total * 0.3) : 0;
    if (refundAmount) events.push({ actorId: ownerId, actorLabel: ownerName, type: "payment_changed", fromValue: "PAID", toValue: payment, message: payment === "REFUNDED" ? "Article défectueux, remboursement intégral" : "Geste commercial, remboursement partiel", createdAt: addMinutes(t, 60) });
    if (payment === "FAILED") events.push({ actorId: ownerId, actorLabel: ownerName, type: "payment_changed", fromValue: "PENDING", toValue: "FAILED", message: "Référence Mobile Money introuvable", createdAt: addMinutes(t, 30) });
    const attemptStatus = wasPaid ? "CONFIRMED" : payment === "PENDING" ? "PENDING" : payment === "FAILED" ? "FAILED" : null;

    const order = await db.order.create({
      data: {
        storeId, customerId: customer.id, reference: ref, idempotencyKey: `seed-${spec.slug}-${i}`, trackingToken: token(rand), trackingExpiresAt: addDays(createdAtOrder, 90),
        status, paymentStatus: payment, fulfillmentType: fulfillment, channel: fulfillment === "WHATSAPP" ? "WHATSAPP" : "STORE",
        customerName: customer.name, customerPhone: customer.phone, customerEmail: customer.email, deliveryAddress: zone ? customer.address : null, deliveryZoneId: zone?.id ?? null, deliveryZoneName: zone?.name ?? null,
        pickupSlotId: fulfillment === "PICKUP" && slots.length ? pick(rand, slots) : null,
        customerNote: i % 5 === 0 ? (spec.sector === "salon" || spec.sector === "clinique" ? "Merci de me rappeler pour confirmer l'heure." : "Merci d'appeler avant de livrer.") : null,
        currency: spec.currency, subtotal, discount, deliveryFee, total, couponCode,
        paymentMethodId: method.id, paymentMethodLabel: method.label, paymentReference,
        createdAt: createdAtOrder, updatedAt: t,
        confirmedAt: path.includes("CONFIRMED") ? events[1]?.createdAt ?? null : null,
        deliveredAt: path.includes("DELIVERED") ? events.find((e) => e.toValue === "DELIVERED")?.createdAt ?? null : null,
        cancelledAt: status === "CANCELLED" ? t : null,
        items: { create: items },
        events: { create: events },
        ...(attemptStatus ? { paymentAttempts: { create: [{ provider: isMomo ? "manual" : "cash", status: attemptStatus, amount: total, currency: spec.currency, customerRef: paymentReference, verifiedBy: attemptStatus === "CONFIRMED" ? ownerId : null, verifiedAt: attemptStatus === "CONFIRMED" ? t : null, failureReason: attemptStatus === "FAILED" ? "Référence Mobile Money introuvable" : null, paymentMethodId: method.id, createdAt: createdAtOrder }] } } : {}),
        ...(couponCode ? { couponRedemptions: { create: [{ couponId: coupon.id, phone: customer.phone, amount: discount, createdAt: createdAtOrder }] } } : {}),
        ...(refundAmount ? { refunds: { create: [{ amount: refundAmount, reason: payment === "REFUNDED" ? "Article défectueux" : "Geste commercial", status: "DONE", actorId: ownerId, doneAt: t }] } } : {}),
      },
    });

    if (status !== "CANCELLED") {
      await db.customer.update({ where: { id: customer.id }, data: { ordersCount: { increment: 1 }, totalSpent: { increment: wasPaid ? total - refundAmount : 0 }, lastOrderAt: createdAtOrder } });
    }
    if (status === "DELIVERED" && payment === "PAID") paidOrders.push({ id: order.id, total, customerId: customer.id, createdAt: createdAtOrder, productIds: [...picked].map((ix) => products[ix]!.id) });
    const per = period(createdAtOrder);
    ordersPerPeriod.set(per, (ordersPerPeriod.get(per) ?? 0) + 1);
  }
  const couponUses = await db.couponRedemption.count({ where: { couponId: coupon.id } });
  await db.coupon.update({ where: { id: coupon.id }, data: { usesCount: couponUses } });

  // ── Fidélité (points gagnés sur les commandes livrées et payées, une récompense utilisée)
  if (hasLoyalty) {
    const ledger: Prisma.LoyaltyLedgerCreateManyInput[] = [];
    for (const o of paidOrders) {
      const pts = Math.floor(o.total / 1000) * loyaltyRate;
      if (pts <= 0) continue;
      ledger.push({ storeId, customerId: o.customerId, delta: pts, reason: "order", orderId: o.id, createdAt: o.createdAt });
      const c = customers.find((x) => x.id === o.customerId)!;
      c.points += pts;
    }
    const rich = customers.find((c) => c.points >= 300);
    if (rich) {
      ledger.push({ storeId, customerId: rich.id, delta: -300, reason: "reward", createdAt: daysAgo(3, 15) });
      rich.points -= 300;
    }
    if (ledger.length) await db.loyaltyLedger.createMany({ data: ledger });
    for (const c of customers) if (c.points) await db.customer.update({ where: { id: c.id }, data: { loyaltyPoints: c.points } });
  }

  // ── Abonnement et factures (zone/devise cohérentes avec la boutique)
  const zone = zoneForCurrency(spec.currency);
  const currency = ZONE_CURRENCY[zone];
  const sub = spec.subscription;
  const price = planPrice(sub.plan, zone, sub.interval).amount ?? 0;
  const periodLen = sub.interval === "YEARLY" ? 12 : 1;
  let periodStart: Date;
  let periodEnd: Date | null;
  if (sub.status === "TRIALING") {
    periodStart = daysAgo(sub.trialStartedDaysAgo ?? 0, 9, 0);
    periodEnd = addDays(periodStart, 14);
  } else if (sub.plan === "FREE") {
    periodStart = createdAt;
    periodEnd = null;
  } else if (sub.status === "PAST_DUE") {
    periodStart = addMonths(daysAgo(4, 0, 0), -1);
    periodEnd = daysAgo(4, 0, 0);
  } else {
    periodStart = sub.renewalOpen ? addDays(addMonths(now, -1), 2) : daysAgo(sub.interval === "YEARLY" ? 35 : 12, 0, 0);
    periodStart.setHours(0, 0, 0, 0);
    periodEnd = addMonths(periodStart, periodLen);
  }
  const subData = {
    planId: sub.plan as DbPlanId, zone, currency, status: sub.status, interval: sub.interval,
    trialEndsAt: sub.status === "TRIALING" ? periodEnd : null, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false,
    provider: sub.plan === "FREE" || sub.status === "TRIALING" ? null : "manual",
  };
  const subscription = await db.subscription.upsert({ where: { storeId }, create: { storeId, createdAt, ...subData }, update: subData });

  let invoiceSeq = 0;
  const invoiceNumber = (d: Date) => `AXI-${d.getFullYear()}-D${String(storeIndex + 1).padStart(2, "0")}${String(++invoiceSeq).padStart(2, "0")}`;
  const createInvoice = (data: { amount: number; status: "PAID" | "OPEN"; periodStart: Date; periodEnd: Date; dueAt: Date; paidAt?: Date | null; planId?: DbPlanId; providerRef?: string | null }) =>
    db.invoice.create({
      data: { subscriptionId: subscription.id, number: invoiceNumber(data.periodStart), planId: data.planId ?? (sub.plan as DbPlanId), amount: data.amount, currency, status: data.status, periodStart: data.periodStart, periodEnd: data.periodEnd, dueAt: data.dueAt, paidAt: data.paidAt ?? null, providerRef: data.providerRef ?? null, createdAt: addDays(data.periodStart, -3) },
    });
  if (price > 0 && sub.status !== "TRIALING") {
    if (sub.interval === "MONTHLY") {
      // Période précédente et période en cours, toutes deux réglées (sauf impayé)
      const prevStart = addMonths(periodStart, -1);
      await createInvoice({ amount: price, status: "PAID", periodStart: prevStart, periodEnd: periodStart, dueAt: addDays(prevStart, 7), paidAt: addDays(prevStart, 1), providerRef: `MP-${spec.slug.slice(0, 4).toUpperCase()}-${invoiceSeq + 1}` });
      if (sub.status === "PAST_DUE") {
        await createInvoice({ amount: price, status: "OPEN", periodStart: periodEnd!, periodEnd: addMonths(periodEnd!, 1), dueAt: addDays(periodEnd!, -1) });
      } else {
        await createInvoice({ amount: price, status: "PAID", periodStart, periodEnd: periodEnd!, dueAt: addDays(periodStart, 7), paidAt: addDays(periodStart, 0), providerRef: `MP-${spec.slug.slice(0, 4).toUpperCase()}-${invoiceSeq + 1}` });
        if (sub.renewalOpen) await createInvoice({ amount: price, status: "OPEN", periodStart: periodEnd!, periodEnd: addMonths(periodEnd!, 1), dueAt: addDays(periodEnd!, 7) });
      }
    } else {
      await createInvoice({ amount: price, status: "PAID", periodStart, periodEnd: periodEnd!, dueAt: addDays(periodStart, 7), paidAt: addDays(periodStart, 1), providerRef: `VIR-${spec.slug.slice(0, 4).toUpperCase()}-${invoiceSeq + 1}` });
    }
  }

  // ── Options achetées (AddOnPurchase + facture liée) et portefeuille de crédits
  const credit: Prisma.CreditLedgerCreateManyInput[] = [];
  const waUsageByPeriod = new Map<string, number>();
  const aiUsageByPeriod = new Map<string, number>();
  const bump = (m: Map<string, number>, d: Date, n: number) => m.set(utcPeriod(d), (m.get(utcPeriod(d)) ?? 0) + n);
  const packs = new Map<string, { id: string; expiresAt: Date; amount: number; boughtAt: Date }>();

  for (const a of spec.addOns ?? []) {
    const addOn = getAddOn(a.id)!;
    const quantity = a.quantity ?? 1;
    const unitPrice = addOn.price[zone];
    const startsAt = daysAgo(a.daysAgo, 11, 0);
    const endsAt = a.status !== "ACTIVE" ? null : addOn.billing === "MONTHLY" ? addMonths(startsAt, 1) : addOn.billing === "YEARLY" ? addMonths(startsAt, 12) : null;
    const invoice = await createInvoice({
      amount: unitPrice * quantity, status: a.status === "ACTIVE" ? "PAID" : "OPEN",
      periodStart: startsAt, periodEnd: endsAt ?? startsAt, dueAt: addDays(startsAt, 7), paidAt: a.status === "ACTIVE" ? addMinutes(startsAt, 40) : null,
      providerRef: a.status === "ACTIVE" ? `MP-OPT-${a.id.slice(0, 6)}-${storeIndex + 1}` : null,
    });
    const purchase = await db.addOnPurchase.create({ data: { storeId, addOnId: a.id, quantity, unitPrice, currency, status: a.status, invoiceId: invoice.id, startsAt, endsAt, createdAt: startsAt } });
    if (a.status === "ACTIVE" && addOn.billing === "PACK" && addOn.credits) {
      const expiresAt = addMonths(startsAt, 12);
      const amount = addOn.credits.amount * quantity;
      credit.push({ storeId, type: addOn.credits.type, delta: amount, reason: "pack_purchase", reference: purchase.id, expiresAt, createdAt: startsAt });
      packs.set(addOn.credits.type, { id: purchase.id, expiresAt, amount, boughtAt: startsAt });
    }
  }

  // Crédits inclus du plan : mois précédent (expiré) et mois courant, avec consommations FIFO
  const limits = PLANS[sub.plan].limits;
  const thisMonthStart = firstOfMonthUtc(now);
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const daysThisMonth = Math.max(1, now.getUTCDate());
  const monthly: { type: "WA_UTILITY" | "AI"; amount: number | null }[] = [
    { type: "WA_UTILITY", amount: limits.whatsappMessagesPerMonth },
    { type: "AI", amount: limits.aiCreditsPerMonth },
  ];
  for (const { type, amount } of monthly) {
    if (!amount) continue;
    // Mois précédent : seulement si la boutique existait déjà et payait (pas en essai)
    if (createdAt < prevMonthStart && sub.status !== "TRIALING") {
      const used = Math.round(amount * (0.55 + rand() * 0.35));
      credit.push({ storeId, type, delta: amount, reason: "plan_monthly", reference: `plan_monthly:${utcPeriod(prevMonthStart)}`, expiresAt: thisMonthStart, createdAt: prevMonthStart });
      const chunks = 6;
      for (let k = 0; k < chunks; k++) {
        const n = k === chunks - 1 ? used - Math.floor(used / chunks) * (chunks - 1) : Math.floor(used / chunks);
        const d = new Date(prevMonthStart.getTime() + (k * 4 + 2) * 86_400_000 + 10 * 3600_000);
        credit.push({ storeId, type, delta: -n, reason: "usage", reference: type === "AI" ? `ai:description:${k}` : `wa:notification:${k}`, expiresAt: thisMonthStart, createdAt: d });
      }
      bump(type === "AI" ? aiUsageByPeriod : waUsageByPeriod, prevMonthStart, used);
    }
    const expiresAt = firstOfNextMonthUtc(now);
    credit.push({ storeId, type, delta: amount, reason: "plan_monthly", reference: `plan_monthly:${utcPeriod(now)}`, expiresAt, createdAt: thisMonthStart > createdAt ? thisMonthStart : createdAt });
    const ratio = (daysThisMonth / 30) * (type === "AI" ? 0.7 : 0.9);
    const used = Math.min(amount - 5, Math.round(amount * Math.min(0.95, ratio + rand() * 0.15)));
    const chunks = Math.min(daysThisMonth, 5);
    for (let k = 0; k < chunks && used > 0; k++) {
      const n = k === chunks - 1 ? used - Math.floor(used / chunks) * (chunks - 1) : Math.floor(used / chunks);
      const day = Math.min(daysThisMonth - 1, Math.floor((k * daysThisMonth) / chunks));
      const d = new Date(thisMonthStart.getTime() + day * 86_400_000 + (9 + k) * 3600_000);
      credit.push({ storeId, type, delta: -n, reason: "usage", reference: type === "AI" ? `ai:reply:${k}` : `wa:order_update:${k}`, expiresAt, createdAt: d < createdAt ? createdAt : d });
    }
    bump(type === "AI" ? aiUsageByPeriod : waUsageByPeriod, now, used);
  }
  // Pack IA : une partie consommée (traductions du catalogue)
  const aiPack = packs.get("AI");
  if (aiPack) {
    const d = addDays(aiPack.boughtAt, 3);
    credit.push({ storeId, type: "AI", delta: -240, reason: "usage", reference: "ai:translation:catalog", expiresAt: aiPack.expiresAt, createdAt: d });
    bump(aiUsageByPeriod, d, 240);
  }

  // ── Réponses rapides, campagnes (envoyée = crédits marketing consommés), pages
  if (hasInbox) {
    await db.quickReply.createMany({
      data: [
        { storeId, shortcut: "bonjour", body: `Bonjour et bienvenue chez ${spec.name} ! Comment pouvons-nous vous aider ?` },
        { storeId, shortcut: "livraison", body: spec.zones.length ? `Nous livrons : ${spec.zones.map((z) => `${z.name} (${fmt(z.fee)}, ${z.etaLabel.toLowerCase()})`).join(" ; ")}.` : "Les prestations ont lieu sur place, à l'adresse indiquée sur notre boutique." },
        { storeId, shortcut: "paiement", body: `Vous pouvez payer par ${spec.methods.map((m) => m.label).join(", ")} ou ${isEur ? "au retrait" : "à la livraison"}.` },
        { storeId, shortcut: "merci", body: "Merci pour votre commande ! Laissez-nous un avis, cela aide beaucoup notre boutique." },
      ],
    });
  }
  if (planFeatures.campaigns) {
    const marketingConsent = customers.length;
    await db.campaign.create({ data: { storeId, name: "Relance des clients inactifs", segment: json({ kind: "inactive" }), message: `Bonjour {prenom}, cela fait un moment ! Profitez de ${spec.coupon.code} sur votre prochaine commande chez ${spec.name}.`, status: "DRAFT", recipients: 0, createdAt: daysAgo(2, 16) } });
    await db.campaign.create({ data: { storeId, name: "Nouveautés de la semaine", segment: json({ kind: "loyal" }), message: `Nos nouveautés sont en ligne : ${spec.products.slice(0, 2).map((p) => p.name).join(", ")}. Commandez sur https://axi.africa/s/${spec.slug}`, status: "SCHEDULED", recipients: Math.max(1, marketingConsent - 2), scheduledAt: addDays(now, 3), createdAt: daysAgo(1, 11) } });
    const mk = packs.get("WA_MARKETING");
    if (mk) {
      const sentAt = addDays(mk.boughtAt, 2);
      const recipients = 140 + Math.floor(rand() * 40);
      const failed = 3 + Math.floor(rand() * 5);
      const sent = recipients - failed;
      const orders = 6 + Math.floor(rand() * 8);
      const avg = isEur ? 2600 : 9000;
      const camp = await db.campaign.create({
        data: { storeId, name: "Offre spéciale fin de mois", segment: json({ kind: "all" }), message: `Jusqu'à dimanche, ${spec.coupon.code} vous offre une réduction sur toute la boutique ${spec.name}. Commandez en 2 minutes sur WhatsApp.`, status: "SENT", recipients, sentCount: sent, failedCount: failed, clicks: Math.round(sent * 0.31), ordersAttributed: orders, revenueAttributed: orders * avg, creditsUsed: sent, scheduledAt: sentAt, sentAt, createdAt: addDays(sentAt, -1) },
      });
      credit.push({ storeId, type: "WA_MARKETING", delta: -sent, reason: "usage", reference: `campaign:${camp.id}`, expiresAt: mk.expiresAt, createdAt: sentAt });
      bump(waUsageByPeriod, sentAt, sent);
    }
  }
  if (credit.length) await db.creditLedger.createMany({ data: credit });

  await db.storePage.createMany({
    data: [
      { storeId, slug: "a-propos", title: "À propos", body: spec.about, position: 0 },
      { storeId, slug: "faq", title: "Questions fréquentes", body: spec.faq.map(([q, a]) => `${q}\n${a}`).join("\n\n"), position: 1 },
    ],
  });

  // ── Conversations WhatsApp (boîte partagée + entonnoir)
  if (hasInbox) {
    const scripts = conversationScripts(spec, spec.products.map((p) => ({ name: p.name, price: p.promo?.price ?? p.price })), fmt);
    for (const [ci, script] of scripts.entries()) {
      const c = customers[ci % customers.length]!;
      const start = daysAgo(ci === 0 ? 0 : ci * 2 + 1, 9 + ci, 5);
      if (start > now) start.setTime(now.getTime() - 2 * 3600_000);
      let at = start;
      const msgs: Prisma.MessageCreateWithoutConversationInput[] = [];
      for (const [li, line] of script.lines.entries()) {
        at = addMinutes(at, li === 0 ? 0 : 4 + Math.floor(rand() * 25));
        if (at > now) at = new Date(now.getTime() - (script.lines.length - li) * 60_000);
        msgs.push({
          direction: line.dir, body: line.body, createdAt: at,
          status: line.dir === "INBOUND" ? "RECEIVED" : line.dir === "NOTE" ? "SENT" : li === script.lines.length - 1 ? "DELIVERED" : "READ",
          ...(line.dir !== "INBOUND" ? { author: { connect: { id: ownerId } } } : {}),
          ...(script.stage === "PAID" && li === 0 && paidOrders[0] ? { orderId: paidOrders[paidOrders.length - 1]!.id } : {}),
        });
      }
      const last = msgs[msgs.length - 1]!;
      const p0 = spec.products[ci % spec.products.length]!;
      await db.conversation.create({
        data: {
          storeId, customerId: c.id, phone: c.phone, name: c.name, channel: ci === 5 ? "instagram" : "whatsapp", status: script.status, stage: script.stage, labels: script.labels,
          assignedToId: ci % 2 === 0 ? ownerId : ctx.staffId ?? ownerId, unreadCount: script.unread, lastMessageAt: last.createdAt as Date, lastPreview: last.body.slice(0, 120),
          estimatedValue: script.stage === "LOST" ? null : p0.price * (script.stage === "ORDERING" ? 2 : 1), createdAt: start,
          messages: { create: msgs },
        },
      });
    }
  }

  // ── Avis clients (approuvés, en attente, une réponse du marchand)
  const reviewData: Prisma.ReviewCreateManyInput[] = [];
  const nReviews = Math.min(5, customers.length);
  for (let k = 0; k < nReviews; k++) {
    // Avis rattaché à une commande livrée et payée, sur un produit de cette commande (unique par commande et produit)
    const ord = paidOrders[paidOrders.length - 1 - k];
    const productId = ord?.productIds[0] ?? products[k % products.length]!.id;
    const pending = k >= nReviews - (hasInbox ? 2 : 1);
    reviewData.push({
      storeId, productId, orderId: ord?.id ?? null, customerName: ord ? customers.find((c) => c.id === ord.customerId)!.name : customers[k]!.name,
      rating: k === 3 ? 3 : k === 2 ? 4 : 5, body: REVIEW_BODIES[k % REVIEW_BODIES.length]!(spec.voice.item), status: pending ? "PENDING" : "APPROVED",
      reply: k === 0 ? "Merci beaucoup pour votre confiance, à très bientôt !" : null, createdAt: daysAgo(2 + k * 6, 18),
    });
  }
  await db.review.createMany({ data: reviewData });

  // ── Compteurs d'usage cohérents avec commandes et crédits
  const counters: Prisma.UsageCounterCreateManyInput[] = [];
  for (const [per, value] of ordersPerPeriod) counters.push({ storeId, metric: "orders", period: per, value });
  for (const [per, value] of waUsageByPeriod) counters.push({ storeId, metric: "whatsapp_messages", period: per, value });
  for (const [per, value] of aiUsageByPeriod) counters.push({ storeId, metric: "ai_credits", period: per, value });
  await db.usageCounter.createMany({ data: counters });

  // ── Journal d'audit (ajouté une seule fois par action)
  const once = async (action: string, data: Omit<Prisma.AuditLogUncheckedCreateInput, "action" | "storeId">) => {
    const exists = await db.auditLog.findFirst({ where: { storeId, action, ...(data.target ? { target: data.target } : {}) }, select: { id: true } });
    if (!exists) await db.auditLog.create({ data: { storeId, action, ...data } });
  };
  await once("store.created", { actorId: ownerId, metadata: { slug: spec.slug }, createdAt });
  await once("store.published", { actorId: ownerId, metadata: { slug: spec.slug }, createdAt: publishedAt });
  if (sub.plan !== "FREE" && sub.status !== "TRIALING") await once("subscription.changed", { actorId: ownerId, metadata: { from: "BUSINESS", to: sub.plan, interval: sub.interval, trial: "converted" }, createdAt: addDays(createdAt, 14) });
  for (const a of spec.addOns ?? []) if (a.status === "ACTIVE") await once("addon.activated", { actorId: ctx.adminId, target: a.id, metadata: { addOnId: a.id, via: "admin.invoice.marked_paid" }, createdAt: daysAgo(a.daysAgo, 12) });
  if (spec.featured) await once("admin.store.featured_toggled", { actorId: ctx.adminId, target: storeId, metadata: { isFeatured: true }, createdAt: daysAgo(20, 15) });

  return { store, subscriptionId: subscription.id };
}

// ───────────────────────────── tickets et ajustements admin ─────────────────────────────

async function seedSupport(storeIds: Map<string, string>, users: Map<string, { id: string; name: string }>, adminId: string) {
  const tickets = [
    { slug: "chez-aicha", email: DEMO_EMAIL, subject: "Comment activer MTN MoMo automatique ?", message: "Bonjour, je voudrais que les paiements MoMo soient confirmés automatiquement sans saisir la référence. Est-ce possible avec le plan Business ?", status: "OPEN" as const },
    { slug: "chez-aicha", email: DEMO_EMAIL, subject: "Changer le numéro WhatsApp de ma boutique", message: "J'ai changé de numéro. Où puis-je le modifier ? Merci.", status: "RESOLVED" as const },
    { slug: "salon-belle-tresse", email: "akossiwa@belle-tresse.demo", subject: "Paiement de mon abonnement Starter", message: "Bonjour, j'ai envoyé 5 000 FCFA par Flooz hier pour mon abonnement. Référence FL2610.4471. Merci de vérifier.", status: "PENDING" as const },
    { slug: "saveurs-afrique-paris", email: "awa@saveurs-afrique.demo", subject: "Connexion de mon deuxième numéro WhatsApp", message: "J'ai acheté l'option numéro WhatsApp en plus. Quelles sont les étapes pour connecter le numéro de la boutique ?", status: "OPEN" as const },
    { slug: "atelier-beaute-nafi", email: "nafi@atelier-beaute-nafi.demo", subject: "Domaine nafi-beaute.sn non vérifié", message: "Le domaine acheté via Axi affiche « en attente » depuis deux jours. Pouvez-vous regarder ?", status: "RESOLVED" as const },
  ];
  for (const t of tickets) {
    const storeId = storeIds.get(t.slug) ?? null;
    const exists = await db.supportTicket.findFirst({ where: { email: t.email, subject: t.subject } });
    if (!exists) await db.supportTicket.create({ data: { storeId, userId: users.get(t.email)?.id ?? null, email: t.email, subject: t.subject, message: t.message, status: t.status } });
  }

  // Geste commercial audité : +100 messages utilitaires sans échéance au Maquis (panne WhatsApp)
  const maquis = storeIds.get("maquis-tanti-rosine");
  if (maquis) {
    const reference = "admin:geste-panne-whatsapp";
    await db.creditLedger.create({ data: { storeId: maquis, type: "WA_UTILITY", delta: 100, reason: "admin", reference, expiresAt: null, createdAt: daysAgo(6, 14) } });
    const exists = await db.auditLog.findFirst({ where: { storeId: maquis, action: "admin.credits.adjusted" } });
    if (!exists) await db.auditLog.create({ data: { storeId: maquis, actorId: adminId, action: "admin.credits.adjusted", target: maquis, metadata: { type: "WA_UTILITY", delta: 100, reason: "Geste commercial après la panne WhatsApp du 4 octobre" }, createdAt: daysAgo(6, 14) } });
  }
}

// ───────────────────────────── Lot 1 : remises automatiques, carte cadeau, retours ─────────────────────────────

/** Code de la carte cadeau de démonstration (Crockford base32 sans I, L, O, U ; affiché XXXX-XXXX-XXXX-XXXX). */
const DEMO_GIFT_CARD_CODE = "KD7M4XQ29PRTH3VW";

/**
 * Secrets d'une carte cadeau, calculés ici car src/lib/crypto.ts est `server-only` (non importable par le seed).
 *  - codeHash = HMAC-SHA256(clé, `${storeId}:${code}`) en hex, avec clé = HMAC-SHA256(APP_SECRET, "giftcard")
 *    (contrat à respecter par src/lib/giftcards/code.ts, équipe C) ;
 *  - codeEnc  = même format que encryptSecret : `v1.iv.tag.enc` (AES-256-GCM, clé sha256(APP_SECRET)).
 * Sans APP_SECRET valide, la carte n'est pas créée (le reste du seed continue).
 */
function demoGiftCardSecrets(storeId: string, code: string): { codeHash: string; codeEnc: string } | null {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) return null;
  const key = createHmac("sha256", secret).update("giftcard").digest();
  const codeHash = createHmac("sha256", key).update(`${storeId}:${code}`).digest("hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const enc = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return { codeHash, codeEnc: `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${enc.toString("base64url")}` };
}

/**
 * Données de démonstration du lot 1 (docs/specs/LOT-1-ventes-fidelite.md), régénérées à chaque run :
 *  - Dantokpa Mode (Business) : « 2 accessoires achetés = 1 offert », −15 % sur la collection Femme,
 *    politique de retours activée, une carte cadeau de 25 000 FCFA ;
 *    une offre au panier « Complétez la tenue », un produit carte cadeau (10 000 / 25 000 / 50 000 FCFA), 5 000 FCFA
 *    d'avoir pour Nadège Dossou et un retour en attente (RT-DEMO01) sur la dernière commande livrée ;
 *  - Chez Aïcha (Business) : paliers de panier, plus une remise expirée (statut « expirée » dans la liste).
 * Les configurations suivent le §2 de la spécification (validées plus tard par src/lib/discounts/schema.ts).
 */
async function seedLot1(storeIds: Map<string, string>, users: Map<string, { id: string; name: string }>) {
  const mode = storeIds.get("dantokpa-mode");
  const aicha = storeIds.get("chez-aicha");
  for (const storeId of [mode, aicha]) {
    if (!storeId) continue;
    await db.automaticDiscount.deleteMany({ where: { storeId } });
    await db.giftCard.deleteMany({ where: { storeId } });
  }
  const collection = async (storeId: string, name: string) =>
    (await db.category.findUnique({ where: { storeId_slug: { storeId, slug: slugify(name) } }, select: { id: true } }))?.id;

  if (mode) {
    const femme = await collection(mode, "Femme");
    const accessoires = await collection(mode, "Accessoires");
    const startsAt = daysAgo(3, 0, 0);
    const endsAt = addDays(now, 30);
    if (accessoires) {
      await db.automaticDiscount.create({
        data: {
          storeId: mode, title: "2 accessoires achetés = 1 offert", kind: "BUY_X_GET_Y", priority: 10, startsAt, endsAt,
          config: json({
            buy: { target: { collectionIds: [accessoires] }, quantity: 2 },
            get: { target: { collectionIds: [accessoires] }, quantity: 1, value: { type: "PERCENT", amount: 100 } },
            maxApplicationsPerOrder: 2,
            excludeOnSale: true,
          }),
        },
      });
    }
    if (femme) {
      await db.automaticDiscount.create({
        data: {
          storeId: mode, title: "−15 % sur la collection Femme", kind: "PRODUCT_AMOUNT", priority: 0, startsAt, endsAt,
          combinesWithCoupons: false, maxUses: 200,
          config: json({ target: { collectionIds: [femme] }, value: { type: "PERCENT", amount: 15 }, perUnit: false, excludeOnSale: true }),
        },
      });
    }

    await db.store.update({
      where: { id: mode },
      data: {
        returnPolicy: json({
          enabled: true, windowDays: 7, allowRefund: true, allowStoreCredit: true, allowExchange: true,
          storeCreditBonusPercent: 10, restockingFeePercent: 0, nonReturnableTags: [], requirePhotos: false, returnShippingPaidBy: "customer",
          instructions: "Rapportez l'article non porté, avec son étiquette, à la boutique de Dantokpa (stand 214) ou remettez-le au livreur. Échange de taille gratuit.",
        }),
      },
    });

    const secrets = demoGiftCardSecrets(mode, DEMO_GIFT_CARD_CODE);
    if (secrets) {
      const owner = users.get(DEMO_EMAIL);
      const customer = await db.customer.findFirst({ where: { storeId: mode, name: "Grâce Hounkpatin" }, select: { id: true, name: true, phone: true } });
      const issuedAt = daysAgo(12, 11, 0);
      const value = 25_000;
      await db.giftCard.create({
        data: {
          storeId: mode, ...secrets, last4: DEMO_GIFT_CARD_CODE.slice(-4), currency: "XOF", initialValue: value, balance: value,
          status: "ACTIVE", source: "MANUAL", expiresAt: addDays(issuedAt, 365), customerId: customer?.id ?? null,
          recipientName: customer?.name ?? null, recipientPhone: customer?.phone ?? null, message: "Joyeux anniversaire Grâce !",
          deliveredAt: issuedAt, createdById: owner?.id ?? null, createdAt: issuedAt,
          transactions: { create: { storeId: mode, kind: "ISSUE", amount: value, balanceAfter: value, actorId: owner?.id ?? null, note: "Carte de démonstration", createdAt: issuedAt } },
        },
      });
    } else {
      console.warn("  lot 1 : APP_SECRET absent ou trop court, carte cadeau de démonstration non créée");
    }

    // Offre au panier : vente croisée « Complétez la tenue » (déclencheur : collection Femme).
    await db.cartOffer.deleteMany({ where: { storeId: mode } });
    const productId = async (name: string) => (await db.product.findUnique({ where: { storeId_slug: { storeId: mode, slug: slugify(name) } }, select: { id: true } }))?.id;
    const offered = (await Promise.all(["Collier de perles", "Sac à main cuir et wax"].map(productId))).filter((id): id is string => !!id);
    if (femme && offered.length) {
      await db.cartOffer.create({ data: { storeId: mode, title: "Complétez la tenue", placement: "CART", mode: "add", triggerCollectionIds: [femme], offerProductIds: offered, position: 0 } });
    }

    // Produit carte cadeau : une variante par valeur faciale (prix = valeur), sans suivi de stock.
    // Recréé à chaque run (seedStore supprime les produits absents du catalogue de la boutique).
    const giftData = {
      name: "Carte cadeau Dantokpa Mode", description: "Offrez le choix : la carte est envoyée au destinataire dès le paiement confirmé, valable un an.",
      price: 10_000, trackStock: false, stock: 0, status: "ACTIVE" as const, isGiftCard: true, giftCardValidityDays: 365, position: 99, images: json([]),
    };
    const giftProduct = await db.product.upsert({ where: { storeId_slug: { storeId: mode, slug: "carte-cadeau" } }, create: { storeId: mode, slug: "carte-cadeau", ...giftData }, update: giftData });
    await db.variant.deleteMany({ where: { productId: giftProduct.id } });
    for (const [i, value] of [10_000, 25_000, 50_000].entries()) {
      const label = `${value.toLocaleString("fr-FR").replace(/\s/g, " ")} FCFA`;
      await db.variant.create({ data: { productId: giftProduct.id, name: label, attributes: json({ Montant: label }), price: value, stock: 0, inventoryPolicy: "CONTINUE", position: i } });
    }

    // Avoir sur un client démo (geste commercial). Les clients sont recréés par seedStore : journal repart de zéro.
    const nadege = await db.customer.findFirst({ where: { storeId: mode, name: "Nadège Dossou" }, select: { id: true } });
    if (nadege) {
      const owner = users.get(DEMO_EMAIL);
      await db.storeCreditTransaction.deleteMany({ where: { storeId: mode, customerId: nadege.id } });
      await db.customer.update({ where: { id: nadege.id }, data: { storeCreditBalance: 5_000 } });
      await db.storeCreditTransaction.create({
        data: { storeId: mode, customerId: nadege.id, kind: "GRANT", amount: 5_000, balanceAfter: 5_000, actorId: owner?.id ?? null, note: "Geste commercial : retard de livraison", createdAt: daysAgo(4, 15, 0) },
      });
    }

    // Retour en cours : demande de l'acheteur (REQUESTED) sur la dernière commande livrée d'un client.
    await db.returnRequest.deleteMany({ where: { storeId: mode } });
    const delivered = await db.order.findFirst({
      where: { storeId: mode, status: "DELIVERED", customerId: { not: null }, deliveredAt: { gte: daysAgo(6, 0, 0) }, items: { some: { isGiftCard: false, productId: { not: null } } } },
      orderBy: { deliveredAt: "desc" },
      select: { id: true, customerId: true, deliveredAt: true, items: { where: { isGiftCard: false, productId: { not: null } }, select: { id: true }, take: 1 } },
    });
    if (delivered?.items[0]) {
      const requestedAt = new Date(Math.min(now.getTime(), (delivered.deliveredAt ?? now).getTime() + 86_400_000));
      await db.returnRequest.create({
        data: {
          storeId: mode, orderId: delivered.id, customerId: delivered.customerId, reference: "RT-DEMO01", status: "REQUESTED", resolution: "STORE_CREDIT",
          requestedBy: "customer", reason: "size", customerNote: "Trop petit, je voudrais la taille au-dessus.", createdAt: requestedAt,
          items: { create: { orderItemId: delivered.items[0].id, quantity: 1, reason: "size" } },
          events: { create: { actorLabel: "Client", toStatus: "REQUESTED", message: "Demande de retour", createdAt: requestedAt } },
        },
      });
    } else {
      console.warn("  lot 1 : aucune commande livrée récente, retour de démonstration non créé");
    }
  }

  if (aicha) {
    const gateaux = await collection(aicha, "Gâteaux");
    await db.automaticDiscount.create({
      data: {
        storeId: aicha, title: "−5 % dès 20 000 FCFA, −10 % dès 50 000 FCFA", kind: "CART_TIER", startsAt: daysAgo(10, 0, 0),
        config: json({
          tiers: [
            { minSubtotal: 20_000, value: { type: "PERCENT", amount: 5 } },
            { minSubtotal: 50_000, value: { type: "PERCENT", amount: 10 } },
          ],
        }),
      },
    });
    if (gateaux) {
      await db.automaticDiscount.create({
        data: {
          storeId: aicha, title: "Fête des mères : −10 % sur les gâteaux", kind: "PRODUCT_AMOUNT", startsAt: daysAgo(30, 0, 0), endsAt: daysAgo(20, 23, 59), usesCount: 14,
          config: json({ target: { collectionIds: [gateaux] }, value: { type: "PERCENT", amount: 10 }, perUnit: false, excludeOnSale: true }),
        },
      });
    }
  }
}

/**
 * Lots 2 et 4 : jeu minimal et idempotent (upserts sur les clés uniques, aucune suppression).
 *  - Tech Hub Cotonou (BJ) : TVA 18 % préréglée mais désactivée (le commerçant confirme ; taxes de la boutique désactivées) ;
 *  - Saveurs d'Afrique Paris : anglais en langue secondaire ;
 *  - Chez Aïcha : un article de blog publié ;
 *  - bibliothèque de sections : une composition publiée (aucune référence d'identifiant de boutique).
 */
async function seedLot2Lot4(storeIds: Map<string, string>, users: Map<string, { id: string; name: string }>) {
  const techHub = storeIds.get("tech-hub-cotonou");
  const paris = storeIds.get("saveurs-afrique-paris");
  const aicha = storeIds.get("chez-aicha");

  if (techHub) {
    const rate = { name: "TVA", rateBps: 1800, appliesToShipping: true, active: false };
    await db.taxRate.upsert({
      where: { storeId_country_regionKey_taxCategory: { storeId: techHub, country: "BJ", regionKey: "*", taxCategory: "standard" } },
      create: { storeId: techHub, country: "BJ", regionKey: "*", taxCategory: "standard", ...rate },
      update: rate,
    });
  }

  if (paris) await db.store.update({ where: { id: paris }, data: { enabledLocales: ["en"] } });

  if (aicha) {
    const author = users.get(DEMO_EMAIL);
    const body = [
      "Un gâteau à la crème se garde **au réfrigérateur, entre 2 et 4 °C**, dans sa boîte fermée.",
      "",
      "- Sortez-le 20 minutes avant de servir : les saveurs reviennent.",
      "- Les gâteaux secs (cakes, sablés) se conservent 4 jours à température ambiante, à l'abri de la chaleur.",
      "- Par forte chaleur, évitez la voiture au soleil : demandez plutôt la livraison.",
      "",
      "Une question ? Écrivez-nous sur WhatsApp, nous répondons vite.",
    ].join("\n");
    const post = {
      title: "Bien conserver vos gâteaux par forte chaleur",
      excerpt: "Nos conseils pour garder vos gâteaux frais et savoureux, même en pleine saison chaude.",
      body,
      authorName: author?.name ?? "Chez Aïcha",
      tags: ["conseils", "conservation"],
      status: "PUBLISHED" as const,
      publishedAt: daysAgo(6, 9, 0),
      seoTitle: "Conserver un gâteau par forte chaleur : nos conseils",
      seoDescription: "Réfrigérateur, température, livraison : comment garder vos gâteaux frais à Abidjan.",
      readingMinutes: 2,
      createdById: author?.id ?? null,
    };
    await db.blogPost.upsert({ where: { storeId_slug: { storeId: aicha, slug: "conserver-vos-gateaux" } }, create: { storeId: aicha, slug: "conserver-vos-gateaux", ...post }, update: post });
  }

  const item = {
    name: "Nos engagements",
    description: "Trois colonnes pour rassurer : livraison, paiement Mobile Money, service sur WhatsApp.",
    category: "Confiance",
    sectionType: "multicolumn",
    payload: json({
      type: "multicolumn",
      settings: { heading: "Nos engagements", columns: "3", align: "center" },
      blocks: [
        { type: "column", settings: { title: "Livraison rapide", text: "Votre commande livrée en 24 h." } },
        { type: "column", settings: { title: "Paiement Mobile Money", text: "Wave, Orange Money, MTN ou à la livraison." } },
        { type: "column", settings: { title: "Service sur WhatsApp", text: "Une question ? Réponse rapide sur WhatsApp." } },
      ],
    }),
    premium: false,
    minPlan: "FREE" as const,
    tags: ["confiance", "réassurance"],
    published: true,
    position: 0,
  };
  await db.sectionLibraryItem.upsert({ where: { slug: "nos-engagements" }, create: { slug: "nos-engagements", ...item }, update: item });
}

/**
 * Lot 3 (opérations) : un dépôt principal par boutique, le stock suivi réparti dessus, un second
 * dépôt « Magasin » pour la boutique de démonstration (transferts, caisse) et un compte transporteur
 * « livreur interne ». Idempotent : un article qui a déjà un niveau n'est jamais recrédité.
 */
async function seedLot3(storeIds: Map<string, string>) {
  let created = 0;
  for (const storeId of storeIds.values()) {
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { country: true, city: true, slug: true } });
    const main = await db.location.upsert({
      where: { storeId_name: { storeId, name: "Dépôt principal" } },
      create: { storeId, name: "Dépôt principal", type: "WAREHOUSE", country: store.country, city: store.city, isDefault: true, pickupEnabled: true, position: 0 },
      update: {},
      select: { id: true },
    });
    const products = await db.product.findMany({
      where: { storeId, trackStock: true, status: { not: "ARCHIVED" } },
      select: { id: true, stock: true, variants: { select: { id: true, stock: true } } },
    });
    type LevelTarget = { productId: string; variantId: string | null; itemKey: string; stock: number };
    const targets: LevelTarget[] = [];
    for (const p of products) {
      if (p.variants.length) for (const v of p.variants) targets.push({ productId: p.id, variantId: v.id, itemKey: v.id, stock: v.stock });
      else targets.push({ productId: p.id, variantId: null, itemKey: p.id, stock: p.stock });
    }
    if (targets.length) {
      const existing = await db.inventoryLevel.findMany({ where: { storeId, itemKey: { in: targets.map((t) => t.itemKey) } }, select: { itemKey: true } });
      const known = new Set(existing.map((e) => e.itemKey));
      const todo = targets.filter((t) => !known.has(t.itemKey));
      if (todo.length) {
        const r = await db.inventoryLevel.createMany({
          data: todo.map((t) => ({ storeId, locationId: main.id, productId: t.productId, variantId: t.variantId, itemKey: t.itemKey, available: t.stock })),
          skipDuplicates: true,
        });
        created += r.count;
      }
    }
    // Boutique de démonstration : second dépôt et livreur interne (expéditions et caisse).
    if (store.slug === "dantokpa-mode") {
      await db.location.upsert({
        where: { storeId_name: { storeId, name: "Magasin Dantokpa" } },
        create: { storeId, name: "Magasin Dantokpa", type: "STORE", country: store.country, city: store.city, pickupEnabled: true, position: 1 },
        update: {},
      });
      const courier = await db.carrierAccount.findFirst({ where: { storeId, carrier: "manual" }, select: { id: true } });
      if (!courier) await db.carrierAccount.create({ data: { storeId, carrier: "manual", name: "Livreur de la boutique", active: true } });
    }
  }
  return created;
}

/**
 * Apps first-party du catalogue (App Store). Idempotent : upsert par slug. Toutes PUBLISHED + listed,
 * firstParty, scopes cohérents (⊆ SCOPES), mélange gratuit / abonnement / one-time pour la facturation (phase D).
 * N'écrase AUCUNE donnée marchand : ne touche que la table App.
 */
export async function seedApps() {
  const apps: Array<{
    slug: string;
    name: string;
    tagline: string;
    description: string;
    category: string;
    requestedScopes: string[];
    pricingType: "FREE" | "SUBSCRIPTION" | "ONE_TIME";
    priceAmount?: number;
    priceInterval?: string | null;
    trialDays?: number;
  }> = [
    {
      slug: "assistant-ia",
      name: "Assistant IA",
      tagline: "Un copilote qui lit votre catalogue et vos commandes.",
      description: "Posez vos questions en langage naturel : stock, ventes du jour, meilleures ventes. L'assistant lit (sans modifier) votre catalogue et vos commandes.",
      category: "ia",
      requestedScopes: ["catalog:read", "orders:read"],
      pricingType: "FREE",
    },
    {
      slug: "automatisations-webhooks",
      name: "Automatisations & Webhooks",
      tagline: "Connectez Axi à vos outils via des webhooks sortants.",
      description: "Déclenchez des scénarios externes à chaque événement (nouvelle commande, changement de statut) et consultez le journal des livraisons.",
      category: "marketing",
      requestedScopes: ["webhooks:write", "orders:read"],
      pricingType: "SUBSCRIPTION",
      priceAmount: 5000,
      priceInterval: "month",
      trialDays: 7,
    },
    {
      slug: "statistiques-avancees",
      name: "Statistiques avancées",
      tagline: "Tableaux de bord et tendances de ventes détaillés.",
      description: "Chiffre d'affaires, panier moyen, cohortes et meilleures ventes, au-delà du tableau de bord standard.",
      category: "analytics",
      requestedScopes: ["analytics:read"],
      pricingType: "FREE",
    },
    {
      slug: "avis-reputation",
      name: "Avis & réputation",
      tagline: "Collectez et affichez les avis clients.",
      description: "Sollicitez des avis après livraison et publiez-les sur vos fiches produits (brouillons de contenu).",
      category: "support",
      requestedScopes: ["content:write"],
      pricingType: "FREE",
    },
    {
      slug: "fidelite-pro",
      name: "Fidélité Pro",
      tagline: "Programme de points et relances ciblées.",
      description: "Récompensez vos clients fidèles et déclenchez des campagnes marketing segmentées.",
      category: "fidelite",
      requestedScopes: ["customers:read", "marketing:write"],
      pricingType: "SUBSCRIPTION",
      priceAmount: 8000,
      priceInterval: "month",
      trialDays: 14,
    },
    {
      slug: "export-comptable",
      name: "Export comptable",
      tagline: "Exportez ventes et commandes pour votre comptable.",
      description: "Génère des exports (CSV) des commandes et des indicateurs de ventes, prêts pour la comptabilité.",
      category: "analytics",
      requestedScopes: ["orders:read", "analytics:read"],
      pricingType: "ONE_TIME",
      priceAmount: 15000,
    },
  ];

  for (const a of apps) {
    const data = {
      name: a.name,
      tagline: a.tagline,
      description: a.description,
      category: a.category,
      developerName: "Axi",
      firstParty: true,
      status: "PUBLISHED" as const,
      listed: true,
      requestedScopes: a.requestedScopes,
      pricingType: a.pricingType,
      priceAmount: a.priceAmount ?? 0,
      priceInterval: a.priceInterval ?? null,
      trialDays: a.trialDays ?? 0,
    };
    await db.app.upsert({ where: { slug: a.slug }, create: { slug: a.slug, ...data }, update: data });
  }
  return apps.length;
}

async function main() {
  console.log("Seed Axi V4 : démarrage");
  const { admin, users } = await seedUsers();
  console.log(`  admin plateforme : ${admin.email}`);

  const storeIds = new Map<string, string>();
  for (const [i, spec] of STORES.entries()) {
    const owner = users.get(spec.owner);
    if (!owner) throw new Error(`Propriétaire inconnu : ${spec.owner}`);
    const { store } = await seedStore(spec, i, { ownerId: owner.id, ownerName: owner.name, adminId: admin.id, staffId: spec.slug === "dantokpa-mode" ? users.get(STAFF.email)?.id : undefined });
    storeIds.set(spec.slug, store.id);
    const [products, orders, conversations] = await Promise.all([db.product.count({ where: { storeId: store.id } }), db.order.count({ where: { storeId: store.id } }), db.conversation.count({ where: { storeId: store.id } })]);
    console.log(`  ${spec.subscription.plan.padEnd(8)} ${spec.subscription.status.padEnd(9)} ${store.name} (/s/${store.slug}) : ${products} produits, ${orders} commandes, ${conversations} conversations`);
  }
  await seedSupport(storeIds, users, admin.id);
  await seedLot1(storeIds, users);
  console.log(`  lot 1 : remises automatiques (Dantokpa Mode, Chez Aïcha), retours activés et carte cadeau ${DEMO_GIFT_CARD_CODE.match(/.{4}/g)!.join("-")} (Dantokpa Mode)`);
  await seedLot2Lot4(storeIds, users);
  console.log(`  lot 4A : ${await seedLibrary(db)} sections de bibliothèque de démonstration`);
  console.log(`  lot 3 : dépôts et stock par dépôt (${await seedLot3(storeIds)} niveaux créés), second dépôt et livreur interne pour Dantokpa Mode`);
  console.log("  lots 2 et 4 : TVA BJ 18 % désactivée (Tech Hub Cotonou), anglais (Saveurs d'Afrique Paris), 1 article de blog (Chez Aïcha), 1 section de bibliothèque");

  console.log(`  App Store : ${await seedApps()} apps first-party publiées`);

  console.log("Seed terminé.");
  console.log(`\nComptes : admin ${ADMIN_EMAIL} / (SEED_ADMIN_PASSWORD) ; marchands ${DEMO_EMAIL}, ${MERCHANTS.map((m) => m.email).join(", ")} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

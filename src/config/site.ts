export const SITE = {
  name: "Axi",
  tagline: "La plateforme e-commerce qui vend aussi dans la conversation.",
  description:
    "Axi est une plateforme de commerce complète : boutique en ligne personnalisable, catalogue à variantes, paiements Mobile Money, carte bancaire et paiement à la livraison, vente sur WhatsApp et les réseaux sociaux, multi-devises, API REST et connecteur IA. 0 % de commission, prix en euros ou en FCFA.",
  domain: process.env.NEXT_PUBLIC_APP_DOMAIN ?? "axi.africa",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supportEmail: "support@axi.africa",
  supportWhatsapp: "22997000000",
  company: "Axi Technologies SAS",
  address: "Cotonou, Bénin",
  twitter: "@axi_africa",
} as const;

export const STORE_CATEGORIES: { id: string; label: string; theme: string }[] = [
  { id: "general", label: "Boutique générale", theme: "market" },
  { id: "food", label: "Restauration & pâtisserie", theme: "restaurant" },
  { id: "fashion", label: "Mode & accessoires", theme: "fashion" },
  { id: "beauty", label: "Beauté & cosmétiques", theme: "beauty" },
  { id: "electronics", label: "Électronique & téléphonie", theme: "market" },
  { id: "home", label: "Maison & décoration", theme: "market" },
  { id: "grocery", label: "Alimentation & épicerie", theme: "market" },
  { id: "services", label: "Services & prestations", theme: "market" },
];

export const COUNTRIES: {
  code: string;
  name: string;
  currency: string;
  dialCode: string;
  timezone: string;
  phoneLength: number;
  mobileMoney: string[];
}[] = [
  { code: "BJ", name: "Bénin", currency: "XOF", dialCode: "229", timezone: "Africa/Porto-Novo", phoneLength: 10, mobileMoney: ["MTN MoMo", "Moov Money", "Celtiis Cash"] },
  { code: "TG", name: "Togo", currency: "XOF", dialCode: "228", timezone: "Africa/Lome", phoneLength: 8, mobileMoney: ["Flooz", "T-Money"] },
  { code: "CI", name: "Côte d'Ivoire", currency: "XOF", dialCode: "225", timezone: "Africa/Abidjan", phoneLength: 10, mobileMoney: ["Orange Money", "MTN MoMo", "Wave", "Moov Money"] },
  { code: "SN", name: "Sénégal", currency: "XOF", dialCode: "221", timezone: "Africa/Dakar", phoneLength: 9, mobileMoney: ["Wave", "Orange Money", "Free Money"] },
  { code: "BF", name: "Burkina Faso", currency: "XOF", dialCode: "226", timezone: "Africa/Ouagadougou", phoneLength: 8, mobileMoney: ["Orange Money", "Moov Money"] },
  { code: "ML", name: "Mali", currency: "XOF", dialCode: "223", timezone: "Africa/Bamako", phoneLength: 8, mobileMoney: ["Orange Money", "Moov Money"] },
  { code: "NE", name: "Niger", currency: "XOF", dialCode: "227", timezone: "Africa/Niamey", phoneLength: 8, mobileMoney: ["Airtel Money", "Moov Money"] },
  { code: "CM", name: "Cameroun", currency: "XAF", dialCode: "237", timezone: "Africa/Douala", phoneLength: 9, mobileMoney: ["MTN MoMo", "Orange Money"] },
  { code: "GA", name: "Gabon", currency: "XAF", dialCode: "241", timezone: "Africa/Libreville", phoneLength: 8, mobileMoney: ["Airtel Money", "Moov Money"] },
  { code: "CG", name: "Congo", currency: "XAF", dialCode: "242", timezone: "Africa/Brazzaville", phoneLength: 9, mobileMoney: ["MTN MoMo", "Airtel Money"] },
  { code: "CD", name: "RD Congo", currency: "CDF", dialCode: "243", timezone: "Africa/Kinshasa", phoneLength: 9, mobileMoney: ["M-Pesa", "Orange Money", "Airtel Money"] },
  { code: "GN", name: "Guinée", currency: "GNF", dialCode: "224", timezone: "Africa/Conakry", phoneLength: 9, mobileMoney: ["Orange Money", "MTN MoMo"] },
  { code: "FR", name: "France", currency: "EUR", dialCode: "33", timezone: "Europe/Paris", phoneLength: 9, mobileMoney: [] },
];

export function getCountry(code: string) {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}

export const RESERVED_SLUGS = new Set([
  "admin", "app", "api", "www", "mail", "ftp", "s", "marketplace", "tarifs", "pricing", "aide", "help",
  "blog", "contact", "login", "signup", "inscription", "connexion", "legal", "cgu", "privacy", "axi",
  "support", "status", "docs", "dev", "staging", "test", "shop", "store", "boutique", "whatsapp",
  "suivi", "track", "checkout", "panier", "cart", "static", "assets", "public", "null", "undefined",
]);

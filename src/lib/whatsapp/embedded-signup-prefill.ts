/**
 * Pré-remplissage de la fenêtre Embedded Signup (Meta, `extras.setup`) à partir des informations de la boutique :
 * le marchand n'a plus qu'à se connecter à Facebook, vérifier les champs et saisir le code SMS. Module pur
 * (client et serveur). Seuls les champs connus sont envoyés ; Meta laisse le marchand corriger chaque valeur.
 */

export type PrefillStore = {
  name: string;
  category?: string | null; // catégorie Axi (STORE_CATEGORIES)
  description?: string | null;
  tagline?: string | null;
  city?: string | null;
  address?: string | null;
  country: string; // ISO 3166-1 alpha-2
  timezone?: string | null; // IANA, ex. Africa/Porto-Novo
  whatsappNumber?: string | null; // E.164 sans « + », ex. 22997000000
};

export type EmbeddedSignupSetup = {
  business?: {
    /** Toujours null : Axi ne connaît pas le portefeuille Meta du marchand (champ attendu par Meta). */
    id?: null;
    name?: string;
    email?: string;
    website?: string;
    phone?: { code: number; number: string };
    address?: { streetAddress1?: string; city?: string; country?: string };
    timezone?: string;
  };
  /** Profil du numéro : Meta exige les trois champs ensemble. */
  phone?: { displayName: string; category: string; description: string };
};

/** Catégorie Axi → catégorie de profil WhatsApp Business (liste fermée Meta). */
const META_CATEGORY: Record<string, string> = {
  general: "RETAIL",
  food: "RESTAURANT",
  fashion: "APPAREL",
  beauty: "BEAUTY",
  electronics: "RETAIL",
  home: "RETAIL",
  grocery: "GROCERY",
  services: "PROF_SERVICES",
};

export function metaBusinessCategory(category: string | null | undefined): string {
  return (category && META_CATEGORY[category]) || "OTHER";
}

/** Décalage UTC d'un fuseau IANA au format attendu par Meta (« UTC+01:00 »), ou undefined. */
export function metaTimezone(tz: string | null | undefined, at: Date = new Date()): string | undefined {
  if (!tz) return undefined;
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part) return undefined;
    if (part === "GMT") return "UTC+00:00";
    const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part);
    if (!m) return undefined;
    return `UTC${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}`;
  } catch {
    return undefined;
  }
}

/** Sépare un numéro E.164 (sans « + ») en indicatif + numéro national, si l'indicatif du pays correspond. */
export function splitPhone(e164: string | null | undefined, dialCode: string): { code: number; number: string } | undefined {
  const digits = (e164 ?? "").replace(/\D/g, "");
  if (!digits || !dialCode || !digits.startsWith(dialCode)) return undefined;
  const national = digits.slice(dialCode.length);
  if (national.length < 6 || national.length > 14) return undefined;
  return { code: Number(dialCode), number: national };
}

const clip = (v: string | null | undefined, max: number) => {
  const t = v?.trim();
  return t ? t.slice(0, max) : undefined;
};

/** Construit `extras.setup` ; renvoie un objet vide si rien d'utile n'est connu. */
export function buildEmbeddedSignupSetup(input: { store: PrefillStore; email?: string | null; website?: string | null; dialCode: string }): EmbeddedSignupSetup {
  const { store } = input;
  const prune = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  const address = prune({
    streetAddress1: clip(store.address, 200),
    city: clip(store.city, 100),
    country: /^[A-Z]{2}$/.test(store.country) ? store.country : undefined,
  });
  const business: NonNullable<EmbeddedSignupSetup["business"]> = {
    id: null,
    name: clip(store.name, 100),
    email: input.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ? input.email : undefined,
    website: input.website && /^https:\/\//.test(input.website) ? input.website : undefined,
    phone: splitPhone(store.whatsappNumber, input.dialCode),
    address: Object.keys(address).length ? address : undefined,
    timezone: metaTimezone(store.timezone),
  };
  const displayName = clip(store.name, 100);
  const phone = displayName
    ? {
        displayName,
        category: metaBusinessCategory(store.category),
        description: clip(store.tagline || store.description, 512) ?? `Boutique en ligne ${displayName}`.slice(0, 512),
      }
    : undefined;
  const out: EmbeddedSignupSetup = {};
  const b = prune(business);
  if (Object.keys(b).some((k) => k !== "id")) out.business = b;
  if (phone) out.phone = phone;
  return out;
}

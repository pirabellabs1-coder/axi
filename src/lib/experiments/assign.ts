/**
 * Lot 4 §13 : affectation déterministe des visiteurs aux variantes (module PUR, client et serveur).
 *
 * `hash(axi_vid + ":" + experimentId) mod 10 000` est comparé aux poids cumulés (exprimés en pourcents).
 * Conséquences voulues :
 *  - un visiteur voit TOUJOURS la même variante, sans écriture ni cookie supplémentaire ;
 *  - le serveur recalcule l'affectation à chaque requête : le client ne peut pas se déclarer dans une variante
 *    (aucune valeur envoyée par le navigateur n'est crue) ;
 *  - deux tests différents sur le même visiteur sont indépendants (l'identifiant du test entre dans le hachage).
 */

export const VARIANT_KEYS = ["A", "B", "C"] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];

export const EXPERIMENT_GOALS = ["ADD_TO_CART", "CHECKOUT_START", "ORDER"] as const;
export type ExperimentGoal = (typeof EXPERIMENT_GOALS)[number];

export const METRICS = ["exposure", "add_to_cart", "checkout_start", "order"] as const;
export type ExperimentMetric = (typeof METRICS)[number];

/** Métrique de conversion correspondant à l'objectif. */
export const GOAL_METRIC: Record<ExperimentGoal, Exclude<ExperimentMetric, "exposure">> = {
  ADD_TO_CART: "add_to_cart",
  CHECKOUT_START: "checkout_start",
  ORDER: "order",
};

export const GOAL_LABELS: Record<ExperimentGoal, string> = {
  ADD_TO_CART: "Ajouts au panier",
  CHECKOUT_START: "Commandes commencées",
  ORDER: "Commandes passées",
};

/** Variante : la section actuelle (A), une autre version de la section, ou la section masquée. */
export type VariantKind = "current" | "section" | "hidden";

export type VariantShape = { key: VariantKey; weight: number; kind: VariantKind };

export const HASH_BUCKETS = 10_000;

/** FNV-1a 32 bits (stable, sans dépendance, identique côté client et serveur). */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    const high = input.charCodeAt(i) >>> 8;
    if (high) {
      h ^= high;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/** Seau du visiteur pour ce test : entier de 0 à 9 999. */
export function bucketOf(visitorId: string, experimentId: string): number {
  return fnv1a32(`${visitorId}:${experimentId}`) % HASH_BUCKETS;
}

/**
 * Variante affectée. `null` si l'identifiant visiteur est absent (le visiteur reste sur la section actuelle et
 * n'est compté dans aucune variante) ou si les poids sont vides.
 */
export function assignVariant<T extends VariantShape>(variants: readonly T[], visitorId: string | null | undefined, experimentId: string): T | null {
  if (!visitorId || variants.length === 0) return null;
  const total = variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) return null;
  const bucket = bucketOf(visitorId, experimentId);
  let cumulative = 0;
  for (const v of variants) {
    cumulative += (Math.max(0, v.weight) / total) * HASH_BUCKETS;
    if (bucket < cumulative) return v;
  }
  return variants[variants.length - 1];
}

/** Poids égaux (somme 100) pour `n` variantes ; le reste va aux premières (2 → 50/50, 3 → 34/33/33). */
export function evenWeights(n: number): number[] {
  const count = Math.max(1, Math.min(VARIANT_KEYS.length, Math.trunc(n)));
  const base = Math.floor(100 / count);
  const out = Array.from({ length: count }, () => base);
  for (let i = 0; i < 100 - base * count; i++) out[i]++;
  return out;
}

/* ───────────── Identifiant visiteur (cookie `axi_vid`) ───────────── */

export const VISITOR_COOKIE = "axi_vid";
export const SOURCE_COOKIE = "axi_src";
/** 1 an (cookie fonctionnel de premier niveau, aucune donnée personnelle). */
export const VISITOR_COOKIE_MAX_AGE = 365 * 24 * 3600;
/** 30 jours : source de premier contact (§12). */
export const SOURCE_COOKIE_MAX_AGE = 30 * 24 * 3600;

const VID_RE = /^[0-9a-f]{32}$/;

/** Identifiant visiteur accepté : 128 bits en hexadécimal minuscule. */
export function isVisitorId(v: unknown): v is string {
  return typeof v === "string" && VID_RE.test(v);
}

/* ───────────── Cookie `axi_vid` SIGNÉ (correctif mineur n° 11) ───────────── */

/**
 * Longueur de la signature tronquée (hex). 32 caractères = 128 bits : largement assez pour qu'un
 * identifiant forgé soit impossible à faire accepter, sans alourdir le cookie.
 */
export const VID_SIGNATURE_LENGTH = 32;

const SIGNED_VID_RE = new RegExp(`^([0-9a-f]{32})\\.([0-9a-f]{${VID_SIGNATURE_LENGTH}})$`);

/**
 * Valeur de cookie signée : `<id>.<hmac>`. Fonctions PURES (la signature elle-même est calculée
 * côté serveur par `src/lib/experiments/vid-signature.ts`, qui seul connaît `APP_SECRET`).
 *
 * Pourquoi signer : le cookie `axi_vid` décide de la variante vue ET sert de clé de dédoublonnage des
 * statistiques. Forgeable, il permettait de pousser autant d'identifiants qu'on voulait sur la balise
 * `/api/s/{slug}/events` et de fabriquer la victoire d'une variante (décision commerciale faussée).
 */
export function formatSignedVid(id: string, signature: string): string {
  return `${id}.${signature}`;
}

/** Découpe une valeur de cookie signée ; `null` si la forme ne convient pas. */
export function splitSignedVid(value: unknown): { id: string; signature: string } | null {
  if (typeof value !== "string") return null;
  const m = SIGNED_VID_RE.exec(value);
  return m ? { id: m[1], signature: m[2] } : null;
}

/** Identifiant visiteur aléatoire de 128 bits (jamais dérivé d'une donnée personnelle). */
export function newVisitorId(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += Math.floor(random() * 0x10000).toString(16).padStart(4, "0");
  return out;
}

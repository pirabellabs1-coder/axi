/**
 * Scopes des jetons API et des connexions OAuth (module pur, importable côté client).
 * Référence : docs/API-MCP.md.
 *
 * Portée effective d'un appel = scopes du jeton ∩ scopes autorisés par le plan ∩ scopes permis par le rôle
 * du membre qui a créé le jeton (ou accordé l'accès OAuth). Recalculée à CHAQUE requête : un changement de
 * plan ou de rôle s'applique immédiatement, sans réémettre les jetons.
 */
import type { MembershipRole } from "@prisma/client";
import { MCP_LIMITS, type PlanId } from "@/config/plans";

export const SCOPES = [
  "store:read",
  "catalog:read",
  "catalog:write",
  "inventory:write",
  "orders:read",
  "orders:write",
  "customers:read",
  "analytics:read",
  "marketing:write",
  // Lot 1 : émettre des cartes cadeaux et créditer un avoir (Business+, OWNER et MANAGER : capacité giftcards.manage)
  "giftcards:write",
  // Lot 2 : contenus (blog en brouillon, traductions) — Starter+, capacité store.settings
  "content:write",
  // Lot 2 : points de webhook et journal des livraisons — Business+, propriétaire seulement (capacité integrations.manage)
  "webhooks:write",
  // Lot 4 : brouillon du thème (opérations, génération IA, programmation, publication avec confirmation) — Business+, capacité theme.manage
  "theme:write",
] as const;

export type Scope = (typeof SCOPES)[number];

export const READ_SCOPES: Scope[] = ["store:read", "catalog:read", "orders:read", "customers:read", "analytics:read"];

export const SCOPE_LABELS: Record<Scope, { label: string; description: string; write: boolean }> = {
  "store:read": { label: "Informations de la boutique", description: "Nom, plan, réglages et indicateurs du tableau de bord.", write: false },
  "catalog:read": { label: "Lire le catalogue", description: "Produits, variantes, prix, stock et collections.", write: false },
  "catalog:write": { label: "Modifier le catalogue", description: "Créer et modifier des produits, des prix et des collections.", write: true },
  "inventory:write": { label: "Ajuster le stock", description: "Entrées et sorties de stock, avec motif et historique.", write: true },
  "orders:read": { label: "Lire les commandes", description: "Commandes, articles, paiements et historique.", write: false },
  "orders:write": { label: "Traiter les commandes", description: "Changer le statut d'une commande et ajouter des notes.", write: true },
  "customers:read": { label: "Données clients", description: "Noms, téléphones, adresses et historique d'achat (données personnelles).", write: false },
  "analytics:read": { label: "Statistiques de ventes", description: "Chiffre d'affaires, panier moyen, meilleures ventes.", write: false },
  "marketing:write": { label: "Codes promo", description: "Créer et consulter des codes promo.", write: true },
  "giftcards:write": { label: "Cartes cadeaux et avoirs", description: "Émettre des cartes cadeaux et créditer l'avoir d'un client.", write: true },
  "content:write": { label: "Contenus", description: "Rédiger des articles de blog (brouillons) et traduire les contenus de la boutique.", write: true },
  "webhooks:write": { label: "Webhooks", description: "Créer, supprimer et consulter les webhooks sortants et leurs livraisons.", write: true },
  "theme:write": { label: "Thème de la boutique", description: "Modifier le brouillon du thème, générer un design, programmer et publier (avec confirmation).", write: true },
};

export function isScope(v: unknown): v is Scope {
  return typeof v === "string" && (SCOPES as readonly string[]).includes(v);
}

/** Normalise une liste brute (tableau ou chaîne séparée par des espaces) : scopes connus, sans doublon, dans l'ordre canonique. */
export function parseScopes(raw: unknown): Scope[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
  const set = new Set(list.filter(isScope));
  return SCOPES.filter((s) => set.has(s));
}

export function formatScopes(scopes: readonly string[]): string {
  return parseScopes([...scopes]).join(" ");
}

/* ───────────────────────── Plans ───────────────────────── */

const STANDARD: Scope[] = [...READ_SCOPES, "catalog:write", "inventory:write", "orders:write", "content:write"];

/** Scopes accessibles selon le plan (Gratuit : lecture ; Starter : + catalogue/stock/commandes/contenus ; Business+ : tout, dont giftcards:write, webhooks:write, theme:write). */
export function planScopes(planId: PlanId): Scope[] {
  const tier = MCP_LIMITS[planId]?.scopes ?? "read";
  if (tier === "all") return [...SCOPES];
  if (tier === "standard") return SCOPES.filter((s) => STANDARD.includes(s));
  return SCOPES.filter((s) => READ_SCOPES.includes(s));
}

/** Plan minimal qui débloque un scope (pour les messages d'upsell). */
export function planForScope(scope: Scope): PlanId {
  if (READ_SCOPES.includes(scope)) return "FREE";
  if (STANDARD.includes(scope)) return "STARTER";
  return "BUSINESS";
}

/* ───────────────────────── Rôles ───────────────────────── */

/** Scopes qu'un rôle peut déléguer (miroir des capacités de src/lib/auth/permissions.ts). */
const ROLE_SCOPES: Record<MembershipRole, Scope[]> = {
  OWNER: [...SCOPES],
  // Le gérant n'a pas integrations.manage : pas de webhooks (données sortantes, éventuellement personnelles).
  MANAGER: SCOPES.filter((s) => s !== "webhooks:write"),
  STAFF: ["store:read", "orders:read", "orders:write"],
  SUPPORT: ["store:read", "catalog:read", "orders:read", "customers:read"],
};

export function roleScopes(role: MembershipRole): Scope[] {
  return ROLE_SCOPES[role] ?? [];
}

/** Intersection ordonnée des scopes demandés, du plan et du rôle. */
export function effectiveScopes(requested: readonly string[], planId: PlanId, role: MembershipRole): Scope[] {
  const plan = new Set(planScopes(planId));
  const byRole = new Set(roleScopes(role));
  return parseScopes([...requested]).filter((s) => plan.has(s) && byRole.has(s));
}

export function hasAnyScope(granted: readonly Scope[], required: readonly Scope[]): boolean {
  return required.length === 0 || required.some((s) => granted.includes(s));
}

/* ───────────────────────── Préréglages (interface) ───────────────────────── */

export type ScopePresetId = "read" | "catalog" | "full" | "custom";

export const SCOPE_PRESETS: { id: ScopePresetId; label: string; description: string; scopes: Scope[] }[] = [
  { id: "read", label: "Lecture seule", description: "L'assistant consulte, analyse et résume, sans rien modifier.", scopes: READ_SCOPES },
  { id: "catalog", label: "Gestion du catalogue", description: "Lecture, plus produits, prix, collections et stock.", scopes: ["store:read", "catalog:read", "catalog:write", "inventory:write", "analytics:read"] },
  { id: "full", label: "Accès complet", description: "Tout ce que permet votre plan : catalogue, commandes, clients, promotions.", scopes: [...SCOPES] },
];

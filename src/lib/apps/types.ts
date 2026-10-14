/**
 * Plateforme d'applications (App Store) — module PUR (importable côté client et dans le seed).
 * N'importe aucun module `server-only` : catégories, formatage de prix et calcul des scopes accordés.
 *
 * Règle de sécurité centrale : les scopes accordés à une installation sont TOUJOURS l'intersection
 * des scopes demandés par l'app et des scopes autorisés par le plan de la boutique (voir
 * src/lib/mcp/scopes.ts → planScopes). Un changement de plan resserre donc la portée à l'install.
 */
import type { AppInstallStatus, AppPricingType } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { isScope, SCOPES, type Scope } from "@/lib/mcp/scopes";

/* ───────────────────────── Catégories ───────────────────────── */

export const APP_CATEGORIES = [
  { id: "marketing", label: "Marketing" },
  { id: "ventes", label: "Ventes" },
  { id: "logistique", label: "Logistique" },
  { id: "analytics", label: "Statistiques" },
  { id: "design", label: "Design" },
  { id: "ia", label: "Intelligence artificielle" },
  { id: "fidelite", label: "Fidélité" },
  { id: "support", label: "Support client" },
  { id: "autre", label: "Autre" },
] as const;

export type AppCategory = (typeof APP_CATEGORIES)[number]["id"];

/**
 * Commission de la plateforme sur les abonnements d'app payantes (phase D), en pourcentage du brut.
 * Les reversements réels au développeur sont opérés par la plateforme (hors du reporting de revenus).
 */
export const APP_PLATFORM_FEE_PCT = 20;

export const APP_CATEGORY_LABELS: Record<AppCategory, string> = Object.fromEntries(
  APP_CATEGORIES.map((c) => [c.id, c.label]),
) as Record<AppCategory, string>;

export function isAppCategory(v: unknown): v is AppCategory {
  return typeof v === "string" && APP_CATEGORIES.some((c) => c.id === v);
}

/* ───────────────────────── Prix (affichage FR) ───────────────────────── */

/**
 * Libellé de prix d'une app, en français. Montants en XOF (entiers, sans décimales) :
 *  - FREE (ou montant nul)   → « Gratuit »
 *  - ONE_TIME                → « 2 000 FCFA »
 *  - SUBSCRIPTION            → « 5 000 FCFA / mois » (ou « / an »), suffixe « · 7 j d'essai » si essai.
 */
export function formatAppPrice(
  pricingType: AppPricingType,
  amount: number,
  interval?: string | null,
  trialDays = 0,
): string {
  if (pricingType === "FREE" || amount <= 0) return "Gratuit";
  const price = formatMoney(amount, "XOF");
  if (pricingType === "ONE_TIME") return price;
  const per = interval === "year" ? "an" : "mois";
  const trial = trialDays > 0 ? ` · ${trialDays} j d'essai` : "";
  return `${price} / ${per}${trial}`;
}

/* ───────────────────────── Scopes ───────────────────────── */

/** Vrai si tous les scopes demandés sont connus (⊆ SCOPES) et la liste n'est pas vide. */
export function validateRequestedScopes(scopes: readonly string[]): boolean {
  return Array.isArray(scopes) && scopes.length > 0 && scopes.every(isScope);
}

/**
 * Scopes effectivement accordés = intersection (ordonnée canoniquement) des scopes demandés par l'app
 * et des scopes autorisés par le plan de la boutique. C'est la borne de sécurité : jamais plus que le plan.
 */
export function effectiveGrantedScopes(requested: readonly string[], planAllowedScopes: readonly string[]): Scope[] {
  const wanted = new Set(requested);
  const byPlan = new Set(planAllowedScopes);
  return SCOPES.filter((s) => wanted.has(s) && byPlan.has(s));
}

/* ───────────────────────── Pré-contrôle d'installation (logique pure, testable) ───────────────────────── */

export type InstallPrecheck =
  | { ok: false; reason: "already_installed" }
  | { ok: true; grantedScopes: Scope[] };

/**
 * Décision pure d'installation : refuse si une installation ACTIVE existe déjà, sinon calcule les scopes
 * accordés (bornés par le plan). `existingStatus` = statut de l'installation existante, ou null/undefined.
 */
export function precheckInstall(
  existingStatus: AppInstallStatus | null | undefined,
  requestedScopes: readonly string[],
  planAllowedScopes: readonly string[],
): InstallPrecheck {
  if (existingStatus === "ACTIVE") return { ok: false, reason: "already_installed" };
  return { ok: true, grantedScopes: effectiveGrantedScopes(requestedScopes, planAllowedScopes) };
}

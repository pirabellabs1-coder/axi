/**
 * Rôles de l'équipe plateforme et permissions (module pur, testé dans tests/admin-roles.test.ts).
 *
 *  - SUPER_ADMIN : tout.
 *  - SUPPORT     : lecture de toute la console, tickets, accès support daté aux boutiques.
 *  - FINANCE     : lecture, factures et abonnements, catalogue des prix, codes promo, crédits.
 *
 * Un compte `isPlatformAdmin` sans `platformRole` (comptes créés avant les rôles, seed) est
 * traité comme SUPER_ADMIN. Les permissions sont TOUJOURS vérifiées côté serveur (actions) ;
 * l'interface ne fait que masquer ou désactiver les commandes.
 */
export type PlatformRole = "SUPER_ADMIN" | "SUPPORT" | "FINANCE";

export const PLATFORM_ROLES: PlatformRole[] = ["SUPER_ADMIN", "SUPPORT", "FINANCE"];

export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = {
  SUPER_ADMIN: "Super-administrateur",
  SUPPORT: "Support",
  FINANCE: "Finance",
};

export const PLATFORM_ROLE_HINT: Record<PlatformRole, string> = {
  SUPER_ADMIN: "Accès complet : modération, équipe, paramètres, facturation.",
  SUPPORT: "Lecture, tickets et accès support daté aux boutiques.",
  FINANCE: "Lecture, factures, abonnements, prix, codes promo et crédits.",
};

export type AdminPermission =
  | "read"
  | "tickets.manage"
  | "support.access"
  | "billing.manage"
  | "pricing.manage"
  | "coupons.manage"
  | "stores.moderate"
  | "users.manage"
  | "team.manage"
  | "announcements.manage"
  | "settings.manage"
  | "system.manage";

const ROLE_PERMISSIONS: Record<PlatformRole, ReadonlySet<AdminPermission>> = {
  SUPER_ADMIN: new Set<AdminPermission>([
    "read", "tickets.manage", "support.access", "billing.manage", "pricing.manage", "coupons.manage", "stores.moderate",
    "users.manage", "team.manage", "announcements.manage", "settings.manage", "system.manage",
  ]),
  SUPPORT: new Set<AdminPermission>(["read", "tickets.manage", "support.access"]),
  FINANCE: new Set<AdminPermission>(["read", "billing.manage", "pricing.manage", "coupons.manage"]),
};

export function parsePlatformRole(v: unknown): PlatformRole | null {
  return typeof v === "string" && (PLATFORM_ROLES as string[]).includes(v) ? (v as PlatformRole) : null;
}

/** Rôle effectif d'un utilisateur (null = pas membre de l'équipe plateforme). */
export function effectivePlatformRole(user: { isPlatformAdmin: boolean; platformRole?: string | null } | null | undefined): PlatformRole | null {
  if (!user?.isPlatformAdmin) return null;
  return parsePlatformRole(user.platformRole) ?? "SUPER_ADMIN";
}

export function roleCan(role: PlatformRole | null | undefined, perm: AdminPermission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(perm);
}

export function permissionsOf(role: PlatformRole): AdminPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export const PERMISSION_LABEL: Record<AdminPermission, string> = {
  read: "Consulter la console",
  "tickets.manage": "Traiter les tickets",
  "support.access": "Accès support aux boutiques",
  "billing.manage": "Factures, abonnements et crédits",
  "pricing.manage": "Catalogue des prix",
  "coupons.manage": "Codes promo",
  "stores.moderate": "Modération des boutiques",
  "users.manage": "Gestion des utilisateurs",
  "team.manage": "Équipe plateforme",
  "announcements.manage": "Annonces",
  "settings.manage": "Paramètres plateforme",
  "system.manage": "Tâches, paiements et rapprochement",
};

/**
 * Adhésion boutique de rôle SUPPORT (accès d'assistance) : valable seulement tant que l'utilisateur garde la
 * permission plateforme `support.access`. Les autres rôles de boutique ne dépendent pas de l'équipe plateforme.
 */
export function storeRoleStillAllowed(membershipRole: string, user: { isPlatformAdmin: boolean; platformRole?: string | null } | null | undefined): boolean {
  if (membershipRole !== "SUPPORT") return true;
  return roleCan(effectivePlatformRole(user), "support.access");
}

/* ───────────── Double authentification obligatoire pour l'équipe plateforme ───────────── */

/** Page d'inscription MFA (section Sécurité de la console), seule page accessible sans MFA. */
export const ADMIN_MFA_ENROLL_PATH = "/admin/equipe";
export const ADMIN_MFA_REQUIRED_MESSAGE = "Activez la double authentification (Console > Équipe et sécurité) avant toute action d'administration.";

/**
 * MFA exigée sauf `ADMIN_MFA_OPTIONAL=1` (démo locale uniquement) : en production, la dérogation
 * n'est honorée que si l'application tourne sur localhost (recette locale d'un build de prod).
 */
export function adminMfaRequired(env: Record<string, string | undefined> = process.env): boolean {
  if (env.ADMIN_MFA_OPTIONAL !== "1") return true;
  if (env.NODE_ENV !== "production") return false;
  return !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(env.NEXT_PUBLIC_APP_URL ?? "");
}

/**
 * Décision pure : un membre de l'équipe sans MFA n'a accès qu'à l'inscription MFA.
 * `path` (pages) : chemin demandé ; `allowWithoutMfa` (actions) : actions d'inscription MFA.
 */
export function adminMfaGate(
  mfaEnabled: boolean,
  opts: { path?: string | null; allowWithoutMfa?: boolean } = {},
  env: Record<string, string | undefined> = process.env,
): "ok" | "enroll" {
  if (mfaEnabled || !adminMfaRequired(env) || opts.allowWithoutMfa) return "ok";
  const path = opts.path ?? "";
  if (path === ADMIN_MFA_ENROLL_PATH || path.startsWith(`${ADMIN_MFA_ENROLL_PATH}/`)) return "ok";
  return "enroll";
}

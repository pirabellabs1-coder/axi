import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/permissions";
import { ADMIN_MFA_ENROLL_PATH, ADMIN_MFA_REQUIRED_MESSAGE, adminMfaGate, effectivePlatformRole, roleCan, type AdminPermission, type PlatformRole } from "./roles";

export type AdminContext = {
  user: CurrentUser;
  role: PlatformRole;
  mfaEnabled: boolean;
  can: (perm: AdminPermission) => boolean;
};

/** En-tête posé par le proxy (src/proxy.ts) sur les requêtes /admin : chemin demandé, écrasé à chaque requête. */
export const ADMIN_PATH_HEADER = "x-axi-pathname";

/**
 * Contexte de l'équipe plateforme (rôle relu en base à chaque requête, mis en cache par requête).
 * Compte à l'e-mail non vérifié : aucun accès à la console.
 */
export const loadAdminContext = cache(async (): Promise<AdminContext | null> => {
  const user = await getCurrentUser();
  if (!user || !user.isPlatformAdmin || !user.emailVerified) return null;
  // isPlatformAdmin vient déjà de la base (getCurrentUser relit l'utilisateur à chaque requête) ;
  // le rôle et l'état MFA sont lus ici.
  const row = await db.user.findUnique({ where: { id: user.id }, select: { platformRole: true, mfaEnabled: true } });
  const role = effectivePlatformRole({ isPlatformAdmin: user.isPlatformAdmin, platformRole: row?.platformRole });
  if (!role) return null;
  return { user, role, mfaEnabled: !!row?.mfaEnabled, can: (perm) => roleCan(role, perm) };
});

/**
 * Pages : redirige si non connecté ou hors équipe plateforme. Sans double authentification (et sauf
 * `ADMIN_MFA_OPTIONAL=1`), seule la section Sécurité de /admin/equipe est accessible.
 */
export async function getAdminContext(): Promise<AdminContext> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?next=/admin");
  const ctx = await loadAdminContext();
  if (!ctx) redirect("/app");
  if (!ctx.mfaEnabled) {
    const path = (await headers()).get(ADMIN_PATH_HEADER);
    if (adminMfaGate(ctx.mfaEnabled, { path }) === "enroll") redirect(`${ADMIN_MFA_ENROLL_PATH}?mfa=requise#securite`);
  }
  return ctx;
}

/**
 * Actions : lève AuthError (jamais de redirect) si la permission manque, ou si la MFA n'est pas activée
 * (sauf actions d'inscription MFA : `allowWithoutMfa`).
 */
export async function requireAdminPermission(perm: AdminPermission, opts: { allowWithoutMfa?: boolean } = {}): Promise<AdminContext> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Connexion requise", "UNAUTHENTICATED");
  const ctx = await loadAdminContext();
  if (!ctx) throw new AuthError("Réservé à l'équipe de la plateforme");
  if (adminMfaGate(ctx.mfaEnabled, { allowWithoutMfa: opts.allowWithoutMfa }) === "enroll") throw new AuthError(ADMIN_MFA_REQUIRED_MESSAGE);
  if (!ctx.can(perm)) throw new AuthError("Votre rôle plateforme ne permet pas cette action");
  return ctx;
}

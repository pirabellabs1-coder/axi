import "server-only";
import { db } from "@/lib/db";

/**
 * Collaborateurs développeurs (StoreCollaborator) — lectures partagées par le portail développeur
 * (installation de test) et l'espace marchand. Les actions (inviter, accepter, révoquer) vivent dans
 * `collaborator-actions.ts`.
 */

/** Permissions possibles d'un collaborateur sur une boutique. */
export const COLLABORATOR_PERMISSIONS = ["apps.test_install", "apps.manage_installs"] as const;
export type CollaboratorPermission = (typeof COLLABORATOR_PERMISSIONS)[number];

/** Boutiques où l'utilisateur est collaborateur ACTIF (invitation acceptée, non révoquée). */
export async function listCollaboratorStores(userId: string) {
  return db.storeCollaborator.findMany({
    where: { userId, status: "ACTIVE", revokedAt: null },
    select: { id: true, permissions: true, store: { select: { id: true, name: true, slug: true } } },
    orderBy: { acceptedAt: "desc" },
  });
}

/** L'utilisateur est-il collaborateur actif de cette boutique avec cette permission ? */
export async function hasCollaboratorPermission(userId: string, storeId: string, permission: CollaboratorPermission): Promise<boolean> {
  const c = await db.storeCollaborator.findFirst({
    where: { userId, storeId, status: "ACTIVE", revokedAt: null },
    select: { permissions: true },
  });
  return !!c && c.permissions.includes(permission);
}

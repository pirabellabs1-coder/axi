import "server-only";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { isCollaboratorToken } from "@/lib/apps/collaborator-logic";

/** Lecture d'une invitation développeur par jeton brut (lecture serveur, pas une action). */
export async function getCollaboratorInvite(token: string) {
  if (!isCollaboratorToken(token)) return null;
  return db.storeCollaborator.findUnique({
    where: { tokenHash: sha256(token) },
    select: {
      id: true,
      email: true,
      status: true,
      permissions: true,
      message: true,
      expiresAt: true,
      revokedAt: true,
      store: { select: { name: true, logoUrl: true, status: true } },
      invitedBy: { select: { name: true } },
    },
  });
}

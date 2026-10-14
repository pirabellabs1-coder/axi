import "server-only";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";

/** Lecture d'une invitation par jeton brut (page /invitation/[token]). Fonction serveur, pas une action. */
export async function getInvitationByToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db.invitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { store: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } }, invitedBy: { select: { name: true } } },
  });
}

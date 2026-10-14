"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/permissions";
import { SESSION_COOKIE, destroySession } from "@/lib/auth/session";
import { sha256 } from "@/lib/crypto";
import { verifyPassword } from "@/lib/auth/password";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";

/** Déconnecte tous les autres appareils (conserve la session courante). */
export async function revokeOtherSessions(): Promise<ActionResult<{ count: number }>> {
  return guard(async () => {
    const user = await requireUserOrThrow();
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    const current = token ? sha256(token) : "";
    const r = await db.session.deleteMany({ where: { userId: user.id, tokenHash: { not: current } } });
    await audit({ actorId: user.id, action: "user.sessions_revoked", metadata: { count: r.count } });
    revalidatePath("/app/compte");
    return success({ count: r.count }, r.count === 0 ? "Aucun autre appareil connecté" : `${r.count} appareil${r.count > 1 ? "s" : ""} déconnecté${r.count > 1 ? "s" : ""}`);
  });
}

/** Déconnecte une session précise de l'utilisateur. */
export async function revokeSession(sessionId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUserOrThrow();
    const r = await db.session.deleteMany({ where: { id: sessionId, userId: user.id } });
    if (r.count === 0) return fail("Session introuvable.");
    revalidatePath("/app/compte");
    return success(undefined, "Appareil déconnecté");
  });
}

/**
 * Suppression du compte. Refusée si l'utilisateur est OWNER d'une boutique non archivée
 * (il doit d'abord transférer la propriété ou archiver). Mot de passe exigé.
 */
export async function deleteAccount(password: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUserOrThrow();
    const owned = await db.membership.count({ where: { userId: user.id, role: "OWNER", store: { status: { not: "ARCHIVED" } } } });
    if (owned > 0) return fail(`Vous êtes propriétaire de ${owned} boutique${owned > 1 ? "s" : ""} active${owned > 1 ? "s" : ""}. Archivez-la ou transférez la propriété avant de supprimer votre compte.`);
    const full = await db.user.findUnique({ where: { id: user.id } });
    if (!full || !(await verifyPassword(full.passwordHash, password))) return fail("Mot de passe incorrect.");
    if (full.isPlatformAdmin) return fail("Un compte administrateur plateforme ne peut pas être supprimé depuis cette page.");
    await audit({ actorId: user.id, action: "user.deleted", metadata: { email: user.email } });
    await destroySession();
    // Cascade : sessions, memberships, tokens. Les journaux d'audit conservent actorId = null (SetNull).
    await db.user.delete({ where: { id: user.id } });
    redirect("/?compte=supprime");
  });
}

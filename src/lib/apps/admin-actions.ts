"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/permissions";
import { badIds, fail, guard, success, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { reviewOutcome, type ReviewAction } from "./admin-logic";

/**
 * Revue des applications par la plateforme. Pattern admin (docs/CONVENTIONS.md) : dans l'action, on
 * vérifie l'administrateur via getCurrentUser + isPlatformAdmin et on lève AuthError (jamais de
 * redirect). Actions auditées sous le préfixe `admin.app.*`.
 */

const ADMIN_ACTIONS: ReviewAction[] = ["publish", "reject", "suspend"];

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Connexion requise", "UNAUTHENTICATED");
  if (!user.isPlatformAdmin) throw new AuthError("Accès réservé à l'administration.");
  return user;
}

/**
 * Applique une décision de revue :
 *  - publish → PUBLISHED + listed (visible au catalogue marchand) ;
 *  - reject  → DRAFT (renvoyée au développeur), `reason` consignée dans l'audit ;
 *  - suspend → SUSPENDED + délistée.
 */
export async function reviewApp(appId: string, action: ReviewAction, reason?: string): Promise<ActionResult> {
  return guard(async () => {
    if (badIds(appId)) return fail("Application invalide.");
    if (!ADMIN_ACTIONS.includes(action)) return fail("Décision invalide.");
    const user = await requireAdmin();

    const app = await db.app.findUnique({ where: { id: appId }, select: { id: true, slug: true, name: true, status: true, firstParty: true } });
    if (!app) return fail("Application introuvable.");

    const outcome = reviewOutcome(action, app.status);
    if (!outcome) return fail("Cette décision n'est pas possible dans l'état actuel de l'application.");

    const trimmedReason = reason?.trim().slice(0, 500) || null;

    await db.$transaction(async (tx) => {
      await tx.app.update({ where: { id: app.id }, data: { status: outcome.status, listed: outcome.listed } });
      await audit(
        { actorId: user.id, action: `admin.app.${action}`, target: app.id, metadata: { slug: app.slug, from: app.status, to: outcome.status, ...(trimmedReason ? { reason: trimmedReason } : {}) } },
        tx,
      );
    });

    revalidatePath("/admin/applications");
    const label = action === "publish" ? "publiée" : action === "reject" ? "renvoyée en brouillon" : "suspendue";
    return success(undefined, `« ${app.name} » ${label}.`);
  });
}

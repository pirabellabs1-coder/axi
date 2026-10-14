"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireStore, requireUserOrThrow } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, badIds, type ActionResult } from "@/lib/action";
import { sha256 } from "@/lib/crypto";
import { randomToken } from "@/lib/utils";
import { sendMail } from "@/lib/email";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { SITE } from "@/config/site";
import {
  collaboratorInviteSchema,
  collaboratorInviteExpiry,
  collaboratorState,
  canTransition,
  acceptanceProblem,
  isCollaboratorToken,
  ACCEPT_PROBLEM_MESSAGES,
  COLLAB_INVITE_DAYS,
  COLLAB_PERMISSION_LABELS,
  type CollaboratorStatusValue,
} from "./collaborator-logic";
import type { CollaboratorPermission } from "./collaborators";

/**
 * Collaborateurs développeurs (équivalent des « collaborateurs » Shopify).
 * Le propriétaire invite un développeur par e-mail ; seul le hash du jeton est stocké.
 * Capacité : `integrations.manage` (propriétaire uniquement, comme les webhooks et l'API).
 */
const CAPABILITY = "integrations.manage" as const;

function pagePath(storeId: string) {
  return `/app/${storeId}/developpeurs`;
}

function inviteText(storeName: string, inviter: string, token: string, permissions: string[], message?: string | null) {
  const url = `${SITE.url}/invitation-developpeur/${token}`;
  const perms = permissions.map((p) => `- ${COLLAB_PERMISSION_LABELS[p as CollaboratorPermission]?.title ?? p}`).join("\n");
  const note = message ? `\n\nMessage de ${inviter} :\n« ${message} »` : "";
  return `${inviter} vous invite comme développeur collaborateur de la boutique « ${storeName} » sur ${SITE.name}.\n\nVous pourrez :\n${perms}\n\nVous n'aurez accès ni aux commandes, ni aux clients, ni aux paiements, ni aux réglages.${note}\n\nAcceptez l'invitation (valable ${COLLAB_INVITE_DAYS} jours) :\n${url}\n\nSi vous n'attendiez pas cette invitation, ignorez ce message.`;
}

/** Envoi hors transaction : un échec d'envoi ne doit pas annuler l'invitation (elle peut être renvoyée). */
async function sendInvite(to: string, storeName: string, text: string): Promise<boolean> {
  try {
    const r = await sendMail({ to, subject: `Invitation développeur : ${storeName} sur ${SITE.name}`, text });
    return r.ok;
  } catch (e) {
    console.error("[collaborators] envoi de l'invitation", e);
    return false;
  }
}

export async function inviteDeveloper(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(collaboratorInviteSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { storeId, email, permissions, message } = parsed.data;
    const ctx = await requireStore(storeId, CAPABILITY);

    const rl = await rateLimit(`collab-invite:${ctx.store.id}`, 20, 3600);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    if (email === ctx.user.email.toLowerCase()) return fail("Vous ne pouvez pas vous inviter vous-même.", { email: ["Adresse du propriétaire"] });

    const existing = await db.storeCollaborator.findUnique({ where: { storeId_email: { storeId: ctx.store.id, email } } });
    if (existing && collaboratorState(existing) === "active") {
      return fail("Ce développeur est déjà collaborateur de la boutique.", { email: ["Déjà collaborateur"] });
    }
    if (existing && !canTransition(existing.status as CollaboratorStatusValue, "PENDING")) return fail("Invitation impossible dans cet état.");

    const token = randomToken(32);
    const data = {
      status: "PENDING" as const,
      permissions,
      message: message ?? null,
      tokenHash: sha256(token),
      invitedById: ctx.user.id,
      expiresAt: collaboratorInviteExpiry(),
      userId: null,
      acceptedAt: null,
      revokedAt: null,
    };
    await db.$transaction(async (tx) => {
      const row = await tx.storeCollaborator.upsert({
        where: { storeId_email: { storeId: ctx.store.id, email } },
        create: { storeId: ctx.store.id, email, ...data },
        update: data,
      });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "collaborator.invited", target: row.id, metadata: { email, permissions } }, tx);
    });

    const sent = await sendInvite(email, ctx.store.name, inviteText(ctx.store.name, ctx.user.name, token, permissions, message));
    revalidatePath(pagePath(ctx.store.id));
    if (!sent) return success(undefined, `Invitation créée, mais l'e-mail n'a pas pu partir. Renvoyez-la à ${email}.`);
    return success(undefined, `Invitation envoyée à ${email}`);
  });
}

/** Renvoie une invitation en attente (ou expirée) avec un nouveau jeton et une nouvelle échéance. */
export async function resendInvite(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    if (badIds(storeId, id)) return fail("Requête invalide.");
    const ctx = await requireStore(storeId, CAPABILITY);
    const row = await db.storeCollaborator.findFirst({ where: { id, storeId: ctx.store.id } });
    if (!row) return fail("Invitation introuvable.");
    if (row.status !== "PENDING") return fail("Seule une invitation en attente peut être renvoyée.");

    const rl = await rateLimit(`collab-invite:${ctx.store.id}`, 20, 3600);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const token = randomToken(32);
    const r = await db.storeCollaborator.updateMany({
      where: { id: row.id, storeId: ctx.store.id, status: "PENDING" },
      data: { tokenHash: sha256(token), expiresAt: collaboratorInviteExpiry(), invitedById: ctx.user.id },
    });
    if (r.count === 0) return fail("Invitation introuvable.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "collaborator.reinvited", target: row.id, metadata: { email: row.email } });

    const sent = await sendInvite(row.email, ctx.store.name, inviteText(ctx.store.name, ctx.user.name, token, row.permissions, row.message));
    revalidatePath(pagePath(ctx.store.id));
    if (!sent) return fail("L'e-mail n'a pas pu être envoyé. Réessayez dans un instant.");
    return success(undefined, `Invitation renvoyée à ${row.email}`);
  });
}

/**
 * Révoque un collaborateur (ou une invitation en attente) et désinstalle les installations de test qu'il a faites
 * sur la boutique : apps dont il est le développeur ET qu'il a lui-même installées. Les apps installées par le
 * marchand ne sont jamais touchées.
 */
export async function revokeCollaborator(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    if (badIds(storeId, id)) return fail("Requête invalide.");
    const ctx = await requireStore(storeId, CAPABILITY);
    const row = await db.storeCollaborator.findFirst({ where: { id, storeId: ctx.store.id } });
    if (!row) return fail("Collaborateur introuvable.");
    if (!canTransition(row.status as CollaboratorStatusValue, "REVOKED")) return fail("Ce collaborateur est déjà révoqué.");

    let removed = 0;
    await db.$transaction(async (tx) => {
      const now = new Date();
      await tx.storeCollaborator.update({ where: { id: row.id }, data: { status: "REVOKED", revokedAt: now } });

      if (row.userId) {
        const apps = await tx.app.findMany({ where: { developerUserId: row.userId }, select: { id: true } });
        const installs = apps.length
          ? await tx.appInstallation.findMany({
              where: { storeId: ctx.store.id, installedById: row.userId, appId: { in: apps.map((a) => a.id) }, status: { not: "UNINSTALLED" } },
              select: { id: true, appId: true, oauthGrantId: true },
            })
          : [];
        for (const inst of installs) {
          await tx.appInstallation.update({
            where: { id: inst.id },
            data: { status: "UNINSTALLED", uninstalledAt: now, oauthGrantId: null, billingStatus: "cancelled" },
          });
          if (inst.oauthGrantId) {
            await tx.oAuthGrant.updateMany({ where: { id: inst.oauthGrantId, revokedAt: null }, data: { revokedAt: now } });
            await tx.oAuthToken.updateMany({ where: { grantId: inst.oauthGrantId, revokedAt: null }, data: { revokedAt: now } });
          }
          await tx.app.updateMany({ where: { id: inst.appId, installCount: { gt: 0 } }, data: { installCount: { decrement: 1 } } });
          await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "app.uninstalled", target: inst.appId, metadata: { installationId: inst.id, reason: "collaborator.revoked" } }, tx);
          // Même outbox que uninstallApp : l'app reçoit app.uninstalled (écrit dans la transaction).
          await enqueue("app.uninstalled", { storeId: ctx.store.id, appId: inst.appId, installationId: inst.id, test: true, reason: "collaborator.revoked" }, { storeId: ctx.store.id }, tx);
        }
        removed = installs.length;
      }
      await audit(
        { storeId: ctx.store.id, actorId: ctx.user.id, action: "collaborator.revoked", target: row.id, metadata: { email: row.email, wasActive: row.status === "ACTIVE", uninstalled: removed } },
        tx,
      );
    });

    revalidatePath(pagePath(ctx.store.id));
    revalidatePath(`/app/${ctx.store.id}/applications`);
    const extra = removed > 0 ? ` ${removed} installation${removed > 1 ? "s" : ""} de test désinstallée${removed > 1 ? "s" : ""}.` : "";
    return success(undefined, `${row.status === "ACTIVE" ? "Accès révoqué" : "Invitation révoquée"}.${extra}`);
  });
}

async function loadByToken(token: string) {
  if (!isCollaboratorToken(token)) return null;
  return db.storeCollaborator.findUnique({ where: { tokenHash: sha256(token) }, include: { store: { select: { id: true, name: true, status: true } } } });
}

/** Accepte l'invitation : utilisateur connecté et vérifié, dont l'e-mail correspond à l'invitation. */
export async function acceptInvite(token: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUserOrThrow();
    const row = await loadByToken(token);
    const problem = acceptanceProblem(row, user.email);
    if (problem || !row) return fail(ACCEPT_PROBLEM_MESSAGES[problem ?? "unknown"]);
    if (row.store.status === "ARCHIVED") return fail("Cette boutique est archivée.");

    const r = await db.$transaction(async (tx) => {
      // Conditionnel : une révocation concurrente ou un double clic ne peuvent pas réactiver l'invitation.
      const u = await tx.storeCollaborator.updateMany({
        where: { id: row.id, storeId: row.storeId, status: "PENDING", expiresAt: { gt: new Date() } },
        data: { status: "ACTIVE", userId: user.id, acceptedAt: new Date() },
      });
      if (u.count === 1) await audit({ storeId: row.storeId, actorId: user.id, action: "collaborator.accepted", target: row.id, metadata: { permissions: row.permissions } }, tx);
      return u.count;
    });
    if (r !== 1) return fail(ACCEPT_PROBLEM_MESSAGES.revoked);
    revalidatePath(pagePath(row.storeId));
    redirect("/developpeur");
  });
}

/** Refuse l'invitation : elle passe à REVOKED (l'enum n'a pas d'état « refusé » ; l'audit le distingue). */
export async function declineInvite(token: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUserOrThrow();
    const row = await loadByToken(token);
    const problem = acceptanceProblem(row, user.email);
    if (problem || !row) return fail(ACCEPT_PROBLEM_MESSAGES[problem ?? "unknown"]);
    const u = await db.storeCollaborator.updateMany({
      where: { id: row.id, storeId: row.storeId, status: "PENDING" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    if (u.count !== 1) return fail(ACCEPT_PROBLEM_MESSAGES.revoked);
    await audit({ storeId: row.storeId, actorId: user.id, action: "collaborator.declined", target: row.id });
    revalidatePath(pagePath(row.storeId));
    return success(undefined, "Invitation refusée");
  });
}

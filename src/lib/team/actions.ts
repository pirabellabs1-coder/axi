"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { MembershipRole } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, requireUserOrThrow, effectivePlanId, ROLE_LABELS } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, type ActionResult } from "@/lib/action";
import { sha256 } from "@/lib/crypto";
import { randomToken, addDays } from "@/lib/utils";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { SITE } from "@/config/site";
import { getInvitationByToken } from "./invitations";
import { teamSeats, seatsMessage } from "./seats";

const INVITABLE: MembershipRole[] = ["MANAGER", "STAFF"];
const ASSIGNABLE: MembershipRole[] = ["OWNER", "MANAGER", "STAFF"];
const INVITE_DAYS = 7;

const inviteSchema = z.object({
  storeId: z.string(),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide"),
  role: z.enum(INVITABLE as [MembershipRole, ...MembershipRole[]]),
});

function inviteText(storeName: string, role: MembershipRole, token: string, inviter: string) {
  const url = `${SITE.url}/invitation/${token}`;
  return `${inviter} vous invite à rejoindre la boutique « ${storeName} » sur ${SITE.name} en tant que ${ROLE_LABELS[role]}.\n\nAcceptez l'invitation (valable ${INVITE_DAYS} jours) :\n${url}\n\nSi vous n'attendiez pas cette invitation, ignorez ce message.`;
}

export async function inviteMember(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(inviteSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { storeId, email, role } = parsed.data;
    const ctx = await requireStore(storeId, "team.manage");

    const already = await db.membership.findFirst({ where: { storeId: ctx.store.id, user: { email } } });
    if (already) return fail("Cette personne est déjà membre de la boutique.", { email: ["Déjà membre"] });
    const pending = await db.invitation.findFirst({ where: { storeId: ctx.store.id, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (pending) return fail("Une invitation est déjà en attente pour cet e-mail. Renvoyez-la ou révoquez-la.", { email: ["Invitation en attente"] });

    const token = randomToken(32);
    const blocked = await db.$transaction(async (tx) => {
      // Contrôle de place dans la transaction : membres + invitations en attente <= limite effective.
      // Verrou par boutique : deux invitations simultanées ne peuvent pas dépasser la limite.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team:${ctx.store.id}`}))`;
      const seats = await teamSeats(ctx.store.id, ctx.planId, tx);
      if (!seats.allowed) return seatsMessage(seats, ctx.planId);
      await tx.invitation.create({ data: { storeId: ctx.store.id, email, role, tokenHash: sha256(token), invitedById: ctx.user.id, expiresAt: addDays(new Date(), INVITE_DAYS) } });
      await enqueue("member.invited", { email, storeName: ctx.store.name, text: inviteText(ctx.store.name, role, token, ctx.user.name) }, { storeId: ctx.store.id }, tx);
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "member.invited", metadata: { email, role } }, tx);
      return null;
    });
    if (blocked) return fail(blocked);
    revalidatePath(`/app/${ctx.store.id}/equipe`);
    return success(undefined, `Invitation envoyée à ${email}`);
  });
}

/** Renvoie l'invitation avec un nouveau jeton et une nouvelle expiration. */
export async function resendInvitation(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "team.manage");
    const inv = await db.invitation.findFirst({ where: { id, storeId: ctx.store.id, acceptedAt: null, revokedAt: null } });
    if (!inv) return fail("Invitation introuvable.");
    // Une invitation expirée ne réserve plus de place : la relancer en reprend une.
    if (inv.expiresAt <= new Date()) {
      const seats = await teamSeats(ctx.store.id, ctx.planId);
      if (!seats.allowed) return fail(seatsMessage(seats, ctx.planId));
    }
    const token = randomToken(32);
    await db.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id: inv.id }, data: { tokenHash: sha256(token), expiresAt: addDays(new Date(), INVITE_DAYS) } });
      await enqueue("member.invited", { email: inv.email, storeName: ctx.store.name, text: inviteText(ctx.store.name, inv.role, token, ctx.user.name) }, { storeId: ctx.store.id }, tx);
    });
    revalidatePath(`/app/${ctx.store.id}/equipe`);
    return success(undefined, `Invitation renvoyée à ${inv.email}`);
  });
}

export async function revokeInvitation(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "team.manage");
    const r = await db.invitation.updateMany({ where: { id, storeId: ctx.store.id, acceptedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) return fail("Invitation introuvable.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "invitation.revoked", target: id });
    revalidatePath(`/app/${ctx.store.id}/equipe`);
    return success(undefined, "Invitation révoquée");
  });
}

export async function changeMemberRole(storeId: string, membershipId: string, role: MembershipRole): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "team.manage");
    if (!ASSIGNABLE.includes(role)) return fail("Rôle non attribuable.");
    const m = await db.membership.findFirst({ where: { id: membershipId, storeId: ctx.store.id } });
    if (!m) return fail("Membre introuvable.");
    if (m.role === "SUPPORT") return fail("Un accès support ne peut pas être modifié ici.");
    if (m.role === "OWNER" && role !== "OWNER") {
      const owners = await db.membership.count({ where: { storeId: ctx.store.id, role: "OWNER" } });
      if (owners <= 1) return fail("Impossible : la boutique doit conserver au moins un propriétaire. Nommez d'abord un autre propriétaire.");
    }
    await db.membership.update({ where: { id: m.id }, data: { role } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "member.role_changed", target: m.userId, metadata: { from: m.role, to: role } });
    revalidatePath(`/app/${ctx.store.id}`, "layout");
    return success(undefined, `Rôle mis à jour : ${ROLE_LABELS[role]}`);
  });
}

export async function removeMember(storeId: string, membershipId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "team.manage");
    const m = await db.membership.findFirst({ where: { id: membershipId, storeId: ctx.store.id } });
    if (!m) return fail("Membre introuvable.");
    if (m.role === "OWNER") {
      const owners = await db.membership.count({ where: { storeId: ctx.store.id, role: "OWNER" } });
      if (owners <= 1) return fail("Impossible de retirer le seul propriétaire.");
    }
    await db.membership.delete({ where: { id: m.id } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "member.removed", target: m.userId, metadata: { role: m.role } });
    revalidatePath(`/app/${ctx.store.id}`, "layout");
    if (m.userId === ctx.user.id) redirect("/app");
    return success(undefined, "Membre retiré");
  });
}

/** Accepte l'invitation : vérifie hash, expiration, révocation, e-mail = utilisateur connecté. */
export async function acceptInvitation(token: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUserOrThrow();
    const inv = await getInvitationByToken(token);
    if (!inv) return fail("Invitation introuvable ou lien invalide.");
    if (inv.revokedAt) return fail("Cette invitation a été révoquée.");
    if (inv.acceptedAt) return fail("Cette invitation a déjà été acceptée.");
    if (inv.expiresAt < new Date()) return fail("Cette invitation a expiré. Demandez au propriétaire de la renvoyer.");
    if (inv.email !== user.email.toLowerCase()) return fail(`Cette invitation est destinée à ${inv.email}. Connectez-vous avec cette adresse.`);
    if (inv.store.status === "ARCHIVED") return fail("Cette boutique est archivée.");

    const existing = await db.membership.findUnique({ where: { userId_storeId: { userId: user.id, storeId: inv.storeId } } });
    if (!existing || existing.role === "SUPPORT") {
      // Garde-fou si le plan a baissé depuis l'invitation : les membres actifs ne doivent pas dépasser la limite.
      const sub = await db.subscription.findUnique({ where: { storeId: inv.storeId } });
      const seats = await teamSeats(inv.storeId, effectivePlanId(sub));
      if (seats.limit != null && seats.members >= seats.limit) {
        return fail("Cette boutique a atteint sa limite de membres. Demandez au propriétaire de libérer une place ou d'en ajouter une.");
      }
    }
    await db.$transaction(async (tx) => {
      if (existing) await tx.membership.update({ where: { id: existing.id }, data: { role: inv.role, expiresAt: null } });
      else await tx.membership.create({ data: { userId: user.id, storeId: inv.storeId, role: inv.role } });
      await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      await audit({ storeId: inv.storeId, actorId: user.id, action: "member.joined", metadata: { role: inv.role, invitedBy: inv.invitedById } }, tx);
    });
    revalidatePath(`/app/${inv.storeId}`, "layout");
    redirect(`/app/${inv.storeId}`);
  });
}

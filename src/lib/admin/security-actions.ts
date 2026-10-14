"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { encryptSecret, sha256 } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { SITE } from "@/config/site";
import { rateLimitMessage } from "@/lib/rate-limit";
import { generateBackupCodes, generateTotpSecret, hashBackupCode, otpauthUri } from "@/lib/auth/mfa";
import { requireAdminPermission } from "./context";
import { mfaSettingKey, readMfaState, verifyUserSecondFactor, writeMfaState } from "./mfa-server";
import { PLATFORM_ROLES, effectivePlatformRole, roleCan, type PlatformRole } from "./roles";

/**
 * Sécurité de l'équipe plateforme : double authentification (TOTP) du compte courant et
 * gestion des membres de l'équipe (rôles SUPER_ADMIN / SUPPORT / FINANCE).
 */

const zCode = z.string().trim().min(6, "Saisissez le code à 6 chiffres").max(20);

function revalidateTeam() {
  revalidatePath("/admin/equipe");
  revalidatePath("/admin", "layout");
}

// ─────────────────────────── Double authentification (compte courant) ───────────────────────────

/** Étape 1 : génère un secret (chiffré, non exigé tant que l'inscription n'est pas confirmée). */
export async function startMfaEnrollment(): Promise<ActionResult<{ secret: string; uri: string }>> {
  return guard(async () => {
    const { user } = await requireAdminPermission("read", { allowWithoutMfa: true });
    const row = await db.user.findUnique({ where: { id: user.id }, select: { mfaEnabled: true } });
    if (row?.mfaEnabled) return fail("La double authentification est déjà active sur votre compte.");
    const secret = generateTotpSecret();
    await db.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptSecret(secret) } });
    await audit({ actorId: user.id, action: "admin.mfa.enrollment_started" });
    return success({ secret, uri: otpauthUri({ secret, account: user.email, issuer: SITE.name }) });
  });
}

/** Étape 2 : un premier code valide active la MFA et renvoie (une seule fois) les codes de secours. */
export async function confirmMfaEnrollment(code: string): Promise<ActionResult<{ backupCodes: string[] }>> {
  return guard(async () => {
    const { user } = await requireAdminPermission("read", { allowWithoutMfa: true });
    const parsed = zCode.safeParse(code);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Code invalide");
    const row = await db.user.findUnique({ where: { id: user.id }, select: { mfaEnabled: true, mfaSecretEnc: true } });
    if (row?.mfaEnabled) return fail("La double authentification est déjà active.");
    if (!row?.mfaSecretEnc) return fail("Recommencez l'inscription : aucune clé en cours.");
    const r = await verifyUserSecondFactor(user.id, parsed.data, { allowBackup: false, requireEnabled: false });
    if (!r.ok) return fail(r.retryAfter ? rateLimitMessage(r.retryAfter) : "Code incorrect. Vérifiez l'heure de votre téléphone et réessayez.");
    const codes = generateBackupCodes(8);
    const state = await readMfaState(user.id);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const current = token ? sha256(token) : "";
    const revoked = await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
      await writeMfaState(user.id, { ...state, backup: codes.map(hashBackupCode) }, tx);
      // Les autres appareils devront se reconnecter avec le second facteur.
      const { count } = await tx.session.deleteMany({ where: { userId: user.id, tokenHash: { not: current } } });
      await audit({ actorId: user.id, action: "admin.mfa.enabled", metadata: { otherSessionsRevoked: count } }, tx);
      return count;
    });
    revalidateTeam();
    return success({ backupCodes: codes }, revoked > 0 ? "Double authentification activée. Vos autres appareils ont été déconnectés." : "Double authentification activée");
  });
}

export async function cancelMfaEnrollment(): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("read", { allowWithoutMfa: true });
    await db.user.updateMany({ where: { id: user.id, mfaEnabled: false }, data: { mfaSecretEnc: null } });
    revalidateTeam();
    return success(undefined, "Inscription annulée");
  });
}

export async function regenerateBackupCodes(code: string): Promise<ActionResult<{ backupCodes: string[] }>> {
  return guard(async () => {
    const { user } = await requireAdminPermission("read");
    const parsed = zCode.safeParse(code);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Code invalide");
    const r = await verifyUserSecondFactor(user.id, parsed.data, { allowBackup: false });
    if (!r.ok) return fail(r.retryAfter ? rateLimitMessage(r.retryAfter) : "Code incorrect.");
    const codes = generateBackupCodes(8);
    const state = await readMfaState(user.id);
    await writeMfaState(user.id, { ...state, backup: codes.map(hashBackupCode) });
    await audit({ actorId: user.id, action: "admin.mfa.backup_regenerated" });
    revalidateTeam();
    return success({ backupCodes: codes }, "Nouveaux codes de secours générés");
  });
}

export async function disableMfa(code: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("read");
    const parsed = zCode.safeParse(code);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Code invalide");
    const r = await verifyUserSecondFactor(user.id, parsed.data);
    if (!r.ok) return fail(r.retryAfter ? rateLimitMessage(r.retryAfter) : "Code incorrect.");
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEnc: null } });
      await tx.platformSetting.deleteMany({ where: { key: mfaSettingKey(user.id) } });
      await audit({ actorId: user.id, action: "admin.mfa.disabled" }, tx);
    });
    revalidateTeam();
    return success(undefined, "Double authentification désactivée");
  });
}

// ─────────────────────────── Équipe plateforme ───────────────────────────

const zRole = z.enum(PLATFORM_ROLES as [PlatformRole, ...PlatformRole[]]);

async function otherSuperAdmins(exceptUserId: string): Promise<number> {
  const admins = await db.user.findMany({ where: { isPlatformAdmin: true, id: { not: exceptUserId } }, select: { isPlatformAdmin: true, platformRole: true } });
  return admins.filter((a) => effectivePlatformRole(a) === "SUPER_ADMIN").length;
}

export async function addTeamMember(email: string, role: PlatformRole): Promise<ActionResult> {
  return guard(async () => {
    const { user: actor } = await requireAdminPermission("team.manage");
    const parsed = z.object({ email: z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(254), role: zRole }).safeParse({ email, role });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const user = await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, isPlatformAdmin: true, emailVerifiedAt: true } });
    if (!user) return fail("Aucun compte avec cette adresse. La personne doit d'abord créer son compte Axi.");
    if (user.isPlatformAdmin) return fail("Cette personne fait déjà partie de l'équipe.");
    if (!user.emailVerifiedAt) return fail("Le compte n'a pas encore vérifié son adresse e-mail.");
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true, platformRole: parsed.data.role } });
      await audit({ actorId: actor.id, action: "admin.team.added", target: user.id, metadata: { email: parsed.data.email, role: parsed.data.role } }, tx);
    });
    revalidateTeam();
    return success(undefined, "Membre ajouté à l'équipe plateforme");
  });
}

export async function setTeamRole(userId: string, role: PlatformRole): Promise<ActionResult> {
  return guard(async () => {
    const { user: actor } = await requireAdminPermission("team.manage");
    const parsed = zRole.safeParse(role);
    if (!parsed.success) return fail("Rôle invalide");
    if (userId === actor.id) return fail("Vous ne pouvez pas modifier votre propre rôle.");
    const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isPlatformAdmin: true, platformRole: true } });
    if (!target?.isPlatformAdmin) return fail("Membre introuvable");
    const from = effectivePlatformRole(target);
    if (from === parsed.data) return fail("Aucun changement");
    if (from === "SUPER_ADMIN" && (await otherSuperAdmins(userId)) === 0) return fail("Il doit rester au moins un super-administrateur.");
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { platformRole: parsed.data } });
      // Nouveau rôle sans support.access : les accès d'assistance aux boutiques (Membership SUPPORT) tombent.
      const supportRevoked = roleCan(parsed.data, "support.access") ? 0 : (await tx.membership.deleteMany({ where: { userId, role: "SUPPORT" } })).count;
      await audit({ actorId: actor.id, action: "admin.team.role_changed", target: userId, metadata: { email: target.email, from, to: parsed.data, supportRevoked } }, tx);
    });
    revalidateTeam();
    return success(undefined, "Rôle mis à jour");
  });
}

export async function removeTeamMember(userId: string): Promise<ActionResult> {
  return guard(async () => {
    const { user: actor } = await requireAdminPermission("team.manage");
    if (userId === actor.id) return fail("Vous ne pouvez pas vous retirer vous-même de l'équipe.");
    const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isPlatformAdmin: true, platformRole: true } });
    if (!target?.isPlatformAdmin) return fail("Membre introuvable");
    if (effectivePlatformRole(target) === "SUPER_ADMIN" && (await otherSuperAdmins(userId)) === 0) return fail("Il doit rester au moins un super-administrateur.");
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { isPlatformAdmin: false, platformRole: null } });
      // Plus d'équipe plateforme : plus d'accès d'assistance aux boutiques.
      const { count: supportRevoked } = await tx.membership.deleteMany({ where: { userId, role: "SUPPORT" } });
      await audit({ actorId: actor.id, action: "admin.team.removed", target: userId, metadata: { email: target.email, supportRevoked } }, tx);
    });
    revalidateTeam();
    return success(undefined, "Membre retiré de l'équipe");
  });
}

/** Réinitialise la MFA d'un membre (téléphone perdu) : il devra la reconfigurer. Sessions révoquées. */
export async function resetMemberMfa(userId: string): Promise<ActionResult> {
  return guard(async () => {
    const { user: actor } = await requireAdminPermission("team.manage");
    if (userId === actor.id) return fail("Utilisez la section Sécurité pour votre propre compte.");
    const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isPlatformAdmin: true } });
    if (!target?.isPlatformAdmin) return fail("Membre introuvable");
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null } });
      await tx.platformSetting.deleteMany({ where: { key: mfaSettingKey(userId) } });
      const { count } = await tx.session.deleteMany({ where: { userId } });
      await audit({ actorId: actor.id, action: "admin.team.mfa_reset", target: userId, metadata: { email: target.email, sessionsRevoked: count } }, tx);
    });
    revalidateTeam();
    return success(undefined, "Double authentification réinitialisée, sessions révoquées");
  });
}

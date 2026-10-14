"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { encryptSecret, sha256 } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { SESSION_COOKIE, getCurrentUser } from "@/lib/auth/session";
import { SITE } from "@/config/site";
import { rateLimitMessage } from "@/lib/rate-limit";
import { generateBackupCodes, generateTotpSecret, hashBackupCode, otpauthUri } from "@/lib/auth/mfa";
import { mfaSettingKey, readMfaState, verifyUserSecondFactor, writeMfaState } from "@/lib/admin/mfa-server";

/**
 * Double authentification (TOTP) du COMPTE COURANT, pour tout utilisateur (marchands et leurs équipes).
 * Même mécanique que la console plateforme (src/lib/admin/security-actions.ts) : secret chiffré, inscription
 * en deux étapes, codes de secours hachés, anti-rejeu et limitation de débit dans verifyUserSecondFactor.
 * La connexion exige déjà le second facteur dès que `mfaEnabled` est vrai (src/lib/auth/actions.ts).
 */

const zCode = z.string().trim().min(6, "Saisissez le code à 6 chiffres").max(20);

async function me() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Session expirée : reconnectez-vous.");
  return user;
}

function revalidateAccount() {
  revalidatePath("/app/compte");
}

export async function startAccountMfaEnrollment(): Promise<ActionResult<{ secret: string; uri: string }>> {
  return guard(async () => {
    const user = await me();
    const row = await db.user.findUnique({ where: { id: user.id }, select: { mfaEnabled: true } });
    if (row?.mfaEnabled) return fail("La double authentification est déjà active sur votre compte.");
    const secret = generateTotpSecret();
    await db.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptSecret(secret) } });
    await audit({ actorId: user.id, action: "user.mfa.enrollment_started" });
    return success({ secret, uri: otpauthUri({ secret, account: user.email, issuer: SITE.name }) });
  });
}

export async function confirmAccountMfaEnrollment(code: string): Promise<ActionResult<{ backupCodes: string[] }>> {
  return guard(async () => {
    const user = await me();
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
      const { count } = await tx.session.deleteMany({ where: { userId: user.id, tokenHash: { not: current } } });
      await audit({ actorId: user.id, action: "user.mfa.enabled", metadata: { otherSessionsRevoked: count } }, tx);
      return count;
    });
    revalidateAccount();
    return success({ backupCodes: codes }, revoked > 0 ? "Double authentification activée. Vos autres appareils ont été déconnectés." : "Double authentification activée");
  });
}

export async function cancelAccountMfaEnrollment(): Promise<ActionResult> {
  return guard(async () => {
    const user = await me();
    await db.user.updateMany({ where: { id: user.id, mfaEnabled: false }, data: { mfaSecretEnc: null } });
    revalidateAccount();
    return success(undefined, "Inscription annulée");
  });
}

export async function regenerateAccountBackupCodes(code: string): Promise<ActionResult<{ backupCodes: string[] }>> {
  return guard(async () => {
    const user = await me();
    const parsed = zCode.safeParse(code);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Code invalide");
    const r = await verifyUserSecondFactor(user.id, parsed.data, { allowBackup: false });
    if (!r.ok) return fail(r.retryAfter ? rateLimitMessage(r.retryAfter) : "Code incorrect.");
    const codes = generateBackupCodes(8);
    const state = await readMfaState(user.id);
    await writeMfaState(user.id, { ...state, backup: codes.map(hashBackupCode) });
    await audit({ actorId: user.id, action: "user.mfa.backup_regenerated" });
    revalidateAccount();
    return success({ backupCodes: codes }, "Nouveaux codes de secours générés");
  });
}

export async function disableAccountMfa(code: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await me();
    const row = await db.user.findUnique({ where: { id: user.id }, select: { isPlatformAdmin: true } });
    // La double authentification est obligatoire pour l'équipe plateforme : elle se gère depuis la console.
    if (row?.isPlatformAdmin) return fail("Compte de l'équipe Axi : la double authentification est obligatoire et se gère depuis la console.");
    const parsed = zCode.safeParse(code);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Code invalide");
    const r = await verifyUserSecondFactor(user.id, parsed.data);
    if (!r.ok) return fail(r.retryAfter ? rateLimitMessage(r.retryAfter) : "Code incorrect.");
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEnc: null } });
      await tx.platformSetting.deleteMany({ where: { key: mfaSettingKey(user.id) } });
      await audit({ actorId: user.id, action: "user.mfa.disabled" }, tx);
    });
    revalidateAccount();
    return success(undefined, "Double authentification désactivée");
  });
}

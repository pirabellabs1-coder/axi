import "server-only";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { db, type Tx } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { decryptSecret, isPlaceholderSecret } from "@/lib/crypto";
import { base32Decode, consumeBackupCode, signMfaPending, verifyMfaPending, verifyTotp, type MfaPending } from "@/lib/auth/mfa";

/**
 * Persistance de la double authentification (TOTP) :
 *  - secret base32 chiffré (AES-256-GCM, encryptSecret) dans User.mfaSecretEnc. Tant que
 *    User.mfaEnabled est faux, ce secret est une inscription en cours (non exigée à la connexion) ;
 *  - codes de secours hachés + dernier pas TOTP accepté (anti-rejeu) dans PlatformSetting
 *    clé `mfa:{userId}` (aucun changement de schéma) ;
 *  - après le mot de passe, jeton signé court dans le cookie `axi_mfa` (5 min) : la session
 *    complète n'est créée qu'après le code (src/app/(auth)/double-authentification).
 */
export const MFA_COOKIE = "axi_mfa";
const MFA_TTL_MS = 5 * 60_000;

export type MfaState = { backup: string[]; lastCounter: number | null };

function signingKey(): string {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("APP_SECRET manquant ou trop court (32 caractères minimum).");
  if (process.env.NODE_ENV === "production" && isPlaceholderSecret(secret)) {
    throw new Error("APP_SECRET contient la valeur d'exemple « change-me » : générez un secret aléatoire avant la mise en production.");
  }
  // Clé dérivée dédiée : un jeton MFA ne peut servir à rien d'autre.
  return createHash("sha256").update(`axi-mfa-pending:${secret}`).digest("hex");
}

export const mfaSettingKey = (userId: string) => `mfa:${userId}`;

export async function readMfaState(userId: string, client: Tx | typeof db = db): Promise<MfaState> {
  const row = await client.platformSetting.findUnique({ where: { key: mfaSettingKey(userId) } });
  const v = (row?.value ?? {}) as Partial<MfaState>;
  return { backup: Array.isArray(v.backup) ? v.backup.filter((x): x is string => typeof x === "string") : [], lastCounter: typeof v.lastCounter === "number" ? v.lastCounter : null };
}

export async function writeMfaState(userId: string, state: MfaState, client: Tx | typeof db = db) {
  await client.platformSetting.upsert({
    where: { key: mfaSettingKey(userId) },
    create: { key: mfaSettingKey(userId), value: state, updatedBy: userId },
    update: { value: state, updatedBy: userId },
  });
}

export type SecondFactorResult = { ok: true; usedBackup: boolean; remainingBackup: number } | { ok: false; retryAfter?: number };

/**
 * Vérifie un code TOTP (avec anti-rejeu) ou un code de secours (consommé).
 * - 6 essais / 15 min par utilisateur (toutes origines : connexion, inscription, régénération, désactivation) ;
 *   `retryAfter` est renseigné quand la limite est atteinte.
 * - Atomique : la ligne d'état `mfa:{userId}` est verrouillée (SELECT … FOR UPDATE) pendant lecture → vérification →
 *   écriture ; deux requêtes simultanées ne peuvent pas accepter le même pas TOTP ni consommer deux fois un code de secours.
 */
export async function verifyUserSecondFactor(userId: string, input: string, opts: { allowBackup?: boolean; requireEnabled?: boolean } = {}): Promise<SecondFactorResult> {
  const rl = await rateLimit(`mfa:user:${userId}`, 6, 900);
  if (!rl.ok) return { ok: false, retryAfter: rl.retryAfter };
  const user = await db.user.findUnique({ where: { id: userId }, select: { mfaSecretEnc: true, mfaEnabled: true } });
  if (!user?.mfaSecretEnc) return { ok: false };
  if (opts.requireEnabled !== false && !user.mfaEnabled) return { ok: false };
  let key: Buffer;
  try {
    key = base32Decode(decryptSecret(user.mfaSecretEnc));
  } catch {
    return { ok: false };
  }
  const settingKey = mfaSettingKey(userId);
  return db.$transaction(async (tx): Promise<SecondFactorResult> => {
    // La ligne doit exister pour être verrouillée (première vérification d'une inscription).
    await tx.$executeRaw`INSERT INTO "PlatformSetting" ("key", "value", "updatedBy", "updatedAt") VALUES (${settingKey}, '{}'::jsonb, ${userId}, now()) ON CONFLICT ("key") DO NOTHING`;
    await tx.$queryRaw`SELECT "key" FROM "PlatformSetting" WHERE "key" = ${settingKey} FOR UPDATE`;
    const state = await readMfaState(userId, tx);
    const digits = input.replace(/\D/g, "");
    if (digits.length === 6 && /^\s*[\d\s]+\s*$/.test(input)) {
      const counter = verifyTotp(key, digits, Date.now(), { window: 1, afterCounter: state.lastCounter });
      if (counter == null) return { ok: false };
      await writeMfaState(userId, { ...state, lastCounter: counter }, tx);
      return { ok: true, usedBackup: false, remainingBackup: state.backup.length };
    }
    if (opts.allowBackup === false) return { ok: false };
    const rest = consumeBackupCode(state.backup, input);
    if (!rest) return { ok: false };
    await writeMfaState(userId, { ...state, backup: rest }, tx);
    return { ok: true, usedBackup: true, remainingBackup: rest.length };
  });
}

/* ───────────────────────── Connexion en deux temps ───────────────────────── */

export async function startMfaChallenge(userId: string, next?: string) {
  const token = signMfaPending({ uid: userId, exp: Date.now() + MFA_TTL_MS, next }, signingKey());
  const jar = await cookies();
  jar.set(MFA_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MFA_TTL_MS / 1000 });
}

export async function readMfaChallenge(): Promise<MfaPending | null> {
  const jar = await cookies();
  try {
    return verifyMfaPending(jar.get(MFA_COOKIE)?.value, signingKey());
  } catch {
    return null;
  }
}

export async function clearMfaChallenge() {
  const jar = await cookies();
  jar.delete(MFA_COOKIE);
}

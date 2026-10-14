"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { TokenPurpose } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword, passwordPolicy } from "./password";
import { createSession, destroySession, getCurrentUser, SESSION_COOKIE } from "./session";
import { safeNext } from "./redirect";
import { numericCode, safeEqual, sha256 } from "@/lib/crypto";
import { sendMail } from "@/lib/email";
import { fail, success, parseForm, guard, type ActionResult } from "@/lib/action";
import { clientIp, rateLimit, rateLimitAll, rateLimitMessage } from "@/lib/rate-limit";
import { SITE } from "@/config/site";
import { audit } from "@/lib/audit";
import { startMfaChallenge } from "@/lib/admin/mfa-server";

const emailSchema = z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(254, "Adresse e-mail invalide");

/** Nombre maximal de saisies par code émis (B1). */
const MAX_CODE_ATTEMPTS = 5;
const CODE_TTL_MS = 15 * 60_000;
const MIN = 60;

/** Clé de limitation dérivée de l'e-mail (pas d'e-mail en clair dans la table RateLimit). */
function emailKey(email: string) {
  return sha256(email.toLowerCase()).slice(0, 32);
}

/** Hash argon2 factice : la connexion d'un e-mail inconnu coûte autant qu'un vrai essai (anti-énumération). */
let dummyHash: Promise<string> | null = null;
function getDummyHash() {
  dummyHash ??= hashPassword(`axi-dummy-${Math.random()}`);
  return dummyHash;
}

const signupSchema = z.object({
  name: z.string().trim().min(2, "Indiquez votre nom").max(80),
  email: emailSchema,
  password: z.string().min(8, "8 caractères minimum").max(256, "256 caractères maximum"),
  next: z.string().optional(),
});

export async function signup(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(signupSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { name, email, password, next } = parsed.data;
    const policy = passwordPolicy(password);
    if (policy) return fail(policy, { password: [policy] });

    const ip = await clientIp();
    const rl = await rateLimit(`signup:ip:${ip}`, 5, 60 * MIN);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      // Message neutre : ne confirme pas explicitement l'existence du compte (m3).
      return fail("Impossible de créer un compte avec cette adresse. Si vous avez déjà un compte, connectez-vous ou réinitialisez votre mot de passe.");
    }

    const user = await db.user.create({ data: { name, email, passwordHash: await hashPassword(password) } });
    await issueCode(user.id, email, "EMAIL_VERIFY");
    await createSession(user.id);
    await audit({ actorId: user.id, action: "user.signup" });
    redirect(`/verification?next=${encodeURIComponent(safeNext(next))}`);
  });
}

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Mot de passe requis").max(256, "Mot de passe incorrect"),
  next: z.string().optional(),
});

export async function login(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(loginSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { email, password, next } = parsed.data;

    const ip = await clientIp();
    const rl = await rateLimitAll([
      { key: `login:ip:${ip}`, limit: 10, windowSec: 15 * MIN },
      { key: `login:email:${emailKey(email)}`, limit: 5, windowSec: 15 * MIN },
    ]);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const user = await db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true, isPlatformAdmin: true, mfaEnabled: true, mfaSecretEnc: true } });
    // Réponse et coût identiques que l'utilisateur existe ou non (pas d'énumération) : hash factice.
    const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
    if (!user || !ok) return fail("E-mail ou mot de passe incorrect.");

    // Double authentification : pas de session avant le code TOTP (jeton signé court, 5 min).
    if (user.mfaEnabled && user.mfaSecretEnc) {
      const target = safeNext(next, user.isPlatformAdmin ? "/admin" : "/app");
      await startMfaChallenge(user.id, target);
      await audit({ actorId: user.id, action: "user.login_mfa_challenged" });
      redirect("/double-authentification");
    }

    await createSession(user.id);
    await audit({ actorId: user.id, action: "user.login" });
    // Super-administrateur : console d'administration par défaut, jamais le parcours de création de boutique.
    redirect(safeNext(next, user.isPlatformAdmin ? "/admin" : "/app"));
  });
}

export async function logout() {
  await destroySession();
  redirect("/");
}

async function issueCode(userId: string, email: string, purpose: TokenPurpose) {
  const code = numericCode(6);
  await db.verificationToken.create({ data: { userId, purpose, codeHash: sha256(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
  let sent: { ok: boolean; error?: string };
  if (purpose === "EMAIL_VERIFY") {
    sent = await sendMail({
      to: email,
      subject: `${code} — votre code de vérification ${SITE.name}`,
      text: `Bienvenue sur ${SITE.name} !\n\nVotre code de vérification : ${code}\n\nIl expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    });
  } else {
    sent = await sendMail({
      to: email,
      subject: `${code} — réinitialisation de votre mot de passe ${SITE.name}`,
      text: `Code de réinitialisation : ${code}\n\nIl expire dans 15 minutes. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.`,
    });
  }
  // Pas d'erreur côté utilisateur (ne révèle pas l'existence du compte) ; journal sans le code.
  if (!sent.ok) console.error(`[auth] envoi du code ${purpose} impossible : ${sent.error ?? "erreur inconnue"}`);
}

type CodeCheck = { ok: true; tokenId: string } | { ok: false; error: string };

/**
 * Vérifie un code à 6 chiffres contre le dernier jeton actif (B1) :
 * l'essai est compté AVANT la comparaison (updateMany conditionnel `attempts < 5`, atomique),
 * comparaison en temps constant. Au-delà de 5 essais le jeton est inutilisable.
 */
async function checkCode(userId: string, purpose: TokenPurpose, code: string): Promise<CodeCheck> {
  const invalid: CodeCheck = { ok: false, error: "Code invalide ou expiré." };
  const token = await db.verificationToken.findFirst({
    where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true },
  });
  if (!token) return invalid;
  const claimed = await db.verificationToken.updateMany({
    where: { id: token.id, usedAt: null, attempts: { lt: MAX_CODE_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { ok: false, error: "Trop d'essais pour ce code. Demandez un nouveau code." };
  if (!safeEqual(token.codeHash, sha256(code))) return invalid;
  return { ok: true, tokenId: token.id };
}

export async function resendVerification(): Promise<ActionResult> {
  return guard(async () => {
    const user = await getCurrentUser();
    if (!user) return fail("Connexion requise");
    if (user.emailVerified) return success(undefined, "E-mail déjà vérifié");
    const recent = await db.verificationToken.count({ where: { userId: user.id, purpose: "EMAIL_VERIFY", createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent > 0) return fail("Un code vient d'être envoyé. Patientez une minute.");
    const rl = await rateLimit(`code:email:${emailKey(user.email)}`, 3, 15 * MIN);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));
    await issueCode(user.id, user.email, "EMAIL_VERIFY");
    return success(undefined, "Nouveau code envoyé");
  });
}

export async function verifyEmail(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await getCurrentUser();
    if (!user) return fail("Connexion requise");
    const code = String(formData.get("code") ?? "").replace(/\D/g, "");
    const next = safeNext(formData.get("next"));
    if (code.length !== 6) return fail("Saisissez les 6 chiffres du code.");
    // M5 : limite propre à la saisie du code, par compte (e-mail haché) et par IP, en plus des 5 essais par code (B1).
    const ip = await clientIp();
    const rl = await rateLimitAll([
      { key: `verify:ip:${ip}`, limit: 30, windowSec: 15 * MIN },
      { key: `verify:email:${emailKey(user.email)}`, limit: 10, windowSec: 15 * MIN },
    ]);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));
    const check = await checkCode(user.id, "EMAIL_VERIFY", code);
    if (!check.ok) return fail(check.error);
    const done = await db.$transaction(async (tx) => {
      const used = await tx.verificationToken.updateMany({ where: { id: check.tokenId, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) return false;
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      return true;
    });
    if (!done) return fail("Code invalide ou expiré.");
    redirect(next);
  });
}

export async function requestPasswordReset(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const email = emailSchema.safeParse(formData.get("email"));
    if (!email.success) return fail("Adresse e-mail invalide");
    const ip = await clientIp();
    // Appliqué que le compte existe ou non (ne révèle rien).
    const rl = await rateLimitAll([
      { key: `code:ip:${ip}`, limit: 10, windowSec: 15 * MIN },
      { key: `code:email:${emailKey(email.data)}`, limit: 3, windowSec: 15 * MIN },
    ]);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));
    const user = await db.user.findUnique({ where: { email: email.data }, select: { id: true, email: true } });
    if (user) await issueCode(user.id, user.email, "PASSWORD_RESET");
    // Même réponse dans tous les cas
    return success(undefined, "Si un compte existe, un code vient d'être envoyé.");
  });
}

const resetSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, "Code à 6 chiffres"),
  password: z.string().min(8, "8 caractères minimum").max(256, "256 caractères maximum"),
});

export async function resetPassword(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(resetSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { email, code, password } = parsed.data;
    const policy = passwordPolicy(password);
    if (policy) return fail(policy, { password: [policy] });
    const ip = await clientIp();
    const rl = await rateLimit(`reset:ip:${ip}`, 20, 15 * MIN);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return fail("Code invalide ou expiré.");
    const check = await checkCode(user.id, "PASSWORD_RESET", code);
    if (!check.ok) return fail(check.error);
    const passwordHash = await hashPassword(password);
    const done = await db.$transaction(async (tx) => {
      const used = await tx.verificationToken.updateMany({ where: { id: check.tokenId, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) return false;
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: user.id } }); // invalide toutes les sessions
      // Les autres codes de réinitialisation en cours deviennent caducs.
      await tx.verificationToken.updateMany({ where: { userId: user.id, purpose: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } });
      return true;
    });
    if (!done) return fail("Code invalide ou expiré.");
    await audit({ actorId: user.id, action: "user.password_reset" });
    // Un mot de passe réinitialisé ne contourne pas la double authentification.
    const mfa = await db.user.findUnique({ where: { id: user.id }, select: { mfaEnabled: true, mfaSecretEnc: true, isPlatformAdmin: true } });
    if (mfa?.mfaEnabled && mfa.mfaSecretEnc) {
      await startMfaChallenge(user.id, mfa.isPlatformAdmin ? "/admin" : "/app");
      redirect("/double-authentification");
    }
    await createSession(user.id);
    redirect("/app");
  });
}

const profileSchema = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().max(20).optional() });

export async function updateProfile(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await getCurrentUser();
    if (!user) return fail("Connexion requise");
    const parsed = parseForm(profileSchema, formData);
    if ("error" in parsed) return parsed.error;
    await db.user.update({ where: { id: user.id }, data: { name: parsed.data.name, phone: parsed.data.phone || null } });
    return success(undefined, "Profil mis à jour");
  });
}

const changePwSchema = z.object({ current: z.string().min(1).max(256), password: z.string().min(8, "8 caractères minimum").max(256, "256 caractères maximum") });

export async function changePassword(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await getCurrentUser();
    if (!user) return fail("Connexion requise");
    const parsed = parseForm(changePwSchema, formData);
    if ("error" in parsed) return parsed.error;
    const policy = passwordPolicy(parsed.data.password);
    if (policy) return fail(policy);
    const rl = await rateLimit(`pwchange:user:${user.id}`, 10, 15 * MIN);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));
    const full = await db.user.findUnique({ where: { id: user.id } });
    if (!full || !(await verifyPassword(full.passwordHash, parsed.data.current))) return fail("Mot de passe actuel incorrect.");
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const current = token ? sha256(token) : "";
    const passwordHash = await hashPassword(parsed.data.password);
    // m2 : les autres sessions (autres appareils) sont révoquées, la session courante est conservée.
    const [, revoked] = await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash } }),
      db.session.deleteMany({ where: { userId: user.id, tokenHash: { not: current } } }),
    ]);
    await audit({ actorId: user.id, action: "user.password_changed", metadata: { sessionsRevoked: revoked.count } });
    return success(undefined, revoked.count > 0 ? "Mot de passe modifié. Vos autres appareils ont été déconnectés." : "Mot de passe modifié");
  });
}

export async function addAddress() {
  // placeholder réservé (P1 : carnet d'adresses acheteur)
}

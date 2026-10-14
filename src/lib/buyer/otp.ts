import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizePhone } from "@/lib/utils";

/**
 * Comptes acheteurs (lot 1, F1) : règles pures de la connexion par code, testées dans tests/buyer-otp.test.ts.
 * Aucun accès base ni cookie ici (voir session.ts, actions.ts).
 */

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_DAYS = 90;
export const SESSION_TOUCH_MS = 10 * 60_000;
export const OTP_IP_RETENTION_DAYS = 30;
export const MAX_ADDRESSES = 10;
export const MAX_FAVORITES = 200;
export const BUYER_COOKIE = "axi_buyer";
export const BUYER_KILL_SWITCH_KEY = "buyer_accounts.kill_switch";

/** Message unique (anti-énumération) : identique que le numéro soit connu, inconnu ou non joignable. */
export const OTP_SENT_MESSAGE = "Si ce numéro peut recevoir des messages, un code vient d'être envoyé.";
export const OTP_SENT_MESSAGE_EMAIL = "Si cette adresse est rattachée à un compte vérifié, un code vient d'être envoyé. Sinon, connectez-vous avec votre numéro.";
export const OTP_INVALID_MESSAGE = "Code incorrect ou expiré. Vérifiez-le ou demandez-en un nouveau.";

/* ───────────────────────── Identifiant ───────────────────────── */

export type BuyerIdentifier = { kind: "phone"; destination: string } | { kind: "email"; destination: string };

const zEmail = z.email().max(254);

/** Téléphone (format local ou international, normalisé E.164 sans « + ») ou e-mail (minuscules). */
export function parseIdentifier(raw: unknown, dialCode: string): BuyerIdentifier | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 254) return null;
  if (v.includes("@")) {
    const email = v.toLowerCase();
    return zEmail.safeParse(email).success ? { kind: "email", destination: email } : null;
  }
  if (!/^[+\d\s().-]{6,24}$/.test(v)) return null;
  const phone = normalizePhone(v, dialCode);
  return phone ? { kind: "phone", destination: phone } : null;
}

/** Destination masquée pour l'affichage (jamais le numéro complet dans les journaux). */
export function maskDestination(id: BuyerIdentifier): string {
  if (id.kind === "email") {
    const [user, domain] = id.destination.split("@");
    return `${user!.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, user!.length - 2)))}@${domain}`;
  }
  const d = id.destination;
  return `+${d.slice(0, 3)} •• •• ${d.slice(-2)}`;
}

/* ───────────────────────── Code ───────────────────────── */

/** Code à 6 chiffres, tirage uniforme (pas de biais de modulo). */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

function appSecret(secret?: string): string {
  const s = secret ?? process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET manquant ou trop court (32 caractères minimum).");
  return s;
}

/** Clé dédiée dérivée d'APP_SECRET (séparation de domaine « buyer-otp »). */
export function otpKey(secret?: string): Buffer {
  return createHmac("sha256", appSecret(secret)).update("buyer-otp").digest();
}

/** HMAC-SHA256(clé « buyer-otp », storeId:destination:code) : le code n'est jamais stocké en clair. */
export function hashOtp(storeId: string, destination: string, code: string, secret?: string): string {
  return createHmac("sha256", otpKey(secret)).update(`${storeId}:${destination}:${code}`).digest("hex");
}

/** Comparaison en temps constant (longueurs fixes : hex de 64 caractères). */
export function otpMatches(expectedHash: string, storeId: string, destination: string, code: string, secret?: string): boolean {
  if (!/^\d{6}$/.test(code)) {
    // Calcul factice pour ne pas révéler le format par le temps de réponse.
    hashOtp(storeId, destination, "000000", secret);
    return false;
  }
  const a = Buffer.from(hashOtp(storeId, destination, code, secret), "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Saisie du code : chiffres uniquement (espaces, tirets et chiffres arabes pleine chasse tolérés). */
export function normalizeCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFKC").replace(/\D/g, "").slice(0, 12);
}

export type OtpRow = { codeHash: string; attempts: number; expiresAt: Date; usedAt: Date | null };

/** Code encore utilisable : non consommé, non expiré, essais restants. */
export function isOtpUsable(otp: OtpRow, now = new Date()): boolean {
  return !otp.usedAt && otp.expiresAt.getTime() > now.getTime() && otp.attempts < OTP_MAX_ATTEMPTS;
}

/* ───────────────────────── Débits et plafonds ───────────────────────── */

/** Plafond d'envois de codes par boutique et par jour (coût WhatsApp, abus). */
export const STORE_DAILY_CAP = 500;
/** Envois par destination sur 24 h, toutes boutiques confondues (anti-harcèlement d'un numéro). */
export const DEST_DAILY_CAP = 10;
/** Échecs de vérification par destination et par boutique sur 24 h avant blocage temporaire. */
export const FAIL_DAILY_CAP = 20;

/** Budget quotidien de l'expéditeur plateforme (AXI_OTP_DAILY_BUDGET, défaut 2000). */
export function platformDailyBudget(raw = process.env.AXI_OTP_DAILY_BUDGET): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 2000;
}

/** Codes envoyés par l'expéditeur Axi pour une boutique du plan Gratuit, par jour (AXI_OTP_FREE_DAILY_PER_STORE, défaut 30). */
export function freeDailyPerStore(raw = process.env.AXI_OTP_FREE_DAILY_PER_STORE): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 30;
}

/** Nombre de demandes par IP et par heure avant d'exiger le défi anti-robot (AXI_OTP_CHALLENGE_AFTER, défaut 3). */
export function challengeThreshold(raw = process.env.AXI_OTP_CHALLENGE_AFTER): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 3;
}

/** La destination n'apparaît jamais en clair dans les clés de limitation (table RateLimit). */
export function destinationKey(storeId: string, destination: string): string {
  return createHash("sha256").update(`${storeId}:${destination}`).digest("hex").slice(0, 32);
}

/** Clé de destination SANS boutique : un numéro ne peut pas être bombardé en multipliant les boutiques. */
export function globalDestinationKey(destination: string): string {
  return createHash("sha256").update(`dest:${destination}`).digest("hex").slice(0, 32);
}

/**
 * Émission (§1 renforcé après audit) :
 *  - 3 codes / 15 min par couple IP + destination (un tiers ne consomme pas le quota de la victime) ;
 *  - 10 envois / 24 h par destination, toutes boutiques ;
 *  - 10 / h par IP ; 300 / h et 500 / jour par boutique.
 */
export function otpRequestRules(storeId: string, destination: string, ip: string) {
  return [
    { key: `buyer-otp:ipdest:${ip}:${destinationKey(storeId, destination)}`, limit: 3, windowSec: 15 * 60 },
    { key: `buyer-otp:dest24:${globalDestinationKey(destination)}`, limit: DEST_DAILY_CAP, windowSec: 24 * 3600 },
    { key: `buyer-otp:ip:${ip}`, limit: 10, windowSec: 60 * 60 },
    { key: `buyer-otp:store:${storeId}`, limit: 300, windowSec: 60 * 60 },
    { key: `buyer-otp:store-day:${storeId}`, limit: STORE_DAILY_CAP, windowSec: 24 * 3600 },
  ];
}

/** Vérification de l'e-mail depuis le compte : 3 envois par client et par jour (clé distincte). */
export function emailVerifyRules(customerId: string) {
  return [{ key: `buyer-email-verify:${customerId}`, limit: 3, windowSec: 24 * 3600 }];
}

/** Vérifications : 5 essais par code (compteur en base) ; garde-fou par IP contre la pulvérisation sur plusieurs codes. */
export function otpVerifyRules(storeId: string, ip: string) {
  return [
    { key: `buyer-verify:ip:${ip}`, limit: 30, windowSec: 15 * 60 },
    { key: `buyer-verify:store:${storeId}`, limit: 1500, windowSec: 60 * 60 },
  ];
}

/** Échecs de vérification à partir des codes des dernières 24 h (un code consommé compte 1 essai réussi). */
export function failuresFrom(rows: { attempts: number; usedAt: Date | null }[]): number {
  return rows.reduce((s, r) => s + Math.max(0, r.attempts - (r.usedAt ? 1 : 0)), 0);
}

/**
 * Faut-il émettre un nouveau code ? Un code encore valable n'est remplacé (et donc invalidé) que par une demande
 * venant de la même IP que celle qui l'a obtenu : un tiers ne peut pas invalider le code d'un acheteur.
 */
export function shouldReissue(active: { ip: string | null } | null, ip: string): boolean {
  return !active || active.ip === ip;
}

/** Nom de boutique neutralisé pour un e-mail (texte libre du commerçant : pas de lien, pas de saut de ligne). */
export function neutralStoreName(name: string): string {
  const clean = name.replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return clean.slice(0, 60) || "la boutique";
}

/* ───────────────────────── Session ───────────────────────── */

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Jeton de session bien formé (32 octets en base64url). */
export function isSessionTokenShape(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

export type SessionRow = { storeId: string; expiresAt: Date; revokedAt: Date | null; lastSeenAt: Date };

/** Session valide pour CETTE boutique : liée à la boutique, non révoquée, non expirée. */
export function isSessionValid(session: SessionRow, storeId: string, now = new Date()): boolean {
  return session.storeId === storeId && !session.revokedAt && session.expiresAt.getTime() > now.getTime();
}

/** Glissement : `lastSeenAt` (et l'échéance) mis à jour au plus toutes les 10 minutes. */
export function shouldTouchSession(session: Pick<SessionRow, "lastSeenAt">, now = new Date()): boolean {
  return now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_MS;
}

export function sessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_DAYS * 86_400_000);
}

/**
 * Chemin du cookie `axi_buyer` :
 *  - domaine principal (et localhost) : `/s/{slug}`, le cookie d'une boutique n'est jamais envoyé aux autres ;
 *  - sous-domaine `{slug}.{APP_DOMAIN}` ou domaine personnalisé : `/` (l'hôte isole déjà la boutique).
 */
export function buyerCookiePath(host: string | null | undefined, slug: string, appDomain: string): string {
  const h = (host ?? "").toLowerCase().trim();
  const app = appDomain.toLowerCase();
  const hostname = h.split(":")[0] ?? "";
  const isMain = !h || h === app || h === `www.${app}` || hostname === "localhost" || hostname === "127.0.0.1";
  return isMain ? `/s/${slug}` : "/";
}

/**
 * Nom du cookie : `__Host-axi_buyer` sur un hôte de boutique (sous-domaine, domaine personnalisé) en HTTPS.
 * Le préfixe `__Host-` impose Secure, Path=/ et l'absence de Domain : le cookie ne peut être ni posé ni
 * écrasé depuis un sous-domaine frère. Inutilisable sur le domaine principal (Path=/s/{slug}) et en HTTP local :
 * `axi_buyer` y est conservé.
 */
export function buyerCookieName(host: string | null | undefined, appDomain: string, secure: boolean): string {
  return secure && buyerCookiePath(host, "x", appDomain) === "/" ? `__Host-${BUYER_COOKIE}` : BUYER_COOKIE;
}

/** Nom affichable : une fiche créée à la connexion porte le numéro formaté en attendant le vrai nom. */
export function needsName(name: string, phone: string): boolean {
  const n = name.trim();
  return !n || n.replace(/\D/g, "") === phone;
}

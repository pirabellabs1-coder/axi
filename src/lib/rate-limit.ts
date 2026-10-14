import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";

/**
 * Limitation de débit à fenêtre fixe, persistée dans la table `RateLimit` (fonctionne sur
 * plusieurs instances, sans Redis). Un seul aller-retour SQL : upsert atomique qui remet le
 * compteur à 1 si la fenêtre précédente est échue, sinon l'incrémente.
 *
 * Usage :
 *   const rl = await rateLimit(`login:ip:${await clientIp()}`, 10, 15 * 60);
 *   if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));
 */
export type RateLimitResult = { ok: boolean; retryAfter: number };

/** Décision pure : `count` est la valeur APRÈS incrément pour la fenêtre courante. */
export function rateLimitDecision(count: number, limit: number, resetAt: Date, now: Date = new Date()): RateLimitResult {
  if (count <= limit) return { ok: true, retryAfter: 0 };
  return { ok: false, retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)) };
}

/** Transition pure de la fenêtre (miroir de l'upsert SQL, utile aux tests). */
export function nextWindow(
  existing: { count: number; resetAt: Date } | null,
  windowSec: number,
  now: Date = new Date(),
): { count: number; resetAt: Date } {
  if (!existing || existing.resetAt.getTime() <= now.getTime()) {
    return { count: 1, resetAt: new Date(now.getTime() + windowSec * 1000) };
  }
  return { count: existing.count + 1, resetAt: existing.resetAt };
}

/** Message neutre en français. */
export function rateLimitMessage(retryAfterSec: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.`;
}

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const k = key.slice(0, 200);
  const secs = Math.max(1, Math.floor(windowSec));
  // Horloge de la base (colonnes Prisma DateTime = timestamp UTC sans fuseau) : aucune ambiguïté de fuseau.
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
    WITH t AS (SELECT (now() AT TIME ZONE 'UTC') AS now)
    INSERT INTO "RateLimit" ("key", "count", "resetAt", "updatedAt")
    SELECT ${k}, 1, t.now + (${secs}::int * interval '1 second'), t.now FROM t
    ON CONFLICT ("key") DO UPDATE SET
      "count"     = CASE WHEN "RateLimit"."resetAt" <= EXCLUDED."updatedAt" THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt"   = CASE WHEN "RateLimit"."resetAt" <= EXCLUDED."updatedAt" THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END,
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "count", "resetAt"`;
  const row = rows[0];
  const now = new Date();

  // Nettoyage opportuniste (~1 appel sur 50) des fenêtres échues depuis plus d'une heure.
  if (Math.random() < 0.02) {
    void db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date(now.getTime() - 3600_000) } } }).catch(() => {});
  }

  if (!row) return { ok: true, retryAfter: 0 };
  return rateLimitDecision(Number(row.count), limit, new Date(row.resetAt), now);
}

/**
 * Vérifie plusieurs limites (toutes sont comptabilisées) et renvoie la plus contraignante.
 */
export async function rateLimitAll(rules: { key: string; limit: number; windowSec: number }[]): Promise<RateLimitResult> {
  let worst: RateLimitResult = { ok: true, retryAfter: 0 };
  for (const r of rules) {
    const res = await rateLimit(r.key, r.limit, r.windowSec);
    if (!res.ok && (worst.ok || res.retryAfter > worst.retryAfter)) worst = res;
  }
  return worst;
}

/* ───────────────────────── Adresse IP cliente ───────────────────────── */

/** Développe une IPv6 (avec « :: ») en 8 groupes hexadécimaux, ou null si invalide. */
function expandIpv6(ip: string): string[] | null {
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(parts.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ""));
}

/**
 * Normalise la valeur brute d'un en-tête `x-forwarded-for` (premier élément = client d'origine
 * tel que vu par le proxy de confiance, ex. Vercel) :
 *  - IPv4 (port éventuel retiré, IPv4 mappée en IPv6 ramenée en IPv4) ;
 *  - IPv6 regroupée sur son préfixe /64 (un client dispose en général de tout le /64) ;
 *  - toute autre valeur → "unknown".
 */
export function normalizeIp(raw: string | null | undefined): string {
  let ip = (raw ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (!ip) return "unknown";
  // [v6]:port
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracket) ip = bracket[1];
  // v4:port
  const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  if (v4port) ip = v4port[1];
  // IPv4 mappée
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) ip = mapped[1];

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    return ip.split(".").every((o) => Number(o) <= 255) ? ip.split(".").map(Number).join(".") : "unknown";
  }
  if (ip.includes(":")) {
    const groups = expandIpv6(ip.replace(/%.*$/, ""));
    return groups ? `${groups.slice(0, 4).join(":")}::/64` : "unknown";
  }
  return "unknown";
}

/** IP du client de la requête courante (Server Action / Route Handler). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return normalizeIp(h.get("x-forwarded-for") ?? h.get("x-real-ip"));
}

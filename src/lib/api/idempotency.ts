import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "./problem";

/**
 * Idempotence des POST de l'API REST (`Idempotency-Key` obligatoire, conservée 24 h dans ApiIdempotencyKey).
 *
 *  1. Réservation : insertion d'une ligne « en cours » (responseStatus = 0) ; la contrainte @@unique([storeId, key])
 *     départage deux requêtes simultanées (la seconde reçoit 409 idempotency_in_progress).
 *  2. Même clé, même requête (méthode + chemin + corps JSON canonique) : la réponse enregistrée est rejouée
 *     (en-tête `Idempotent-Replayed: true`). Même clé, requête différente : 422 idempotency_key_reused.
 *  3. Réponse 5xx ou exception : réservation supprimée (le client peut réessayer avec la même clé).
 * Les clés expirées sont ignorées (et supprimées) à la lecture ; la purge de fond est le job `idempotency.purge`.
 */

export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
const KEY_RE = /^[\x21-\x7e]{1,255}$/;
const IN_PROGRESS = 0;

export function validateIdempotencyKey(raw: string | null): string {
  if (!raw) throw new ApiError(400, "idempotency_key_required", "POST requests require an Idempotency-Key header (for example a UUID v4).");
  const key = raw.trim();
  if (!KEY_RE.test(key)) throw new ApiError(400, "invalid_request", "Idempotency-Key must be 1 to 255 visible ASCII characters.");
  return key;
}

/** JSON canonique (clés triées) : un client qui re-sérialise le même corps avec un autre ordre n'est pas pénalisé. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`, "utf8").digest("hex");
}

export type StoredResponse = { status: number; body: unknown };

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function withIdempotency(
  args: { storeId: string; key: string; method: string; path: string; body: unknown; now?: Date },
  exec: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  const now = args.now ?? new Date();
  const hash = requestHash(args.method, args.path, args.body);

  let reservationId: string | null = null;
  for (let attempt = 0; attempt < 2 && !reservationId; attempt++) {
    try {
      const row = await db.apiIdempotencyKey.create({
        data: { storeId: args.storeId, key: args.key, method: args.method, path: args.path.slice(0, 500), requestHash: hash, responseStatus: IN_PROGRESS, responseBody: {}, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) },
        select: { id: true },
      });
      reservationId = row.id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const existing = await db.apiIdempotencyKey.findUnique({ where: { storeId_key: { storeId: args.storeId, key: args.key } } });
      if (!existing) continue; // supprimée entre-temps : nouvel essai
      if (existing.expiresAt <= now) {
        await db.apiIdempotencyKey.deleteMany({ where: { id: existing.id, expiresAt: { lte: now } } });
        continue;
      }
      if (existing.requestHash !== hash) {
        throw new ApiError(422, "idempotency_key_reused", "This Idempotency-Key was already used with a different request (method, path or body). Use a new key for a new request.");
      }
      if (existing.responseStatus === IN_PROGRESS) {
        throw new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is still being processed. Retry shortly.", {}, { "Retry-After": "1" });
      }
      return { status: existing.responseStatus, body: existing.responseBody, replayed: true };
    }
  }
  if (!reservationId) throw new ApiError(409, "idempotency_in_progress", "Could not reserve the Idempotency-Key. Retry shortly.", {}, { "Retry-After": "1" });

  let result: StoredResponse;
  try {
    result = await exec();
  } catch (e) {
    await db.apiIdempotencyKey.deleteMany({ where: { id: reservationId } }).catch(() => {});
    throw e;
  }
  if (result.status >= 500) {
    await db.apiIdempotencyKey.deleteMany({ where: { id: reservationId } }).catch(() => {});
  } else {
    await db.apiIdempotencyKey.update({ where: { id: reservationId }, data: { responseStatus: result.status, responseBody: (result.body ?? null) as Prisma.InputJsonValue } });
  }
  return { ...result, replayed: false };
}

/** Purge des clés expirées (job `idempotency.purge`). */
export async function purgeIdempotencyKeys(now = new Date()): Promise<number> {
  const r = await db.apiIdempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
  return r.count;
}

const PURGE_SETTING = "api.idempotency_purge";

/**
 * Programme `idempotency.purge` au plus une fois par jour UTC (réservation atomique sur PlatformSetting, même
 * schéma que les balayages des cartes cadeaux). Appelée de façon opportuniste par les POST de l'API.
 */
export async function scheduleIdempotencyPurge(now = new Date()): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  const value = JSON.stringify({ day });
  const { enqueue } = await import("@/lib/jobs");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ key: string }[]>`
      INSERT INTO "PlatformSetting" ("key", "value", "updatedBy", "updatedAt")
      VALUES (${PURGE_SETTING}, ${value}::jsonb, 'system', now())
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now(), "updatedBy" = 'system'
      WHERE "PlatformSetting"."value"->>'day' IS DISTINCT FROM ${day}
      RETURNING "key"`;
    if (!rows.length) return false;
    await enqueue("idempotency.purge", { day }, {}, tx);
    return true;
  });
}

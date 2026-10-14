import "server-only";
import { AuthError, requireStore, type Capability } from "@/lib/auth/permissions";
import { activeAddOnQuantity } from "@/lib/addons/service";
import { releaseMediaQuota, reserveMediaQuota } from "./usage";
import { rateLimitAll, rateLimitMessage } from "@/lib/rate-limit";
import { InvalidImageError, storeImage, type StoredImage } from "./index";
import { MAX_UPLOAD_BYTES, UPLOAD_PURPOSES, type UploadPurpose } from "./limits";
import { bytesToKb, formatBytes, storageQuotaBytes } from "./quota";

/**
 * Téléversement d'une image par un membre de la boutique (appelé par POST /api/stores/{storeId}/media).
 * Ordre des contrôles : identifiants → appartenance + capacité (requireStore) → débit → taille → format
 * (octets magiques) → dédoublonnage → quota → écriture. Toute erreur est une UploadError au code stable.
 */
export const PURPOSE_CAPABILITY: Record<UploadPurpose, Capability> = {
  product: "products.manage",
  collection: "products.manage",
  theme: "theme.manage",
};

export type UploadErrorCode = "invalid_request" | "unauthenticated" | "forbidden" | "rate_limited" | "too_large" | "empty" | "unsupported_type" | "invalid_dimensions" | "quota_exceeded" | "storage_unavailable";

const STATUS: Record<UploadErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  rate_limited: 429,
  too_large: 413,
  empty: 400,
  unsupported_type: 415,
  invalid_dimensions: 422,
  quota_exceeded: 413,
  storage_unavailable: 503,
};

export class UploadError extends Error {
  readonly status: number;
  constructor(
    readonly code: UploadErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const RATE_RULES = { perUser: { limit: 120, windowSec: 600 }, perStore: { limit: 600, windowSec: 3600 } };

export function isUploadPurpose(v: unknown): v is UploadPurpose {
  return typeof v === "string" && (UPLOAD_PURPOSES as readonly string[]).includes(v);
}

export type UploadResult = Pick<StoredImage, "url" | "key" | "bytes" | "mime"> & { deduplicated: boolean };

/**
 * `readBody` n'est appelé qu'après l'authentification et le contrôle de débit : un anonyme ne fait jamais lire
 * le corps. Il doit lui-même borner la lecture (voir readBodyLimited) et lever UploadError("too_large").
 */
export async function uploadStoreImage(input: { storeId: string; purpose: unknown; readBody: () => Promise<Uint8Array> }): Promise<UploadResult> {
  const { storeId, purpose } = input;
  if (!/^[a-z0-9]{8,40}$/.test(storeId)) throw new UploadError("invalid_request", "Boutique invalide.");
  if (!isUploadPurpose(purpose)) throw new UploadError("invalid_request", "Usage de l'image invalide.");

  let ctx;
  try {
    ctx = await requireStore(storeId, PURPOSE_CAPABILITY[purpose]);
  } catch (e) {
    if (e instanceof AuthError) throw new UploadError(e.code === "UNAUTHENTICATED" ? "unauthenticated" : "forbidden", e.message);
    throw e;
  }

  const rl = await rateLimitAll([
    { key: `media:user:${ctx.user.id}`, ...RATE_RULES.perUser },
    { key: `media:store:${ctx.store.id}`, ...RATE_RULES.perStore },
  ]);
  if (!rl.ok) throw new UploadError("rate_limited", rateLimitMessage(rl.retryAfter), rl.retryAfter);

  const body = await input.readBody();
  if (body.byteLength === 0) throw new UploadError("empty", "Fichier vide.");
  if (body.byteLength > MAX_UPLOAD_BYTES) throw new UploadError("too_large", `Image trop lourde (${formatBytes(MAX_UPLOAD_BYTES)} maximum).`);

  let stored: StoredImage;
  try {
    stored = await storeImage(ctx.store.id, body, {
      // Réservation atomique (UPDATE conditionnel) AVANT l'écriture ; remboursée si l'écriture échoue.
      reserve: async (bytes) => {
        const quota = storageQuotaBytes(ctx.planId, await activeAddOnQuantity(ctx.store.id, "STORAGE_10GB"));
        if (!(await reserveMediaQuota(ctx.store.id, bytesToKb(bytes), quota))) {
          throw new UploadError("quota_exceeded", `Espace de stockage plein (${formatBytes(quota ?? 0)} sur votre plan). Ajoutez l'option « Stockage +10 Go » ou passez à un plan supérieur : /app/${ctx.store.id}/abonnement`);
        }
      },
      release: (bytes) => releaseMediaQuota(ctx.store.id, bytesToKb(bytes)),
    });
  } catch (e) {
    if (e instanceof UploadError) throw e;
    if (e instanceof InvalidImageError) throw new UploadError(e.reason === "dimensions" ? "invalid_dimensions" : "unsupported_type", e.message);
    console.error("[storage] upload", e instanceof Error ? e.message : e);
    throw new UploadError("storage_unavailable", "Le stockage des images est momentanément indisponible. Réessayez dans un instant.");
  }

  return { url: stored.url, key: stored.key, bytes: stored.bytes, mime: stored.mime, deduplicated: !stored.created };
}

/** Lit un flux en s'arrêtant dès que `max` octets sont dépassés (jamais tout le corps en mémoire au-delà). */
export async function readBodyLimited(stream: ReadableStream<Uint8Array> | null, max = MAX_UPLOAD_BYTES): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new UploadError("too_large", `Image trop lourde (${formatBytes(max)} maximum).`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

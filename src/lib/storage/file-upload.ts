import "server-only";
import { AuthError, requireStore } from "@/lib/auth/permissions";
import { activeAddOnQuantity } from "@/lib/addons/service";
import { releaseMediaQuota, reserveMediaQuota } from "./usage";
import { rateLimitAll, rateLimitMessage } from "@/lib/rate-limit";
import { InvalidImageError, storeFile } from "./index";
import { bytesToKb, formatBytes, storageQuotaBytes } from "./quota";
import { FILE_TYPE_LABELS, MAX_FILES_PER_PRODUCT, MAX_FILE_BYTES } from "./file-keys";
import { UploadError, type UploadErrorCode } from "./upload";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { productKindOf } from "@/lib/digital/kinds";
import { planFeature } from "@/lib/auth/permissions";

/**
 * Téléversement d'un FICHIER VENDU (produit numérique) par un membre de la boutique.
 * Appelé par `POST /api/stores/{storeId}/files`.
 *
 * Ordre des contrôles : identifiants → appartenance + `products.manage` → plan → débit → taille → format
 * (octets magiques) → produit de la boutique et de nature DIGITAL → quota de stockage → écriture → fiche.
 * Le quota est celui des médias (compteur `media_kb`) : les fichiers vendus et les photos partagent l'espace
 * du plan, ce qui borne naturellement l'offre du plan Gratuit (100 Mo).
 */
export type FileUploadInput = {
  storeId: string;
  productId: unknown;
  variantId: unknown;
  assetId: unknown;
  name: unknown;
  readBody: () => Promise<Uint8Array>;
};

export type FileUploadResult = {
  asset: { id: string; name: string; variantId: string | null; bytes: number; mime: string; version: number; position: number };
  deduplicated: boolean;
  replaced: boolean;
};

const RATE_RULES = { perUser: { limit: 60, windowSec: 600 }, perStore: { limit: 200, windowSec: 3600 } };

function errorOf(code: UploadErrorCode, message: string, retryAfter?: number): UploadError {
  return new UploadError(code, message, retryAfter);
}

const zId = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null);

export async function uploadStoreFile(input: FileUploadInput): Promise<FileUploadResult> {
  const { storeId } = input;
  if (!/^[a-z0-9]{8,40}$/.test(storeId)) throw errorOf("invalid_request", "Boutique invalide.");
  const productId = zId(input.productId);
  if (!productId) throw errorOf("invalid_request", "Produit invalide.");
  const variantId = input.variantId == null || input.variantId === "" ? null : zId(input.variantId);
  if (input.variantId != null && input.variantId !== "" && !variantId) throw errorOf("invalid_request", "Variante invalide.");
  const assetId = input.assetId == null || input.assetId === "" ? null : zId(input.assetId);
  if (input.assetId != null && input.assetId !== "" && !assetId) throw errorOf("invalid_request", "Fichier invalide.");
  const rawName = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";

  let ctx;
  try {
    ctx = await requireStore(storeId, "products.manage");
  } catch (e) {
    if (e instanceof AuthError) throw errorOf(e.code === "UNAUTHENTICATED" ? "unauthenticated" : "forbidden", e.message);
    throw e;
  }
  if (!planFeature(ctx.planId, "digitalProducts")) {
    throw errorOf("forbidden", `Les produits numériques ne sont pas inclus dans votre plan. Voir les plans : /app/${ctx.store.id}/abonnement`);
  }

  const rl = await rateLimitAll([
    { key: `files:user:${ctx.user.id}`, ...RATE_RULES.perUser },
    { key: `files:store:${ctx.store.id}`, ...RATE_RULES.perStore },
  ]);
  if (!rl.ok) throw errorOf("rate_limited", rateLimitMessage(rl.retryAfter), rl.retryAfter);

  const product = await db.product.findFirst({ where: { id: productId, storeId: ctx.store.id }, select: { id: true, kind: true, isGiftCard: true } });
  if (!product) throw errorOf("invalid_request", "Produit introuvable dans cette boutique.");
  if (productKindOf(product) !== "DIGITAL") throw errorOf("invalid_request", "Ce produit n'est pas un produit numérique : choisissez le type « Produit numérique » puis enregistrez.");
  if (variantId) {
    const variant = await db.variant.findFirst({ where: { id: variantId, productId: product.id }, select: { id: true } });
    if (!variant) throw errorOf("invalid_request", "Variante introuvable pour ce produit.");
  }

  const existing = assetId ? await db.digitalAsset.findFirst({ where: { id: assetId, storeId: ctx.store.id, productId: product.id }, select: { id: true, name: true, version: true, position: true, variantId: true } }) : null;
  if (assetId && !existing) throw errorOf("invalid_request", "Fichier à remplacer introuvable.");
  if (!existing) {
    const count = await db.digitalAsset.count({ where: { storeId: ctx.store.id, productId: product.id } });
    if (count >= MAX_FILES_PER_PRODUCT) throw errorOf("invalid_request", `${MAX_FILES_PER_PRODUCT} fichiers maximum par produit.`);
  }

  const body = await input.readBody();
  if (body.byteLength === 0) throw errorOf("empty", "Fichier vide.");
  if (body.byteLength > MAX_FILE_BYTES) throw errorOf("too_large", `Fichier trop lourd (${formatBytes(MAX_FILE_BYTES)} maximum).`);

  let stored;
  try {
    stored = await storeFile(ctx.store.id, body, {
      reserve: async (bytes) => {
        const quota = storageQuotaBytes(ctx.planId, await activeAddOnQuantity(ctx.store.id, "STORAGE_10GB"));
        if (!(await reserveMediaQuota(ctx.store.id, bytesToKb(bytes), quota))) {
          throw errorOf(
            "quota_exceeded",
            `Espace de stockage plein (${formatBytes(quota ?? 0)} sur votre plan, photos et fichiers vendus compris). Ajoutez l'option « Stockage +10 Go » ou passez à un plan supérieur : /app/${ctx.store.id}/abonnement`,
          );
        }
      },
      release: (bytes) => releaseMediaQuota(ctx.store.id, bytesToKb(bytes)),
    });
  } catch (e) {
    if (e instanceof UploadError) throw e;
    if (e instanceof InvalidImageError) throw errorOf("unsupported_type", `${e.message} Formats acceptés : ${FILE_TYPE_LABELS}.`);
    console.error("[storage] upload fichier", e instanceof Error ? e.message : e);
    throw errorOf("storage_unavailable", "Le stockage des fichiers est momentanément indisponible. Réessayez dans un instant.");
  }

  const name = rawName || existing?.name || "Fichier";
  if (existing) {
    // Remplacement : même fiche, nouvelle version → les acheteurs téléchargent désormais le nouveau fichier.
    const updated = await db.digitalAsset.update({
      where: { id: existing.id },
      data: { storageKey: stored.key, bytes: stored.bytes, mime: stored.mime, version: { increment: 1 }, ...(rawName ? { name: rawName } : {}) },
      select: { id: true, name: true, variantId: true, bytes: true, mime: true, version: true, position: true },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "digital.asset_replaced", target: updated.id, metadata: { productId: product.id, version: updated.version, bytes: stored.bytes } });
    return { asset: updated, deduplicated: !stored.created, replaced: true };
  }

  const position = await db.digitalAsset.count({ where: { storeId: ctx.store.id, productId: product.id } });
  const asset = await db.digitalAsset.create({
    data: { storeId: ctx.store.id, productId: product.id, variantId, name, storageKey: stored.key, bytes: stored.bytes, mime: stored.mime, position },
    select: { id: true, name: true, variantId: true, bytes: true, mime: true, version: true, position: true },
  });
  await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "digital.asset_added", target: asset.id, metadata: { productId: product.id, name, bytes: stored.bytes } });
  return { asset, deduplicated: !stored.created, replaced: false };
}

/** Lit un flux en s'arrêtant dès que `max` octets sont dépassés (jamais plus en mémoire). */
export async function readFileBodyLimited(stream: ReadableStream<Uint8Array> | null, max = MAX_FILE_BYTES): Promise<Uint8Array> {
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
      throw errorOf("too_large", `Fichier trop lourd (${formatBytes(max)} maximum).`);
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

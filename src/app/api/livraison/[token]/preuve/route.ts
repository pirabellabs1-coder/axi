import { db } from "@/lib/db";
import { effectivePlanId } from "@/lib/auth/permissions";
import { activeAddOnQuantity } from "@/lib/addons/service";
import { clientIp, rateLimitAll, rateLimitMessage } from "@/lib/rate-limit";
import { InvalidImageError, storeImage } from "@/lib/storage";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/limits";
import { bytesToKb, storageQuotaBytes } from "@/lib/storage/quota";
import { releaseMediaQuota, reserveMediaQuota } from "@/lib/storage/usage";
import { readBodyLimited, UploadError } from "@/lib/storage/upload";
import { audit } from "@/lib/audit";
import { isCourierTokenValid } from "@/lib/shipping/courier-code";
import { isTerminalShipmentStatus, type ShipmentStatusValue } from "@/lib/shipping/state";

export const dynamic = "force-dynamic";

/**
 * POST /api/livraison/{token}/preuve — PHOTO DE PREUVE DE REMISE, téléversée par le livreur.
 *
 * Correctif mineur n° 5 de l'audit de la vague 3 : `proofPhotoUrl` acceptait n'importe quelle chaîne
 * envoyée dans le formulaire du livreur et valait preuve de livraison. Un livreur pouvait donc marquer
 * « Livré » sans code de l'acheteur en collant `https://exemple.test/x.jpg` — ou l'URL d'une photo d'une
 * autre livraison. Désormais la photo passe OBLIGATOIREMENT par le stockage de la plateforme : le serveur
 * lit les octets, vérifie le format par les octets magiques, écrit l'objet sous une clé INTERNE dérivée du
 * hash du contenu (`stores/{storeId}/delivery/…`) et c'est cette clé — jamais une URL du client — qui est
 * enregistrée dans `Shipment.proofPhotoUrl`.
 *
 * Preuve de possession : le jeton de la page livreur, non expiré, sur une expédition non clôturée.
 * Le livreur n'est pas authentifié : débit limité par jeton et par IP, taille bornée à 5 Mo, quota de
 * stockage de la boutique respecté. Un `Content-Type: image/*` force un pré-vol CORS jamais accordé :
 * pas de téléversement intersite.
 *
 * 201 { ok: true } | { error: { code, message } } 400/403/404/409/413/415/422/429/503
 */
function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}
const error = (code: string, message: string, status: number, extra: Record<string, string> = {}) => json({ error: { code, message } }, status, extra);

const TOKEN_RE = /^[a-f0-9]{32,64}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return error("forbidden", "Origine non autorisée.", 403);
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/") || type === "image/svg+xml") return error("unsupported_type", "Envoyez une photo (JPEG, PNG, WebP).", 415);
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return error("too_large", "Photo trop lourde (5 Mo maximum).", 413);
  if (!TOKEN_RE.test(token)) return error("not_found", "Lien de livraison inconnu.", 404);

  const rl = await rateLimitAll([
    { key: `courier:proof:token:${token.slice(0, 32)}`, limit: 10, windowSec: 3600 },
    { key: `courier:proof:ip:${await clientIp()}`, limit: 30, windowSec: 3600 },
  ]);
  if (!rl.ok) return error("rate_limited", rateLimitMessage(rl.retryAfter), 429, { "Retry-After": String(rl.retryAfter) });

  const shipment = await db.shipment.findUnique({
    where: { courierToken: token },
    select: { id: true, storeId: true, status: true, courierTokenExpiresAt: true, store: { select: { id: true, subscription: true } } },
  });
  if (!shipment) return error("not_found", "Lien de livraison inconnu.", 404);
  if (!isCourierTokenValid(shipment.courierTokenExpiresAt)) return error("forbidden", "Ce lien de livraison a expiré.", 403);
  if (isTerminalShipmentStatus(shipment.status as ShipmentStatusValue)) return error("conflict", "Cette expédition est déjà clôturée.", 409);

  const planId = effectivePlanId(shipment.store.subscription);
  try {
    const body = await readBodyLimited(req.body);
    if (body.byteLength === 0) return error("empty", "Fichier vide.", 400);
    const stored = await storeImage(shipment.storeId, body, {
      namespace: "delivery",
      reserve: async (bytes) => {
        const quota = storageQuotaBytes(planId, await activeAddOnQuantity(shipment.storeId, "STORAGE_10GB"));
        if (!(await reserveMediaQuota(shipment.storeId, bytesToKb(bytes), quota))) {
          throw new UploadError("quota_exceeded", "La boutique ne peut pas recevoir de photo pour le moment : confirmez la livraison avec le code de l'acheteur.");
        }
      },
      release: (bytes) => releaseMediaQuota(shipment.storeId, bytesToKb(bytes)),
    });
    // La CLÉ interne, jamais une URL fournie par le client. L'écriture est filtrée par `id` : le jeton
    // a déjà désigné l'expédition, aucune autre ne peut être visée.
    await db.shipment.updateMany({ where: { id: shipment.id, storeId: shipment.storeId }, data: { proofPhotoUrl: stored.key } });
    await audit({ storeId: shipment.storeId, action: "shipment.proof_uploaded", target: shipment.id, metadata: { bytes: stored.bytes } });
    return json({ ok: true }, 201);
  } catch (e) {
    if (e instanceof UploadError) return error(e.code, e.message, e.status);
    if (e instanceof InvalidImageError) return error(e.reason === "dimensions" ? "invalid_dimensions" : "unsupported_type", e.message, e.reason === "dimensions" ? 422 : 415);
    console.error("[livraison] preuve", e instanceof Error ? e.message : e);
    return error("storage_unavailable", "L'envoi de la photo a échoué. Réessayez.", 503);
  }
}

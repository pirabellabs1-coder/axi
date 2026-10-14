import { db } from "@/lib/db";
import { effectivePlanId } from "@/lib/auth/permissions";
import { PLANS } from "@/config/plans";
import { activeAddOnQuantity } from "@/lib/addons/service";
import { clientIp, rateLimitAll, rateLimitMessage } from "@/lib/rate-limit";
import { InvalidImageError, storeImage } from "@/lib/storage";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/limits";
import { bytesToKb, storageQuotaBytes } from "@/lib/storage/quota";
import { releaseMediaQuota, reserveMediaQuota } from "@/lib/storage/usage";
import { readBodyLimited, UploadError } from "@/lib/storage/upload";
import { parseReturnPolicy, orderEligibility } from "@/lib/returns/policy";

export const dynamic = "force-dynamic";

/**
 * POST /api/s/{slug}/returns/photos — photo jointe à une demande de retour par l'ACHETEUR.
 * Preuve de possession : en-tête `x-return-token` (jeton de suivi non expiré de la commande) OU session acheteur de la
 * boutique + `?commande={référence}` (commande du client connecté). Commande livrée, libre-service ouvert.
 * Mêmes contrôles que le téléversement marchand : corps borné à 5 Mo, format par octets magiques (JPEG, PNG, WebP,
 * AVIF, GIF ; jamais SVG), dimensions bornées, quota de stockage de la boutique, débit limité (IP, commande, boutique).
 * Photos rangées sous `stores/{id}/returns/` ; non rattachées à une demande après 24 h : supprimées et quota rendu
 * (src/lib/returns/photo-purge.ts, balayage de /api/jobs/run).
 * Un Content-Type image/* force un pré-vol CORS jamais accordé : pas d'envoi intersite avec le cookie de session.
 * 201 { url } | { error: { code, message } } 400/403/404/413/415/422/429/503.
 */
function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}
const error = (code: string, message: string, status: number, extra: Record<string, string> = {}) => json({ error: { code, message } }, status, extra);

const TOKEN_RE = /^[0-9a-f]{16,128}$/;
const REF_RE = /^[A-Z0-9-]{4,24}$/;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return error("forbidden", "Origine non autorisée.", 403);
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/") || type === "image/svg+xml") return error("unsupported_type", "Envoyez une photo (JPEG, PNG, WebP).", 415);
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return error("too_large", "Photo trop lourde (5 Mo maximum).", 413);
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return error("not_found", "Commande introuvable.", 404);

  const store = await db.store.findUnique({ where: { slug }, select: { id: true, slug: true, status: true, returnPolicy: true, subscription: true } });
  if (!store || store.status !== "PUBLISHED") return error("not_found", "Commande introuvable.", 404);

  // Preuve de possession de la commande.
  const token = req.headers.get("x-return-token") ?? "";
  const reference = new URL(req.url).searchParams.get("commande") ?? "";
  let order: { id: string; status: string; deliveredAt: Date | null } | null = null;
  if (token) {
    if (!TOKEN_RE.test(token)) return error("not_found", "Commande introuvable.", 404);
    const o = await db.order.findFirst({ where: { trackingToken: token, storeId: store.id }, select: { id: true, status: true, deliveredAt: true, trackingExpiresAt: true } });
    if (o && o.trackingExpiresAt.getTime() >= Date.now()) order = o;
  } else if (REF_RE.test(reference)) {
    const { getBuyer } = await import("@/lib/buyer/session");
    const buyer = await getBuyer(store);
    if (buyer) order = await db.order.findFirst({ where: { storeId: store.id, reference, customerId: buyer.customerId }, select: { id: true, status: true, deliveredAt: true } });
  }
  if (!order) return error("not_found", "Commande introuvable ou lien expiré.", 404);

  const planId = effectivePlanId(store.subscription);
  const policy = parseReturnPolicy(store.returnPolicy);
  if (!policy.enabled || !PLANS[planId].features.returnsPortal || !orderEligibility(order, policy).ok) {
    return error("forbidden", "Cette commande ne peut pas faire l'objet d'une demande de retour.", 403);
  }

  const rl = await rateLimitAll([
    { key: `returns:photo:ip:${await clientIp()}`, limit: 20, windowSec: 3600 },
    { key: `returns:photo:order:${order.id}`, limit: 12, windowSec: 3600 },
    // Au plus ~6 photos par commande et par 24 h (3 par demande, une seconde demande ou un renvoi) : borne le stockage
    // qu'un détenteur de lien de suivi peut consommer sur le quota de la boutique.
    { key: `returns:photo:order-day:${order.id}`, limit: 6, windowSec: 86_400 },
    { key: `returns:photo:store:${store.id}`, limit: 300, windowSec: 3600 },
  ]);
  if (!rl.ok) return error("rate_limited", rateLimitMessage(rl.retryAfter), 429, { "Retry-After": String(rl.retryAfter) });

  try {
    const body = await readBodyLimited(req.body);
    if (body.byteLength === 0) return error("empty", "Fichier vide.", 400);
    const stored = await storeImage(store.id, body, {
      // Espace `returns/` : isolé des médias du commerçant, purgé après 24 h s'il n'est cité par aucune demande.
      namespace: "returns",
      reserve: async (bytes) => {
        const quota = storageQuotaBytes(planId, await activeAddOnQuantity(store.id, "STORAGE_10GB"));
        if (!(await reserveMediaQuota(store.id, bytesToKb(bytes), quota))) throw new UploadError("quota_exceeded", "La boutique ne peut pas recevoir de photo pour le moment. Envoyez votre demande sans photo ou contactez-la.");
      },
      release: (bytes) => releaseMediaQuota(store.id, bytesToKb(bytes)),
    });
    return json({ url: stored.url }, 201);
  } catch (e) {
    if (e instanceof UploadError) return error(e.code, e.message, e.status);
    if (e instanceof InvalidImageError) return error(e.reason === "dimensions" ? "invalid_dimensions" : "unsupported_type", e.message, e.reason === "dimensions" ? 422 : 415);
    console.error("[returns] photo", e instanceof Error ? e.message : e);
    return error("storage_unavailable", "L'envoi de la photo a échoué. Réessayez.", 503);
  }
}

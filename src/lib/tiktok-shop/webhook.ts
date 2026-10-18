import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { platformConfig, TIKTOK_SHOP_KIND } from "./config";
import { verifyWebhookSignature } from "./sign";

/**
 * Notifications TikTok Shop (webhooks), logique testable de `POST /api/webhooks/tiktok-shop`.
 *
 *  1. Signature OBLIGATOIRE : `Authorization` = HMAC-SHA256(app_secret, app_key + corps brut), temps constant.
 *     Puis anti-rejeu : |maintenant − timestamp| ≤ 15 min.
 *  2. Boutique Axi retrouvée par `shop_id` parmi les connexions TikTok Shop (une boutique TikTok ne peut être
 *     reliée qu'à une seule boutique Axi : contrôle à la sélection).
 *  3. Idempotence : ProviderEvent(provider = "tiktok_shop", eventId = tts_notification_id) unique, créé DANS la même
 *     transaction que le job ; un rejeu renvoie 200 sans effet.
 *  4. Traitement asynchrone (job) : la réponse part vite, l'import relit la commande par l'API (jamais la charge du
 *     webhook comme source des montants).
 * Seuls des identifiants et statuts sont journalisés (pas de coordonnées acheteur).
 */

export const MAX_WEBHOOK_BODY = 256 * 1024;
/** Fenêtre anti-rejeu : une notification signée dont `timestamp` s'écarte de plus de 15 min est refusée. */
export const MAX_WEBHOOK_SKEW_MS = 15 * 60_000;
const PROVIDER = "tiktok_shop";

type Result = { status: number; body: string };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const safeId = (v: unknown): string | null => {
  const s = str(v);
  return s && /^[\w-]{1,64}$/.test(s) ? s : null;
};

export async function handleTiktokWebhook(p: { rawBody: Buffer; authorization: string | null; now?: number }): Promise<Result> {
  const platform = platformConfig();
  if (!platform) return { status: 503, body: "Webhook non configuré" };
  if (p.rawBody.length > MAX_WEBHOOK_BODY) return { status: 413, body: "Payload Too Large" };
  if (!verifyWebhookSignature({ appKey: platform.appKey, appSecret: platform.appSecret, rawBody: p.rawBody, header: p.authorization })) {
    return { status: 401, body: "Invalid signature" };
  }

  let body: { type?: unknown; tts_notification_id?: unknown; shop_id?: unknown; timestamp?: unknown; data?: unknown };
  try {
    body = JSON.parse(p.rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: "Bad Request" };
  }
  // `timestamp` en secondes (millisecondes tolérées) ; absent ou hors fenêtre : rejeu possible, refus.
  const ts = Number(body.timestamp);
  const tsMs = Number.isFinite(ts) && ts > 0 ? (ts < 1e12 ? ts * 1000 : ts) : NaN;
  if (!Number.isFinite(tsMs) || Math.abs((p.now ?? Date.now()) - tsMs) > MAX_WEBHOOK_SKEW_MS) return { status: 400, body: "Stale notification" };
  const shopId = safeId(body.shop_id);
  const data = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : {};
  if (!shopId) return { status: 200, body: "ignored" };

  const integrations = await db.integration.findMany({
    where: { kind: TIKTOK_SHOP_KIND, status: { in: ["active", "error"] }, config: { path: ["shop", "id"], equals: shopId } },
    select: { storeId: true, status: true },
    take: 2,
  });
  // Boutique inconnue (déconnectée) ou ambiguë : accusé de réception sans traitement (TikTok cesserait de réessayer).
  if (integrations.length !== 1) return { status: 200, body: "unknown shop" };
  const storeId = integrations[0].storeId;

  const type = str(body.type) ?? "unknown";
  const eventId = (safeId(body.tts_notification_id) ?? createHash("sha256").update(p.rawBody).digest("hex")).slice(0, 190);
  const orderId = safeId(data.order_id);
  const productId = safeId(data.product_id);
  const status = str(data.order_status) ?? str(data.status);
  const minimal = { type, shop_id: shopId, order_id: orderId, product_id: productId, status: status?.slice(0, 40) ?? null, timestamp: str(body.timestamp) };

  try {
    await db.$transaction(async (tx) => {
      await tx.providerEvent.create({
        data: { provider: PROVIDER, eventId, type: `tts.${type}`.slice(0, 60), payload: minimal as Prisma.InputJsonValue, signatureValid: true, processedAt: new Date() },
      });
      if (orderId) {
        await enqueue("tiktok_shop.order", { storeId, orderId }, { storeId }, tx);
      } else if (productId && status) {
        // Statut de revue produit : appliqué par la synchro (relecture API), on la déclenche.
        await enqueue("tiktok_shop.sync", { storeId, reason: "product_status" }, { storeId }, tx);
      } else if (type === "6") {
        // Retrait d'autorisation par le vendeur (SELLER_DEAUTHORIZATION) : la connexion passe en erreur.
        await tx.integration.updateMany({ where: { storeId, kind: TIKTOK_SHOP_KIND }, data: { status: "error", lastError: "Autorisation retirée dans TikTok Shop : reconnectez votre boutique." } });
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: 200, body: "duplicate" };
    throw e; // 500 : TikTok renverra la notification (rien n'a été écrit, transaction annulée)
  }
  return { status: 200, body: "ok" };
}

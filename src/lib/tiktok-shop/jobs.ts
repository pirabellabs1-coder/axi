import "server-only";
import { db } from "@/lib/db";
import { enqueue, type JobHandlers } from "@/lib/jobs";
import { isConfigured, TIKTOK_SHOP_KIND } from "./config";

/**
 * Jobs TikTok Shop (chargés à la demande par src/lib/jobs.ts, LAZY_JOB_MODULES) :
 *  - `tiktok_shop.sweep`   : toutes les 10 min (cron /api/jobs/run) → un `tiktok_shop.sync` par boutique active ;
 *  - `tiktok_shop.sync`    : relève des commandes, écarts de stock, expéditions, état de revue (une boutique) ;
 *  - `tiktok_shop.order`   : import d'une commande signalée par webhook ;
 *  - `tiktok_shop.publish` : publication / mise à jour d'un produit.
 * Une erreur retentable (réseau, quota, taux de change) fait échouer le job (backoff du worker) ; une erreur
 * fonctionnelle (attribut manquant, produit refusé) est enregistrée sur la connexion et ne boucle pas.
 */
const id = (v: unknown) => (typeof v === "string" && /^[\w-]{1,64}$/.test(v) ? v : null);

export const handlers: JobHandlers = {
  "tiktok_shop.sweep": async () => {
    const rows = await db.integration.findMany({ where: { kind: TIKTOK_SHOP_KIND, status: "active" }, select: { storeId: true }, take: 5000 });
    const { requestStockSync } = await import("./sync");
    for (const r of rows) await requestStockSync(r.storeId);
  },
  "tiktok_shop.sync": async (p, job) => {
    const storeId = id(p.storeId) ?? job.storeId;
    if (!storeId) return;
    await (await import("./sync")).syncStore(storeId);
  },
  "tiktok_shop.order": async (p, job) => {
    const storeId = id(p.storeId) ?? job.storeId;
    const orderId = id(p.orderId);
    if (!storeId || !orderId) return;
    await (await import("./sync")).importOrderById(storeId, orderId);
  },
  "tiktok_shop.publish": async (p, job) => {
    const storeId = id(p.storeId) ?? job.storeId;
    const productId = id(p.productId);
    if (!storeId || !productId) return;
    await (await import("./sync")).publishProduct(storeId, productId);
  },
};

const SWEEP_KEY = "tiktok_shop.sweep";
const SLOT_MS = 10 * 60_000;

/** Planifie `tiktok_shop.sweep` au plus une fois par tranche de 10 minutes (réservation atomique dans PlatformSetting). */
export async function scheduleTiktokShopSweep(now = new Date()): Promise<{ scheduled: boolean }> {
  if (!isConfigured()) return { scheduled: false };
  const slot = String(Math.floor(now.getTime() / SLOT_MS));
  const value = JSON.stringify({ slot });
  const scheduled = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ key: string }[]>`
      INSERT INTO "PlatformSetting" ("key", "value", "updatedBy", "updatedAt")
      VALUES (${SWEEP_KEY}, ${value}::jsonb, 'system', now())
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now(), "updatedBy" = 'system'
      WHERE "PlatformSetting"."value"->>'slot' IS DISTINCT FROM ${slot}
      RETURNING "key"`;
    if (rows.length === 0) return false;
    await enqueue("tiktok_shop.sweep", { slot }, {}, tx);
    return true;
  });
  return { scheduled };
}

import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getCatalogStatus, requestCatalogSync } from "@/lib/social/sync";
import { defineTool, ToolError, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";
import { assertWritable, auditApi, lines, requireFeature } from "./common";

/** Outils MCP du catalogue WhatsApp / Meta et des flux catalogues (lot 1 bis, équipe P2). */

type Ctx = MerchantContext;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const getCatalogSyncStatus = defineTool({
  name: "get_catalog_sync_status",
  title: "WhatsApp catalog sync status",
  description:
    "Status of the store's product catalog on WhatsApp / Meta (Commerce Manager): public feed URLs (Meta, Google, TikTok) and whether they are enabled, API sync state (catalog id, last sync, next sync, consecutive failures, last error) and the items Meta rejected with the reason.",
  scopes: ["catalog:read"],
  annotations: { readOnlyHint: true },
  input: z.object({ errors_limit: z.number().int().min(0).max(50).default(20).describe("Maximum number of rejected items to return (0-50, default 20).") }),
  handler: async (ctx: Ctx, a) => {
    const s = await getCatalogStatus(ctx.store, a.errors_limit);
    const names = await db.product.findMany({ where: { storeId: ctx.store.id, id: { in: [...new Set(s.errors.map((e) => e.productId))] } }, select: { id: true, name: true } });
    const nameOf = new Map(names.map((p) => [p.id, p.name]));
    const data = {
      feeds: s.feeds.map((f) => ({ channel: f.channel, enabled: f.enabled, url: f.enabled ? f.url : null })),
      sync: {
        enabled: s.sync.enabled,
        status: s.sync.status,
        catalog_id: s.sync.externalCatalogId,
        items_in_catalog: s.sync.itemCount,
        last_sync_at: iso(s.sync.lastSyncAt),
        last_success_at: iso(s.sync.lastSuccessAt),
        next_sync_at: iso(s.sync.nextSyncAt),
        consecutive_failures: s.sync.consecutiveFailures,
        last_error: s.sync.lastError,
      },
      items: s.items,
      rejected_items: s.errors.map((e) => ({ retailer_id: e.retailerId, product_id: e.productId, variant_id: e.variantId, product_name: nameOf.get(e.productId) ?? null, error: e.error })),
    };
    const text = lines(
      `Feeds: ${data.feeds.map((f) => `${f.channel} ${f.enabled ? `enabled (${f.url})` : "disabled"}`).join("; ")}.`,
      s.sync.configured
        ? `API sync ${s.sync.enabled ? "enabled" : "disabled"}, status ${s.sync.status}, catalog ${s.sync.externalCatalogId ?? "not set"}, ${s.items.synced} item(s) synced, ${s.items.error} rejected. Last sync: ${data.sync.last_sync_at ?? "never"}. Next: ${data.sync.next_sync_at ?? "not scheduled"}.`
        : "API sync not configured (the owner sets it up in Axi > Intégrations > Catalogue WhatsApp).",
      s.sync.lastError ? `Last error: ${s.sync.lastError}` : null,
      ...data.rejected_items.slice(0, 10).map((e) => `- ${e.product_name ?? e.product_id} [${e.retailer_id}]: ${e.error ?? "rejected"}`),
    );
    return { text, data };
  },
});

export const triggerCatalogSync = defineTool({
  name: "trigger_catalog_sync",
  title: "Sync the WhatsApp catalog now",
  description:
    "Queue an immediate full sync of the store's products to its WhatsApp / Meta catalog (items previously rejected are re-sent). Requires the API sync to be configured by the owner. The result appears a few minutes later in get_catalog_sync_status. Limited to 6 calls per hour.",
  scopes: ["catalog:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  input: z.object({}),
  handler: async (ctx: Ctx) => {
    assertWritable(ctx);
    requireFeature(ctx, "catalogSync", "WhatsApp catalog sync");
    const rl = await rateLimit(`catalog-sync:${ctx.store.id}`, 6, 3600);
    if (!rl.ok) throw new ToolError(`Too many manual syncs. Try again in about ${Math.max(1, Math.ceil(rl.retryAfter / 60))} minute(s).`, "rate_limited");
    const r = await requestCatalogSync(ctx.store.id);
    if (!r.ok) throw new ToolError(r.error, "sync_unavailable");
    await auditApi(ctx, "catalog.sync_requested", r.syncId);
    return { text: "Catalog sync queued. Check get_catalog_sync_status in a few minutes.", data: { queued: true, sync_id: r.syncId } };
  },
});

export const SOCIAL_TOOLS: McpTool<Ctx>[] = [getCatalogSyncStatus, triggerCatalogSync];

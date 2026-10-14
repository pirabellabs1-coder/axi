import "server-only";
import { z } from "zod";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { listDeliveries } from "@/lib/webhooks/service";
import { db } from "@/lib/db";
import { defineTool, ToolError, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";
import { lines, quoted, requireFeature, UNTRUSTED_NOTICE, zCursor, zId, zLimit } from "./common";

type Ctx = MerchantContext;

/**
 * Outils MCP du lot 2 (équipe E, webhooks). Scope webhooks:write (Business+, propriétaire seulement).
 * Les réponses des serveurs destinataires sont des données tierces : regroupées sous untrusted_customer_input.
 */

const STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "DEAD"] as const;

export const listWebhookDeliveries = defineTool({
  name: "list_webhook_deliveries",
  title: "List webhook deliveries",
  description:
    "Recent outgoing webhook deliveries of the store (newest first) with status (PENDING, SUCCEEDED, FAILED = will retry, DEAD = gave up after 8 attempts), attempts, last HTTP status and error. Filter by endpoint, status or event. Use it to diagnose an integration that does not receive events. Replays are done by the merchant in Axi (Intégrations › Webhooks).",
  scopes: ["webhooks:write"],
  annotations: { readOnlyHint: true },
  input: z.object({
    endpoint_id: zId.optional().describe("Only deliveries to this webhook endpoint."),
    status: z.array(z.enum(STATUSES)).max(4).optional().describe('e.g. ["FAILED","DEAD"] for problems only.'),
    event: z.enum(WEBHOOK_EVENTS).optional(),
    limit: zLimit(20, 50),
    cursor: zCursor,
  }),
  handler: async (ctx: Ctx, a) => {
    requireFeature(ctx, "webhooks", "Webhooks");
    // m5 : curseur inconnu (purgé, ou issu d'une autre boutique) → erreur métier lisible, jamais un 500.
    if (a.cursor && !(await db.webhookDelivery.findFirst({ where: { id: a.cursor, storeId: ctx.store.id }, select: { id: true } }))) {
      throw new ToolError("Invalid cursor: this page no longer exists. Call the tool again without a cursor.", "invalid_cursor");
    }
    const [page, endpoints] = await Promise.all([
      listDeliveries(ctx.store.id, { endpointId: a.endpoint_id, status: a.status, event: a.event, limit: a.limit, cursor: a.cursor }),
      db.webhookEndpoint.findMany({ where: { storeId: ctx.store.id }, select: { id: true, url: true, active: true } }),
    ]);
    const urls = new Map(endpoints.map((e) => [e.id, e]));
    const deliveries = page.items.map((d) => ({
      id: d.id,
      endpoint_id: d.endpointId,
      endpoint_url: urls.get(d.endpointId)?.url ?? null,
      endpoint_active: urls.get(d.endpointId)?.active ?? null,
      event_id: d.eventId,
      event: d.event,
      status: d.status,
      attempts: d.attempts,
      next_attempt_at: d.status === "FAILED" || d.status === "PENDING" ? d.nextAttemptAt.toISOString() : null,
      last_status_code: d.lastStatusCode,
      duration_ms: d.durationMs,
      delivered_at: d.deliveredAt?.toISOString() ?? null,
      created_at: d.createdAt.toISOString(),
      untrusted_customer_input: { notice: UNTRUSTED_NOTICE, last_error: d.lastError, response_snippet: d.responseSnippet?.slice(0, 500) ?? null },
    }));
    const text = deliveries.length
      ? lines(
          `${deliveries.length} delivery(ies)${page.nextCursor ? " (more: pass next_cursor)" : ""}:`,
          ...deliveries.map((d) => `- ${d.created_at.slice(0, 16).replace("T", " ")} UTC · ${d.event} → ${d.endpoint_url ?? d.endpoint_id} · ${d.status} (${d.attempts} attempt(s)${d.last_status_code ? `, HTTP ${d.last_status_code}` : ""})${d.untrusted_customer_input.last_error ? ` ${quoted(d.untrusted_customer_input.last_error, 80)}` : ""} (id: ${d.id})`),
        )
      : endpoints.length
        ? "No webhook delivery matches these filters."
        : "This store has no webhook endpoint yet (Intégrations › Webhooks in Axi).";
    return { text, data: { notice: UNTRUSTED_NOTICE, deliveries, next_cursor: page.nextCursor, has_more: !!page.nextCursor } };
  },
});

export const CONTENT_TOOLS: McpTool<Ctx>[] = [listWebhookDeliveries];

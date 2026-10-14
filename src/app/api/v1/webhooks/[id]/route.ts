import { restRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/problem";
import { requireId, webhookActor } from "@/lib/api/resources";
import { serializeEndpoint } from "@/lib/api/serializers";
import { deleteEndpoint, getEndpoint } from "@/lib/webhooks/service";

export const dynamic = "force-dynamic";

type P = { id: string };

/** GET /api/v1/webhooks/{id} — DELETE /api/v1/webhooks/{id} (webhooks:write). */
export const GET = restRoute<P>({ method: "GET", route: "/v1/webhooks/{id}", scope: "webhooks:write" }, async ({ ctx, params }) => {
  const e = await getEndpoint(ctx.store.id, requireId(params.id, "webhook endpoint"));
  if (!e) throw new ApiError(404, "not_found", "Webhook endpoint not found in this store.");
  return { status: 200, body: serializeEndpoint(e) };
});

export const DELETE = restRoute<P>({ method: "DELETE", route: "/v1/webhooks/{id}", scope: "webhooks:write" }, async ({ ctx, params }) => {
  await deleteEndpoint(webhookActor(ctx), requireId(params.id, "webhook endpoint"));
  return { status: 204 };
});

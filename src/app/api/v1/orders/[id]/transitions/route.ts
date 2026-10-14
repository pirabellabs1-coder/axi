import { restRoute, runTool } from "@/lib/api/handler";
import { getOrderOr404, requireId } from "@/lib/api/resources";
import { updateOrderStatus } from "@/lib/mcp/merchant/orders";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/orders/{id}/transitions (orders:write, Idempotency-Key) — `{ "status": "CONFIRMED", "reason"? }`.
 * Passe par transitionOrder (machine d'états, remise en stock à l'annulation, notification, événements de webhook
 * émis par le cœur commerce) ; motif obligatoire pour annuler.
 */
export const POST = restRoute<{ id: string }>({ method: "POST", route: "/v1/orders/{id}/transitions", scope: "orders:write" }, async ({ ctx, params, body }) => {
  const id = requireId(params.id, "order");
  const out = await runTool(updateOrderStatus, ctx, { ...(body as Record<string, unknown>), order_id: id });
  return { status: 201, body: { object: "order_transition", from: out.from, to: out.to, order: await getOrderOr404(ctx, id) } };
});

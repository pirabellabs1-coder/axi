import { restRoute } from "@/lib/api/handler";
import { getOrderOr404, requireId } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

/** GET /api/v1/orders/{id} (orders:read). */
export const GET = restRoute<{ id: string }>({ method: "GET", route: "/v1/orders/{id}", scope: "orders:read" }, async ({ ctx, params }) => ({
  status: 200,
  body: await getOrderOr404(ctx, requireId(params.id, "order")),
}));

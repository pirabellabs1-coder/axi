import { restRoute } from "@/lib/api/handler";
import { listOrders } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

/** GET /api/v1/orders (orders:read) ; coordonnées des clients seulement avec customers:read. */
export const GET = restRoute({ method: "GET", route: "/v1/orders", scope: "orders:read" }, async ({ ctx, url }) => ({
  status: 200,
  body: await listOrders(ctx, url.searchParams),
}));

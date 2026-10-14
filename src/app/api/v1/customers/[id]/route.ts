import { restRoute } from "@/lib/api/handler";
import { getCustomerOr404, requireId } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

/** GET /api/v1/customers/{id} (customers:read). */
export const GET = restRoute<{ id: string }>({ method: "GET", route: "/v1/customers/{id}", scope: "customers:read" }, async ({ ctx, params }) => ({
  status: 200,
  body: await getCustomerOr404(ctx, requireId(params.id, "customer")),
}));

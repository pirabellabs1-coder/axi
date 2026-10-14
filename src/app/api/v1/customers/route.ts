import { restRoute } from "@/lib/api/handler";
import { listCustomers } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

/** GET /api/v1/customers (customers:read : données personnelles). */
export const GET = restRoute({ method: "GET", route: "/v1/customers", scope: "customers:read" }, async ({ ctx, url }) => ({
  status: 200,
  body: await listCustomers(ctx, url.searchParams),
}));

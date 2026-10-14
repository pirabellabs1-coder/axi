import { restRoute, runTool } from "@/lib/api/handler";
import { getProductOr404, listProducts } from "@/lib/api/resources";
import { createProduct } from "@/lib/mcp/merchant/catalog";

export const dynamic = "force-dynamic";

/** GET /api/v1/products (catalog:read) — POST /api/v1/products (catalog:write, Idempotency-Key). Référence : docs/API-REST.md. */
export const GET = restRoute({ method: "GET", route: "/v1/products", scope: "catalog:read" }, async ({ ctx, url }) => ({
  status: 200,
  body: await listProducts(ctx, url.searchParams),
}));

export const POST = restRoute({ method: "POST", route: "/v1/products", scope: "catalog:write" }, async ({ ctx, body }) => {
  // Mêmes règles que l'outil MCP create_product : brouillon par défaut, quotas produits et photos du plan, audit.
  const out = await runTool(createProduct, ctx, body as Record<string, unknown>);
  const id = String(out.product_id);
  return { status: 201, body: await getProductOr404(ctx, id), headers: { Location: `/api/v1/products/${id}` } };
});

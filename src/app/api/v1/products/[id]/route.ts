import { restRoute, runTool } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/problem";
import { getProductOr404, requireId } from "@/lib/api/resources";
import { updateProduct } from "@/lib/mcp/merchant/catalog";

export const dynamic = "force-dynamic";

type P = { id: string };

/** GET /api/v1/products/{id} (catalog:read) — PATCH (catalog:write ; `?confirm=true` pour une variation de prix > 50 %). */
export const GET = restRoute<P>({ method: "GET", route: "/v1/products/{id}", scope: "catalog:read" }, async ({ ctx, params }) => ({
  status: 200,
  body: await getProductOr404(ctx, requireId(params.id, "product")),
}));

export const PATCH = restRoute<P>({ method: "PATCH", route: "/v1/products/{id}", scope: "catalog:write" }, async ({ ctx, params, body, url }) => {
  const id = requireId(params.id, "product");
  const input = body as Record<string, unknown>;
  if ("product_id" in input || "confirm" in input) throw new ApiError(400, "validation_failed", "product_id comes from the URL and confirmation from ?confirm=true; remove them from the body.");
  await runTool(updateProduct, ctx, { ...input, product_id: id, confirm: url.searchParams.get("confirm") === "true" ? true : undefined });
  return { status: 200, body: await getProductOr404(ctx, id) };
});

import { restRoute, runTool } from "@/lib/api/handler";
import { adjustInventory } from "@/lib/mcp/merchant/catalog";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/inventory/adjustments (inventory:write, Idempotency-Key) — mêmes règles que l'outil MCP
 * adjust_inventory : retrait conditionnel (jamais de stock négatif), réassort toujours appliqué, mouvement journalisé.
 */
export const POST = restRoute({ method: "POST", route: "/v1/inventory/adjustments", scope: "inventory:write" }, async ({ ctx, body }) => {
  const out = await runTool(adjustInventory, ctx, body as Record<string, unknown>);
  return {
    status: 201,
    body: { object: "inventory_adjustment", product_id: out.product_id, variant_id: out.variant_id ?? null, delta: out.delta, stock: out.stock, inventory_policy: out.inventory_policy ?? null, low_stock_threshold: out.low_stock_threshold ?? null },
  };
});

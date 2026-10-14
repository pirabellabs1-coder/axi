import { test, expect } from "./fixtures";
import { db } from "./db";
import { DEMO, expectNoAppError, login } from "./helpers";

/**
 * Connecteurs IA : créer un jeton API depuis l'interface (compte démo), puis appeler le serveur MCP
 * comme le ferait Claude (initialize, tools/list, tools/call get_store_overview), révoquer et vérifier le 401.
 */
test.describe("Connecteurs IA (MCP)", () => {
  let storeId: string;
  const tokenName = `E2E MCP ${Date.now().toString(36)}`;

  test.beforeAll(async () => {
    storeId = (await db.store.findUniqueOrThrow({ where: { slug: "chez-aicha" } })).id;
  });

  test.afterAll(async () => {
    await db.apiToken.deleteMany({ where: { name: { startsWith: "E2E MCP" } } });
  });

  test("jeton créé dans l'interface, appels MCP, révocation", async ({ page, request }) => {
    await login(page, DEMO.email, DEMO.password);
    const res = await page.goto(`/app/${storeId}/integrations/ia`);
    expect(res?.status()).toBe(200);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: "Connecteurs IA", level: 1 })).toBeVisible();

    // Création du jeton (préréglage « Lecture seule »)
    // En dev, le premier clic peut précéder l'hydratation : on réessaie jusqu'à l'ouverture du dialogue.
    const dialog = page.getByRole("dialog", { name: /nouveau jeton api/i });
    await expect(async () => {
      await page.getByRole("button", { name: /créer un jeton/i }).first().click();
      await expect(dialog).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 90_000 });
    await dialog.getByLabel(/^nom/i).fill(tokenName);
    await dialog.getByRole("radio", { name: /lecture seule/i }).check();
    await dialog.getByRole("button", { name: /créer le jeton/i }).click();

    // Secret affiché une seule fois
    const secretDialog = page.getByRole("dialog", { name: new RegExp(tokenName) });
    await expect(secretDialog).toBeVisible();
    const secret = (await secretDialog.locator("pre code").first().textContent())?.trim() ?? "";
    expect(secret).toMatch(/^axi_live_[A-Za-z0-9_-]{40}$/);
    await secretDialog.getByRole("button", { name: /j'ai copié mon jeton/i }).click();
    await expect(page.getByRole("cell", { name: new RegExp(tokenName) })).toBeVisible();

    const stored = await db.apiToken.findFirstOrThrow({ where: { storeId, name: tokenName } });
    expect(stored.secretHash).not.toContain(secret);
    expect(stored.scopes).toEqual(["store:read", "catalog:read", "orders:read", "customers:read", "analytics:read"]);

    const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" };
    const rpc = (id: number, method: string, params: unknown = {}) => request.post("/api/mcp", { headers, data: { jsonrpc: "2.0", id, method, params } });

    const init = await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } });
    expect(init.status()).toBe(200);
    const initBody = await init.json();
    expect(initBody.result.protocolVersion).toBe("2025-06-18");
    expect(initBody.result.serverInfo.name).toBe("axi-merchant");

    const notif = await request.post("/api/mcp", { headers, data: { jsonrpc: "2.0", method: "notifications/initialized" } });
    expect(notif.status()).toBe(202);

    const list = await (await rpc(2, "tools/list")).json();
    const names: string[] = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_store_overview", "search_products", "list_orders", "sales_report"]));
    // Lecture seule : aucun outil d'écriture exposé
    expect(names).not.toContain("create_product");
    expect(names).not.toContain("update_order_status");

    const overview = await (await rpc(3, "tools/call", { name: "get_store_overview", arguments: {} })).json();
    expect(overview.result.isError).toBeFalsy();
    expect(overview.result.content[0].text).toContain("Chez Aïcha");
    expect(overview.result.structuredContent.store.currency).toBe("XOF");

    const denied = await (await rpc(4, "tools/call", { name: "create_discount_code", arguments: { code: "E2ENOPE", type: "PERCENT", value: 10 } })).json();
    expect(denied.result.isError).toBe(true);

    const unknown = await (await rpc(5, "foo/bar")).json();
    expect(unknown.error.code).toBe(-32601);

    // Journal visible dans l'interface
    await page.reload();
    await expect(page.getByRole("cell", { name: "get_store_overview" }).first()).toBeVisible();

    // Révocation : le jeton cesse immédiatement de fonctionner
    const row = page.getByRole("row", { name: new RegExp(tokenName) });
    const confirm = page.getByRole("dialog", { name: /révoquer/i });
    await expect(async () => {
      await row.getByRole("button", { name: /révoquer/i }).click();
      await expect(confirm).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 90_000 });
    await confirm.getByRole("button", { name: /^révoquer$/i }).click();
    // Le nom reste visible dans le journal des appels : on vérifie que le jeton n'est plus révocable (donc inactif).
    await expect(row.getByRole("button", { name: /révoquer/i })).toHaveCount(0);
    const after = await rpc(6, "ping");
    expect(after.status()).toBe(401);
    expect(after.headers()["www-authenticate"]).toContain("resource_metadata=");
  });

  test("métadonnées OAuth et MCP vitrine public", async ({ request }) => {
    const as = await (await request.get("/.well-known/oauth-authorization-server")).json();
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    const pr = await (await request.get("/.well-known/oauth-protected-resource/api/mcp")).json();
    expect(pr.resource).toMatch(/\/api\/mcp$/);

    const pub = await request.post("/api/mcp/store/chez-aicha", { headers: { "Content-Type": "application/json" }, data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_catalog", arguments: { limit: 3 } } } });
    expect(pub.status()).toBe(200);
    const body = await pub.json();
    expect(body.result.structuredContent.products.length).toBeGreaterThan(0);

    const llms = await request.get("/s/chez-aicha/llms.txt");
    expect(llms.status()).toBe(200);
    expect(await llms.text()).toContain("# Chez Aïcha");
  });
});

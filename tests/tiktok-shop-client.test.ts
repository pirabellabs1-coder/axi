import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { TiktokShopAuthClient, TiktokShopClient } from "@/lib/tiktok-shop/client";
import { signRequest } from "@/lib/tiktok-shop/sign";
import { TiktokShopError } from "@/lib/tiktok-shop/types";

/** Client HTTP : signature effective, jeton expiré → un rafraîchissement, quotas, pas de rejeu des écritures non idempotentes. */

const platform = { appKey: "29a39d", appSecret: "test_app_secret_123", serviceId: "svc" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ok = (data: unknown) => json({ code: 0, message: "Success", data });

function harness(responses: Response[]) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (u: string, init?: RequestInit) => {
    calls.push({ url: new URL(u), init: init ?? {} });
    const r = responses.shift();
    if (!r) throw new Error("plus de réponse");
    return r;
  });
  const tokens = { get: vi.fn(async () => "AT1"), refresh: vi.fn(async () => "AT2") };
  const client = new TiktokShopClient({ platform, fetchImpl, now: () => 1_700_000_000_000, sleep: async () => {} }, tokens, "CIPHER");
  return { client, calls, tokens, fetchImpl };
}

describe("TiktokShopClient", () => {
  it("signe chaque requête (chemin + paramètres + corps), jeton en en-tête, shop_cipher ajouté", async () => {
    const { client, calls } = harness([ok({ orders: [], next_page_token: "" })]);
    await client.searchOrders({ updateTimeGe: 1_699_000_000_000, pageSize: 20 });
    const { url, init } = calls[0];
    expect(url.pathname).toBe("/order/202309/orders/search");
    const query = Object.fromEntries(url.searchParams.entries());
    expect(query).toMatchObject({ app_key: "29a39d", timestamp: "1700000000", shop_cipher: "CIPHER", page_size: "20" });
    const { sign, ...rest } = query;
    expect(sign).toBe(signRequest({ path: url.pathname, query: rest, body: String(init.body), contentType: "application/json", appSecret: platform.appSecret }));
    expect((init.headers as Record<string, string>)["x-tts-access-token"]).toBe("AT1");
    expect(JSON.parse(String(init.body))).toEqual({ update_time_ge: 1_699_000_000 });
  });

  it("jeton expiré (105002) : un seul rafraîchissement puis nouvel essai avec le nouveau jeton", async () => {
    const { client, calls, tokens } = harness([json({ code: 105002, message: "Access token is expired" }, 200), ok({ warehouses: [{ id: "W", name: "Main", is_default: true, type: "SALES_WAREHOUSE" }] })]);
    const w = await client.getWarehouses();
    expect(w[0]).toMatchObject({ id: "W", isDefault: true });
    expect(tokens.refresh).toHaveBeenCalledTimes(1);
    expect((calls[1].init.headers as Record<string, string>)["x-tts-access-token"]).toBe("AT2");
  });

  it("quota (429) : reprise bornée sur une lecture, puis erreur rate_limit retentable", async () => {
    const h = harness([json({ code: 1, message: "Too many requests" }, 429), ok({ orders: [] })]);
    await expect(h.client.getOrders(["1"])).resolves.toEqual([]);
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);

    const h2 = harness([json({}, 429), json({}, 429), json({}, 429)]);
    const err = await h2.client.getOrders(["1"]).catch((e) => e);
    expect(err).toBeInstanceOf(TiktokShopError);
    expect(err).toMatchObject({ kind: "rate_limit", retryable: true });
    expect(h2.fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("création de produit et expédition ne sont jamais rejouées automatiquement", async () => {
    const h = harness([json({ code: 1, message: "boom" }, 500)]);
    const input = { title: "t", description: "d", categoryId: "1", mainImageUris: ["u"], skus: [], productAttributes: [], packageWeight: { value: "1", unit: "KILOGRAM" as const }, packageDimensions: { length: "1", width: "1", height: "1", unit: "CENTIMETER" as const } };
    await expect(h.client.createProduct(input)).rejects.toMatchObject({ kind: "server", retryable: true });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    const h2 = harness([json({}, 503)]);
    await expect(h2.client.markShipped({ orderId: "1", lineItemIds: ["a"], trackingNumber: "T", shippingProviderId: "P" })).rejects.toBeInstanceOf(TiktokShopError);
    expect(h2.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refus fonctionnel : erreur validation non retentable, message conservé", async () => {
    const h = harness([json({ code: 12052048, message: "category is not leaf" }, 200)]);
    await expect(h.client.getCategoryAttributes("1")).rejects.toMatchObject({ kind: "validation", retryable: false, code: 12052048 });
  });

  it("lit les attributs (y compris la coquille « is_requried » de l'API)", async () => {
    const h = harness([ok({ attributes: [{ id: "100347", name: "Matière", type: "PRODUCT_PROPERTY", is_requried: true, values: [{ id: "1", name: "Coton" }] }] })]);
    expect(await h.client.getCategoryAttributes("601226")).toEqual([{ id: "100347", name: "Matière", type: "PRODUCT_PROPERTY", required: true, multiple: false, customizable: false, values: [{ id: "1", name: "Coton" }] }]);
  });
});

describe("TiktokShopAuthClient", () => {
  it("échange le code : échéances absolues (secondes → ms), portées", async () => {
    const calls: string[] = [];
    const auth = new TiktokShopAuthClient({
      platform,
      fetchImpl: async (u) => {
        calls.push(u);
        return ok({ access_token: "AT", access_token_expire_in: 1_700_604_800, refresh_token: "RT", refresh_token_expire_in: 1_731_536_000, open_id: "o", seller_name: "S", seller_base_region: "FR", granted_scopes: ["seller.order.info"] });
      },
    });
    const t = await auth.exchangeCode("CODE");
    expect(t).toMatchObject({ accessToken: "AT", refreshToken: "RT", accessTokenExpiresAt: 1_700_604_800_000, sellerBaseRegion: "FR", grantedScopes: ["seller.order.info"] });
    const u = new URL(calls[0]);
    expect(u.pathname).toBe("/api/v2/token/get");
    expect(u.searchParams.get("grant_type")).toBe("authorized_code");
    expect(u.searchParams.get("auth_code")).toBe("CODE");
  });
  it("rafraîchissement : grant refresh_token ; réponse incomplète refusée", async () => {
    const auth = new TiktokShopAuthClient({ platform, fetchImpl: async () => ok({ access_token: "AT" }) });
    await expect(auth.refresh("RT")).rejects.toMatchObject({ kind: "auth" });
  });
});

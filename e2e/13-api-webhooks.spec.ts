import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { db, clearRateLimits } from "./db";
import { expectNoAppError, logout } from "./helpers";

/**
 * Lot 2 · API REST et webhooks sortants (docs/vague2/W-api-webhooks.md, docs/API-REST.md, RECETTE §4 sexies)
 * sur la boutique de démo Atelier Beauté Nafi (plan Scale, propriétaire) :
 *  1. le commerçant crée un jeton API depuis l'interface (secret `axi_live_…` affiché une seule fois) ;
 *  2. l'API REST : 401 sans jeton, 200 avec, pagination par curseur sur `/api/v1/products` et `/api/v1/orders`,
 *     curseur forgé refusé, route inconnue en problem+json, 403 hors portée ;
 *  3. `include_personal_data` est refusé à un jeton `webhooks:write` sans `customers:read` ;
 *  4. un point de webhook vers un serveur HTTP local lancé par le test reçoit `order.created` après une commande
 *     réelle sur la vitrine : signature `Axi-Signature` vérifiée, corps sans nom ni téléphone ;
 *  5. le rejeu d'une livraison renvoie le même `Axi-Webhook-Id`.
 *
 * Contrainte d'environnement (assumée et documentée) : `AXI_WEBHOOKS_ALLOW_LOCALHOST=1` n'est honoré que dans le
 * processus qui crée le point et dans celui qui livre. Le serveur de développement déjà démarré ne la porte pas et
 * la recette ne redémarre aucun serveur : la création du point local et la livraison passent donc par
 * `e2e/webhook-local-runner.ts`, qui appelle les mêmes fonctions du produit que l'écran et que `pnpm jobs`.
 * Le refus des URL interdites (http, adresse privée) est, lui, vérifié dans l'interface.
 */

const SLUG = "atelier-beaute-nafi";
const OWNER = { email: "nafi@atelier-beaute-nafi.demo", password: "Demo-Axi-2026!" };
const PRODUCT = "E2E API Baume";
const PRICE = 9_000;
const TOKEN_READ = "E2E Lecture API";
const TOKEN_HOOKS = "E2E Webhooks API";

const exec = promisify(execFile);

type Received = { headers: Record<string, string>; body: string };

async function loginOwner(page: Page, next: string) {
  await clearRateLimits();
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/adresse e-mail/i).fill(OWNER.email);
  await page.getByLabel(/^mot de passe/i).fill(OWNER.password);
  await page.getByRole("button", { name: /se connecter/i }).click({ noWaitAfter: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 240_000 });
}

/** Crée un jeton API depuis l'écran « Connecteurs IA » et renvoie le secret affiché une seule fois. */
async function createToken(page: Page, storeId: string, name: string, scopes: string[] | "read"): Promise<string> {
  await page.goto(`/app/${storeId}/integrations/ia`);
  await expectNoAppError(page);
  const dialog = page.getByRole("dialog", { name: /nouveau jeton API/i });
  // Le bouton n'ouvre la fenêtre qu'une fois la page hydratée (serveur de développement).
  await expect(async () => {
    await page.getByRole("button", { name: /^créer un jeton$/i }).first().click();
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 120_000 });
  const nameField = dialog.getByRole("textbox", { name: "Nom", exact: true });
  await expect(async () => {
    await nameField.fill(name);
    await expect(nameField).toHaveValue(name, { timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  if (scopes === "read") {
    await dialog.locator('input[name="preset"][value="read"]').check();
  } else {
    await dialog.locator('input[name="preset"][value="custom"]').check();
    // « Personnalisé » part de la sélection courante : on décoche tout avant de ne garder que les autorisations
    // demandées (sinon le jeton porterait aussi les lectures du préréglage précédent).
    const boxes = dialog.getByRole("checkbox");
    for (let i = 0; i < (await boxes.count()); i++) {
      const box = boxes.nth(i);
      if ((await box.isChecked()) && (await box.isEnabled())) await box.uncheck();
    }
    // Le nom accessible de chaque case contient le libellé et le code de l'autorisation (« webhooks:write »).
    for (const scope of scopes) await dialog.getByRole("checkbox", { name: new RegExp(scope.replace(":", "\\:")) }).first().check();
  }
  await dialog.getByRole("button", { name: /créer le jeton/i }).click();
  const ready = page.getByRole("dialog", { name: /prêt/i });
  await expect(ready).toBeVisible({ timeout: 120_000 });
  // Le secret est le contenu du premier bloc de code de la fenêtre (« Jeton API »).
  const secret = ((await ready.locator("code").first().textContent()) ?? "").trim();
  expect(secret, "le secret du jeton doit être affiché une seule fois").toMatch(/^axi_live_[A-Za-z0-9_-]{32,64}$/);
  await ready.getByRole("button", { name: /j'ai copié mon jeton/i }).click();
  return secret;
}

/** Commande d'une unité du produit de test sur la vitrine (acheteur anonyme). */
async function placeOrder(page: Page, storeId: string, productSlug: string, buyer: string, phone: string): Promise<string> {
  await logout(page);
  await page.goto(`/s/${SLUG}/p/${productSlug}`);
  await expectNoAppError(page);
  await expect(async () => {
    await page.getByRole("button", { name: /ajouter au panier/i }).first().click();
    await expect(page.getByRole("button", { name: /panier vide/i })).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 150_000 });
  await page.goto(`/s/${SLUG}/commander`);
  await expectNoAppError(page);
  await page.getByLabel(/nom complet/i).fill(buyer);
  await page.getByLabel(/numéro whatsapp/i).fill(phone);
  const zone = await db.deliveryZone.findFirstOrThrow({ where: { storeId }, orderBy: { position: "asc" }, select: { id: true } });
  await page.locator('input[name="fulfillmentType"][value="DELIVERY"]').first().check({ force: true });
  await page.locator(`input[name="deliveryZoneId"][value="${zone.id}"]`).first().check({ force: true });
  await page.getByLabel(/adresse ou repère/i).fill("Mermoz, cité Comico");
  await page.getByRole("radio", { name: /Wave/i }).first().check();
  await page.getByRole("button", { name: /commander ·/i }).click();
  await page.waitForURL(/\/merci\//, { timeout: 150_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

function runner(args: string[]) {
  return exec(process.execPath, ["--conditions=react-server", "--import", "tsx", "e2e/webhook-local-runner.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, AXI_WEBHOOKS_ALLOW_LOCALHOST: "1" },
    maxBuffer: 10 * 1024 * 1024,
  });
}

// Serveur de développement : la première visite d'une page la compile.
test.describe.configure({ mode: "serial", timeout: 600_000 });
test.use({ actionTimeout: 150_000, navigationTimeout: 150_000 });

test.describe("Lot 2 : API REST et webhooks", () => {
  let storeId = "";
  let productSlug = "";
  let readToken = "";
  let hooksToken = "";
  let endpointId = "";
  let endpointSecret = "";
  let server: Server | null = null;
  let port = 0;
  const received: Received[] = [];

  test.beforeAll(async () => {
    const store = await db.store.findUnique({ where: { slug: SLUG }, select: { id: true } });
    if (!store) throw new Error(`Boutique de démo ${SLUG} absente : lancez pnpm db:seed`);
    storeId = store.id;
    productSlug = `e2e-api-baume-${Date.now().toString(36)}`;
    await db.product.create({ data: { storeId, name: PRODUCT, slug: productSlug, price: PRICE, status: "ACTIVE", description: "Produit de recette automatisée (API et webhooks)." } });
    await db.apiToken.deleteMany({ where: { storeId, name: { startsWith: "E2E " } } });
    await db.webhookEndpoint.deleteMany({ where: { storeId, OR: [{ description: { contains: "recette E2E" } }, { url: { contains: "hook-e2e" } }, { url: { contains: "localhost" } }] } });
    await clearRateLimits();

    // Récepteur local en double pile (`::`) : `localhost` se résout d'abord en ::1.
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        received.push({ headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")])), body: Buffer.concat(chunks).toString("utf8") });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "::", resolve));
    port = (server!.address() as AddressInfo).port;
  });

  test.afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (!storeId) return;
    await db.order.deleteMany({ where: { storeId, customerName: { startsWith: "E2E " } } });
    await db.customer.deleteMany({ where: { storeId, name: { startsWith: "E2E " } } });
    await db.product.deleteMany({ where: { storeId, name: PRODUCT } });
    await db.apiToken.deleteMany({ where: { storeId, name: { startsWith: "E2E " } } });
    await db.webhookEndpoint.deleteMany({ where: { storeId, OR: [{ description: { contains: "recette E2E" } }, { url: { contains: "hook-e2e" } }, { url: { contains: "localhost" } }] } });
  });

  test("le commerçant crée un jeton API : secret affiché une seule fois, préfixe ensuite", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/integrations/ia`);
    readToken = await createToken(page, storeId, TOKEN_READ, "read");
    expect(readToken).toMatch(/^axi_live_[A-Za-z0-9_-]{20,}$/);

    // Tableau des jetons (le journal des appels plus bas cite aussi le nom du jeton).
    const row = page.getByRole("region", { name: "Jetons API" }).getByRole("row").filter({ hasText: TOKEN_READ });
    await expect(row).toBeVisible();
    // Seul le préfixe reste lisible : le secret complet n'est plus affiché nulle part.
    await expect(row).not.toContainText(readToken);
    const token = await db.apiToken.findFirstOrThrow({ where: { storeId, name: TOKEN_READ }, select: { scopes: true, revokedAt: true } });
    expect(token.revokedAt).toBeNull();
    expect(token.scopes).toContain("catalog:read");
    expect(token.scopes).toContain("orders:read");
  });

  test("API REST : 401 sans jeton, pagination par curseur, curseur forgé et route inconnue", async ({ page }) => {
    const anonymous = await page.request.get("/api/v1/products");
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()["content-type"]).toContain("application/problem+json");

    const auth = { Authorization: `Bearer ${readToken}` };
    const first = await page.request.get("/api/v1/products?limit=1", { headers: auth });
    expect(first.status(), await first.text()).toBe(200);
    const page1 = (await first.json()) as { data: { id: string; name: string }[]; page: { next_cursor: string | null; has_more: boolean } };
    expect(page1.data).toHaveLength(1);
    expect(page1.page.has_more).toBe(true);
    expect(page1.page.next_cursor).toBeTruthy();

    const second = await page.request.get(`/api/v1/products?limit=1&cursor=${encodeURIComponent(page1.page.next_cursor!)}`, { headers: auth });
    expect(second.status()).toBe(200);
    const page2 = (await second.json()) as { data: { id: string }[] };
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0].id).not.toBe(page1.data[0].id);

    // Le produit de recette est bien exposé par l'API.
    const all = await page.request.get("/api/v1/products?limit=100", { headers: auth });
    const names = ((await all.json()) as { data: { name: string }[] }).data.map((p) => p.name);
    expect(names).toContain(PRODUCT);

    const orders = await page.request.get("/api/v1/orders?limit=2", { headers: auth });
    expect(orders.status()).toBe(200);
    const ordersBody = (await orders.json()) as { data: unknown[]; page: { has_more: boolean } };
    expect(ordersBody.data.length).toBeLessThanOrEqual(2);

    expect((await page.request.get("/api/v1/products?limit=500", { headers: auth })).status()).toBe(400);
    expect((await page.request.get("/api/v1/products?cursor=forge", { headers: auth })).status()).toBe(400);
    const unknown = await page.request.get("/api/v1/nope", { headers: auth });
    expect(unknown.status()).toBe(404);
    expect(unknown.headers()["content-type"]).toContain("application/problem+json");
  });

  test("API REST : 403 hors portée et données personnelles refusées sans customers:read", async ({ page }) => {
    // Jeton de lecture : la gestion des webhooks demande `webhooks:write`.
    const denied = await page.request.get("/api/v1/webhooks", { headers: { Authorization: `Bearer ${readToken}` } });
    expect(denied.status()).toBe(403);
    const problem = (await denied.json()) as { type?: string; title?: string; required_scope?: string };
    expect(JSON.stringify(problem)).toContain("webhooks:write");

    await loginOwner(page, `/app/${storeId}/integrations/ia`);
    hooksToken = await createToken(page, storeId, TOKEN_HOOKS, ["webhooks:write"]);
    // Portée exacte du jeton : aucune lecture de données personnelles.
    expect((await db.apiToken.findFirstOrThrow({ where: { storeId, name: TOKEN_HOOKS }, select: { scopes: true } })).scopes).toEqual(["webhooks:write"]);
    // Les écritures REST exigent une clé d'idempotence (docs/API-REST.md).
    const auth = (key: string) => ({ Authorization: `Bearer ${hooksToken}`, "Content-Type": "application/json", "Idempotency-Key": key });

    const refused = await page.request.post("/api/v1/webhooks", {
      headers: auth(`e2e-hook-pii-${Date.now()}`),
      data: { url: "https://exemple.com/hook-e2e", events: ["order.created"], include_personal_data: true },
    });
    expect(refused.status(), await refused.text()).toBe(403);
    expect(JSON.stringify(await refused.json())).toContain("customers:read");
    expect(await db.webhookEndpoint.count({ where: { storeId, url: "https://exemple.com/hook-e2e" } })).toBe(0);

    // Sans données personnelles, le même jeton crée le point et reçoit le secret une seule fois.
    const created = await page.request.post("/api/v1/webhooks", { headers: auth(`e2e-hook-ok-${Date.now()}`), data: { url: "https://exemple.com/hook-e2e", events: ["order.created"], description: "Point https de recette E2E" } });
    expect(created.status(), await created.text()).toBe(201);
    const endpoint = (await created.json()) as { id: string; secret: string; include_personal_data?: boolean };
    expect(endpoint.secret).toMatch(/^whsec_/);
    const stored = await db.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id }, select: { includePersonalData: true, url: true } });
    expect(stored.includePersonalData).toBe(false);

    // Relecture : le secret n'est plus jamais renvoyé.
    const read = await page.request.get(`/api/v1/webhooks/${endpoint.id}`, { headers: { Authorization: `Bearer ${hooksToken}` } });
    expect(read.status()).toBe(200);
    expect(JSON.stringify(await read.json())).not.toContain(endpoint.secret);
    await db.webhookEndpoint.delete({ where: { id: endpoint.id } });
  });

  test("l'écran refuse les URL interdites (http, adresse privée)", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/integrations/webhooks`);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: /webhooks/i }).first()).toBeVisible();
    const before = await db.webhookEndpoint.count({ where: { storeId } });
    for (const url of ["http://exemple.com/hook", "https://10.0.0.1/hook"]) {
      await page.getByRole("button", { name: /ajouter un point/i }).first().click();
      const dialog = page.getByRole("dialog", { name: /nouveau point de webhook/i });
      const field = dialog.getByRole("textbox", { name: /URL de réception/i });
      await expect(async () => {
        await field.fill(url);
        await expect(field).toHaveValue(url, { timeout: 3_000 });
      }).toPass({ timeout: 60_000 });
      await dialog.getByRole("button", { name: /créer le point/i }).click();
      // Message de refus explicite, et rien n'est enregistré.
      await expect(dialog.getByRole("alert").first()).toBeVisible({ timeout: 60_000 });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
    expect(await db.webhookEndpoint.count({ where: { storeId } })).toBe(before);
  });

  test("livraison réelle : order.created signé reçu par le serveur local, sans données personnelles", async ({ page }) => {
    const url = `http://localhost:${port}/hook`;
    const out = await runner(["create", storeId, url]);
    const endpoint = JSON.parse(out.stdout.trim()) as { id: string; secret: string };
    endpointId = endpoint.id;
    endpointSecret = endpoint.secret;
    expect(endpointSecret).toMatch(/^whsec_/);

    received.length = 0;
    await placeOrder(page, storeId, productSlug, "E2E API Acheteuse", "771100330");

    // Les tâches `webhook.fanout` puis `webhook.deliver` sont exécutées par le processus qui autorise le bouclage.
    await expect
      .poll(
        async () => {
          await runner(["deliver"]);
          return received.length;
        },
        { timeout: 180_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBeGreaterThan(0);

    const hit = received[0];
    expect(hit.headers["content-type"]).toContain("application/json");
    expect(hit.headers["axi-webhook-id"]).toBeTruthy();
    expect(hit.headers["axi-delivery-id"]).toBeTruthy();

    // Signature : t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${corps}`)> (docs/API-REST.md).
    const header = hit.headers["axi-signature"];
    expect(header).toBeTruthy();
    const timestamp = Number(header.match(/t=(\d+)/)![1]);
    const signatures = [...header.matchAll(/v1=([0-9a-f]{64})/g)].map((m) => m[1]);
    const expected = createHmac("sha256", endpointSecret).update(`${timestamp}.${hit.body}`, "utf8").digest("hex");
    expect(signatures.some((s) => timingSafeEqual(Buffer.from(s, "hex"), Buffer.from(expected, "hex")))).toBe(true);
    expect(Math.abs(Math.floor(Date.now() / 1000) - timestamp)).toBeLessThan(300);

    const payload = JSON.parse(hit.body) as { type: string; data: Record<string, unknown> };
    expect(payload.type).toBe("order.created");
    // Aucune donnée personnelle sans l'option correspondante.
    expect(hit.body).not.toContain("E2E API Acheteuse");
    expect(hit.body).not.toContain("771100330");
    expect(hit.body).not.toContain("Mermoz");
  });

  test("rejeu d'une livraison : même identifiant d'événement et de livraison", async () => {
    const delivery = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
    expect(delivery.status).toBe("SUCCEEDED");
    // `deliver` exécute tous les jobs en attente (global) : on cible la livraison par son identifiant plutôt que
    // `received[0]`, pour ne pas confondre avec une autre livraison arrivée entre-temps.
    const firstHit = received.find((h) => h.headers["axi-delivery-id"] === delivery.id) ?? received[0];
    received.length = 0;

    await runner(["replay", delivery.id]);
    await expect
      .poll(
        async () => {
          await runner(["deliver"]);
          return received.some((h) => h.headers["axi-delivery-id"] === delivery.id);
        },
        { timeout: 180_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(true);

    // Idempotence du rejeu : la MÊME livraison est rejouée (même eventId, même deliveryId, même corps).
    const replayed = received.find((h) => h.headers["axi-delivery-id"] === delivery.id)!;
    expect(replayed.headers["axi-delivery-id"]).toBe(delivery.id);
    expect(replayed.headers["axi-webhook-id"]).toBe(firstHit.headers["axi-webhook-id"]);
    expect(JSON.parse(replayed.body)).toEqual(JSON.parse(firstHit.body));
  });
});

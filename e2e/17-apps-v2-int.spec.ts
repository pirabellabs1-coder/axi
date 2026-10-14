import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import { db } from "./db";
import { DEMO, expectNoAppError } from "./helpers";
import { startTestApp } from "./apps-int-test-app";
import { appSigningSecret } from "../src/lib/apps/install-signing";

/**
 * App Store v2 — équipe INT : une app EXTERNE (serveur local :4555, e2e/apps-int-test-app.ts) s'installe sur
 * « chez-aicha » via OAuth, appelle l'API, reçoit ses webhooks de cycle de vie, s'affiche dans l'admin (iframe),
 * puis perd l'accès à la désinstallation. Données de test créées ici et supprimées à la fin (app, client, installation).
 */

type LoadEnvFile = (path?: string) => void;
const loadEnv = (process as unknown as { loadEnvFile?: LoadEnvFile }).loadEnvFile;
if (!process.env.APP_SECRET && typeof loadEnv === "function") {
  try {
    loadEnv(".env");
  } catch {
    // variables fournies par le shell
  }
}

const exec = promisify(execFile);
const PORT = 4555;
const TEST_APP = `http://localhost:${PORT}`;
const AXI = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SLUG = `e2e-int-app-${Date.now().toString(36)}`;
const CLIENT_ID = `axi_cli_e2e${randomBytes(8).toString("hex")}`;
const CLIENT_SECRET = `axi_cs_${randomBytes(30).toString("base64url")}`;

function lifecycle(event: string, appId: string, storeId: string, installationId: string) {
  return exec(process.execPath, ["--conditions=react-server", "--import", "tsx", "e2e/apps-int-lifecycle-runner.ts", event, appId, storeId, installationId], {
    cwd: process.cwd(),
    env: { ...process.env, AXI_WEBHOOKS_ALLOW_LOCALHOST: "1" },
  });
}

async function loginDemo(page: Page, next: string) {
  await db.rateLimit.deleteMany({ where: { key: { startsWith: "login:" } } });
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/adresse e-mail/i).fill(DEMO.email);
  await page.getByLabel(/^mot de passe/i).fill(DEMO.password);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 120_000 });
}

test.describe.configure({ mode: "serial", timeout: 600_000 });
test.use({ actionTimeout: 150_000, navigationTimeout: 150_000 });

test.describe("App Store v2 (INT) : app externe installée par OAuth", () => {
  let appId = "";
  let storeId = "";
  let testApp: Awaited<ReturnType<typeof startTestApp>>;

  test.beforeAll(async () => {
    const store = await db.store.findUniqueOrThrow({ where: { slug: "chez-aicha" }, select: { id: true } });
    storeId = store.id;
    const client = await db.oAuthClient.create({
      data: { clientId: CLIENT_ID, clientSecretHash: createHash("sha256").update(CLIENT_SECRET).digest("hex"), name: "App de test INT", redirectUris: [`${TEST_APP}/callback`] },
    });
    const app = await db.app.create({
      data: {
        slug: SLUG,
        name: "App de test INT",
        tagline: "Application externe de recette (OAuth, API, iframe, webhooks).",
        category: "autre",
        developerName: "Recette E2E",
        status: "PUBLISHED",
        listed: false,
        requestedScopes: ["store:read", "catalog:read"],
        appUrl: `${TEST_APP}/embed`,
        webhookUrl: `${TEST_APP}/webhooks`,
        oauthClientId: client.clientId,
      },
    });
    appId = app.id;
    testApp = await startTestApp({ port: PORT, axiBase: AXI, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, signingSecret: appSigningSecret(app.id, client.clientSecretHash) });
  });

  test.afterAll(async () => {
    await testApp?.close();
    if (appId) {
      await db.job.deleteMany({ where: { type: { in: ["app.installed", "app.uninstalled"] }, payload: { path: ["appId"], equals: appId } } });
      await db.auditLog.deleteMany({ where: { target: appId } });
      await db.app.deleteMany({ where: { id: appId } }); // installations en cascade
    }
    await db.oAuthClient.deleteMany({ where: { clientId: CLIENT_ID } }); // codes, grants, jetons en cascade
    await db.$disconnect();
  });

  test("installation → redirection signée → jeton → API → iframe → désinstallation → API refusée", async ({ page }) => {
    const base = `/app/${storeId}/applications`;
    await loginDemo(page, `${base}/${SLUG}`);
    await page.goto(`${base}/${SLUG}`);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: "App de test INT" })).toBeVisible();

    // 1. Installer (écran de consentement des scopes) → redirection vers le serveur de l'app.
    await page.getByRole("button", { name: /^installer$/i }).click();
    await expect(page.getByRole("dialog")).toContainText("Lire le catalogue");
    await page.screenshot({ path: "docs/captures/apps-v2-int-1-consentement.png" });
    await page.getByRole("button", { name: /autoriser et installer/i }).click();
    // Serveur de dev : la première compilation des routes /api/oauth/token et /api/v1 peut être lente.
    await page.waitForURL(`${TEST_APP}/callback**`, { timeout: 300_000, waitUntil: "commit" });
    const cb = new URL(page.url());
    expect(cb.searchParams.get("shop")).toBe("chez-aicha");
    for (const k of ["code", "state", "timestamp", "host", "hmac"]) expect(cb.searchParams.get(k), k).toBeTruthy();

    // 2. L'app a vérifié le hmac, échangé le code (client_secret, sans PKCE) et appelé l'API.
    await expect(page.getByRole("heading", { name: "Installation réussie" })).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId("token")).toContainText("obtenu");
    await expect(page.getByTestId("api")).toContainText("HTTP 200");
    await page.screenshot({ path: "docs/captures/apps-v2-int-2-redirection-app.png" });
    expect(testApp.state.callback).toMatchObject({ hmacOk: true, shop: "chez-aicha", tokenStatus: 200, scope: "store:read catalog:read" });
    expect(testApp.state.apiCalls.at(-1)?.status).toBe(200);

    const install = await db.appInstallation.findUniqueOrThrow({ where: { appId_storeId: { appId, storeId } } });
    expect(install.status).toBe("ACTIVE");
    expect(install.oauthGrantId).toBeTruthy();

    // 3. Webhook de cycle de vie app.installed : signé avec le secret de l'app, vérifié par l'app.
    const sent = JSON.parse((await lifecycle("app.installed", appId, storeId, install.id)).stdout.trim());
    expect(sent.outcome).toBe("sent");
    expect(testApp.state.webhooks.find((w) => w.topic === "app.installed")).toMatchObject({ signatureOk: true, shop: "chez-aicha" });

    // 4. « Ouvrir l'application » : iframe sous l'en-tête Axi, session vérifiée côté app.
    await page.goto(`${base}?vue=mes-apps`);
    await page.getByRole("link", { name: "Ouvrir l'application App de test INT" }).click();
    await page.waitForURL(`**${base}/${SLUG}/ouvrir`);
    await expect(page.getByRole("heading", { name: "App de test INT" })).toBeVisible();
    const frame = page.frameLocator('iframe[title="Application App de test INT"]');
    await expect(frame.getByTestId("embed")).toContainText("chez-aicha", { timeout: 60_000 });
    await expect(frame.getByTestId("embed")).toContainText("store:read catalog:read");
    expect(testApp.state.embed?.status).toBe(200);
    const sandbox = await page.locator("iframe").first().getAttribute("sandbox");
    expect(sandbox).not.toContain("allow-top-navigation");
    await page.screenshot({ path: "docs/captures/apps-v2-int-3-iframe.png" });

    // 5. Désinstaller → l'API refuse le jeton de l'app ; webhook app.uninstalled.
    await page.goto(`${base}/${SLUG}`);
    await page.getByRole("button", { name: /désinstaller/i }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /^désinstaller$/i }).click();
    await expect(page.getByRole("button", { name: /^installer$/i })).toBeVisible({ timeout: 60_000 });
    const check = (await (await fetch(`${TEST_APP}/api-check`)).json()) as { status: number };
    expect(check.status).toBe(401);
    const gone = JSON.parse((await lifecycle("app.uninstalled", appId, storeId, install.id)).stdout.trim());
    expect(gone.outcome).toBe("sent");
    expect(testApp.state.webhooks.find((w) => w.topic === "app.uninstalled")).toMatchObject({ signatureOk: true });
    await page.screenshot({ path: "docs/captures/apps-v2-int-4-desinstallee.png" });
  });
});

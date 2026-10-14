import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { db, clearRateLimits } from "./db";
import { DEMO, expectNoAppError, logout } from "./helpers";

/**
 * Vague 2 (docs/vague2/N-produits-numeriques.md) — produits numériques, sur la boutique de démo Dantokpa Mode :
 *  1. le commerçant crée un produit « Produit numérique », téléverse un fichier et limite les téléchargements ;
 *  2. un acheteur invité le commande (aucune livraison, aucun frais, pas de paiement à la livraison) ;
 *  3. le commerçant confirme le paiement, la file de tâches émet l'accès et clôt la commande ;
 *  4. l'acheteur ouvre ses fichiers depuis le suivi, télécharge, et le compteur se décrémente jusqu'à la limite.
 *
 * Données de test : produit « E2E Produit numérique » et commande au nom « E2E … » (supprimées à la fin).
 */

const SLUG = "dantokpa-mode";
const CAPTURES = path.join(process.cwd(), "docs", "captures");
const TMP = path.join(process.cwd(), ".local", "e2e");

/** PDF minimal valide (octets magiques `%PDF-`) : le serveur décide du format par les octets. */
const PDF = ["%PDF-1.4", "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj", "trailer<</Root 1 0 R>>", "%%EOF"].join("\n");

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const file = path.join(process.cwd(), ".env");
  if (existsSync(file)) {
    const m = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    if (m) return String(m[1]).trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} manquant pour la recette des produits numériques`);
}

/**
 * Connexion marchand avec une attente large : sur le serveur de développement, la première visite d'une page
 * la compile. On arrive directement sur la page visée (`next`) plutôt que sur le tableau de bord.
 */
async function loginMerchant(page: Page, next: string) {
  await clearRateLimits();
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/adresse e-mail/i).fill(DEMO.email);
  await page.getByLabel(/^mot de passe/i).fill(DEMO.password);
  await page.getByRole("button", { name: /se connecter/i }).click({ noWaitAfter: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 240_000 });
}

async function runJobs(page: Page) {
  const res = await page.request.post("/api/jobs/run", { headers: { "x-jobs-key": env("JOBS_RUN_KEY") } });
  expect(res.ok()).toBeTruthy();
}

async function shot(page: Page, name: string) {
  if (!existsSync(CAPTURES)) mkdirSync(CAPTURES, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(CAPTURES, `vague2-numerique-${name}.png`), fullPage: true });
}

// Serveur de développement : la première visite d'une page la compile (jusqu'à 2 min sur un poste chargé).
test.describe.configure({ mode: "serial", timeout: 600_000 });
test.use({ actionTimeout: 150_000, navigationTimeout: 150_000 });

test.describe("Vague 2 : produits numériques", () => {
  let storeId = "";
  let productId = "";
  let productSlug = "";
  let orderId = "";
  let trackingToken = "";
  const filePath = path.join(TMP, "e2e-guide.pdf");

  test.beforeAll(async () => {
    const store = await db.store.findUnique({ where: { slug: SLUG }, select: { id: true } });
    if (!store) throw new Error("Boutique de démo dantokpa-mode absente : lancez pnpm db:seed");
    storeId = store.id;
    productSlug = `e2e-produit-numerique-${Date.now().toString(36)}`;
    if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
    writeFileSync(filePath, PDF, "utf8");
    await clearRateLimits();
  });

  test.afterAll(async () => {
    await db.order.deleteMany({ where: { customerName: { startsWith: "E2E " } } });
    await db.product.deleteMany({ where: { storeId, name: "E2E Produit numérique" } });
  });

  test("le commerçant crée un produit numérique et téléverse un fichier", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/produits/nouveau`);
    await expectNoAppError(page);
    // Nature : le formulaire s'adapte (ni stock, ni expédition, carte « Fichiers à remettre »).
    // Le choix peut précéder l'hydratation (serveur de développement) : on recommence jusqu'à ce qu'il porte.
    // Le type se choisit en premier via les cartes « Que vendez-vous ? » (kind-picker.tsx), puis le formulaire s'adapte.
    await expect(async () => {
      await page.getByRole("radio", { name: /Produit numérique/i }).check({ force: true });
      await expect(page.getByText(/pas de stock à suivre/i)).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 120_000 });
    await page.locator("#name").fill("E2E Produit numérique");
    await page.locator("#price").fill("7000");
    await expect(page.getByRole("heading", { name: "Expédition" })).toHaveCount(0);
    await expect(page.getByText(/Enregistrez d'abord le produit/i)).toBeVisible();
    await page.getByRole("button", { name: /créer le produit/i }).click();
    await expect.poll(async () => db.product.count({ where: { storeId, name: "E2E Produit numérique" } }), { timeout: 120_000 }).toBe(1);
    const created = await db.product.findFirstOrThrow({ where: { storeId, name: "E2E Produit numérique" }, select: { id: true, kind: true, trackStock: true, slug: true, weightGrams: true } });
    productId = created.id;
    // Le formulaire redirige vers la fiche enregistrée (où les fichiers se téléversent).
    await page.waitForURL(new RegExp(`/produits/${productId}$`), { timeout: 120_000 });
    expect(created.kind).toBe("DIGITAL");
    expect(created.trackStock).toBe(false);
    expect(created.weightGrams).toBeNull();
    productSlug = created.slug;

    // Téléversement du fichier (octets bruts, sans compression) et limite de téléchargements.
    await page.locator('input[type="file"][accept*="application/pdf"]').first().setInputFiles(filePath);
    await expect(page.getByText("e2e-guide.pdf").first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => db.digitalAsset.count({ where: { storeId, productId } }), { timeout: 30_000 }).toBe(1);
    const asset = await db.digitalAsset.findFirstOrThrow({ where: { storeId, productId } });
    expect(asset.mime).toBe("application/pdf");
    expect(asset.storageKey).toMatch(/^stores\/[a-z0-9]+\/files\/\d{4}\/\d{2}\/[a-f0-9]{64}\.pdf$/);
    // La clé n'est jamais servie par la route publique des médias.
    expect((await page.request.get(`/media/${asset.storageKey}`)).status()).toBe(404);

    await page.locator("#downloadLimit").fill("2");
    await page.locator("#downloadValidityDays").fill("30");
    await page.locator("#postPurchaseInstructions").fill("Ouvrez le PDF avec un lecteur récent.");
    await shot(page, "fiche-produit");
    await page.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect.poll(async () => (await db.product.findUniqueOrThrow({ where: { id: productId } })).downloadLimit, { timeout: 30_000 }).toBe(2);

    // Liste du catalogue : badge « Numérique · 1 fichier ».
    await page.goto(`/app/${storeId}/produits?q=E2E+Produit`);
    await expect(page.getByText(/Numérique · 1 fichier/).filter({ visible: true }).first()).toBeVisible();
    await expectNoAppError(page);
    await shot(page, "liste-catalogue");
  });

  test("un acheteur invité commande : aucune livraison, pas de paiement à la livraison", async ({ page }) => {
    await logout(page);
    await page.goto(`/s/${SLUG}/p/${productSlug}`, { waitUntil: "networkidle" });
    await expectNoAppError(page);
    await page.getByRole("button", { name: /ajouter au panier/i }).first().click();
    await page.goto(`/s/${SLUG}/commander`);
    await expectNoAppError(page);
    // Panier 100 % numérique : la vitrine n'offre aucun choix de retrait / livraison (remise numérique
    // imposée par le serveur, sans frais ni adresse). Si un sélecteur subsiste pour un panier mixte, on
    // le règle sur PICKUP ; sinon on passe directement au contact et au paiement.
    const fulfillmentPickup = page.locator('input[name="fulfillmentType"][value="PICKUP"]');
    if ((await fulfillmentPickup.count()) > 0) {
      await fulfillmentPickup.first().check({ force: true });
    }
    await page.getByLabel(/nom complet/i).fill("E2E Numérique");
    await page.getByLabel(/numéro whatsapp/i).fill("0196000031");
    await page.getByRole("radio", { name: /MTN MoMo/i }).check();
    await page.getByRole("button", { name: /commander ·/i }).click();
    await page.waitForURL(/\/merci\//, { timeout: 90_000 });
    trackingToken = new URL(page.url()).pathname.split("/").pop()!;
    const order = await db.order.findUniqueOrThrow({ where: { trackingToken }, select: { id: true, fulfillmentType: true, deliveryFee: true, deliveryAddress: true, total: true, status: true, paymentStatus: true } });
    orderId = order.id;
    expect(order.fulfillmentType).toBe("DIGITAL");
    expect(order.deliveryFee).toBe(0);
    expect(order.deliveryAddress).toBeNull();
    expect(order.total).toBe(7000);
    expect(order.paymentStatus).toBe("PENDING");
    // Aucun accès tant que le paiement n'est pas confirmé.
    expect(await db.downloadGrant.count({ where: { storeId, orderId } })).toBe(0);
  });

  test("paiement confirmé : accès émis par la file de tâches et commande clôturée", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/commandes/${orderId}`);
    await expect(async () => {
      await page.getByRole("button", { name: /confirmer le paiement/i }).filter({ visible: true }).first().click();
      await expect(page.getByRole("button", { name: /oui, paiement reçu/i }).filter({ visible: true })).toHaveCount(1, { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByRole("button", { name: /oui, paiement reçu/i }).filter({ visible: true }).first().click();
    await expect.poll(async () => (await db.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus, { timeout: 30_000 }).toBe("PAID");

    await expect
      .poll(
        async () => {
          await runJobs(page);
          return db.downloadGrant.count({ where: { storeId, orderId } });
        },
        { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(1);
    const grant = await db.downloadGrant.findFirstOrThrow({ where: { storeId, orderId } });
    expect(grant.downloadLimit).toBe(2);
    expect(grant.downloadCount).toBe(0);
    expect(grant.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    // Commande 100 % numérique : clôturée sans étape d'expédition.
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DELIVERED");

    // Suivi marchand des téléchargements.
    await page.goto(`/app/${storeId}/commandes/${orderId}`);
    await expect(page.getByRole("heading", { name: "Téléchargements" })).toBeVisible();
    await expect(page.getByText(/0 téléchargement sur 2/)).toBeVisible();
    await shot(page, "commande-marchand");
  });

  test("l'acheteur télécharge depuis son suivi et le compteur se décrémente jusqu'à la limite", async ({ page }) => {
    await logout(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/suivi/${trackingToken}`);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: "Vos fichiers" })).toBeVisible();
    await page.getByRole("button", { name: /^ouvrir$/i }).click();
    await page.waitForURL(/\/telechargement\//, { timeout: 60_000 });
    await expect(page.getByText("e2e-guide.pdf")).toBeVisible();
    await expect(page.getByText("2 téléchargements restants sur 2")).toBeVisible();
    await expect(page.getByText(/Ouvrez le PDF avec un lecteur récent\./)).toBeVisible();
    await shot(page, "page-telechargement");

    const href = await page.getByRole("link", { name: /télécharger/i }).first().getAttribute("href");
    expect(href).toMatch(/^\/telechargement\/[A-Za-z0-9_-]{43}\/fichier\/[a-z0-9]+$/i);
    const first = await page.request.get(href!);
    expect(first.status()).toBe(200);
    expect(first.headers()["content-type"]).toBe("application/pdf");
    expect(first.headers()["content-disposition"]).toContain("attachment");
    expect(first.headers()["cache-control"]).toContain("no-store");
    expect((await first.body()).toString("utf8")).toContain("%PDF-");

    await page.reload();
    await expect(page.getByText("1 téléchargement restant sur 2")).toBeVisible();
    expect((await page.request.get(href!)).status()).toBe(200);
    // Limite atteinte : plus aucun téléchargement.
    expect((await page.request.get(href!)).status()).toBe(403);
    await page.reload();
    await expect(page.getByText(/nombre de téléchargements autorisés a été atteint/i)).toBeVisible();
    const grant = await db.downloadGrant.findFirstOrThrow({ where: { storeId, orderId } });
    expect(grant.downloadCount).toBe(2);
    expect(grant.lastDownloadAt).not.toBeNull();

    // Jeton inconnu : page « introuvable », aucun indice.
    await page.goto(`/telechargement/${"z".repeat(43)}`);
    await expect(page.getByText(/lien de téléchargement introuvable/i)).toBeVisible();
  });
});

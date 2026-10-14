import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { db, clearRateLimits } from "./db";
import { expectNoAppError, logout } from "./helpers";

/**
 * Lot 1 bis · flux catalogue (docs/vague2/P2-catalogue-whatsapp.md, RECETTE §4 quinquies) sur la boutique de
 * démo Atelier Beauté Nafi (plan Scale, publiée) :
 *  1. flux désactivés : `/s/{slug}/feeds/meta.xml` répond 404 ;
 *  2. activés depuis l'écran « Catalogue WhatsApp » : `meta.xml`, `google.xml` et `tiktok.csv` répondent 200 avec
 *     le bon type de contenu, un XML bien formé (analysé par le navigateur) et une ligne par article ;
 *  3. aucun champ privé n'est publié (SKU, stock, prix d'achat, étiquettes, notes internes) ;
 *  4. un produit sans photo n'est pas publié, un nom commençant par « = » est neutralisé dans le CSV ;
 *  5. désactivés : 404 immédiat.
 *
 * Données créées puis supprimées : produits « E2E … » (dont un sans photo et un au nom piégé) ; les réglages de
 * flux de la boutique sont remis dans leur état initial.
 *
 * Hors périmètre automatisé : la synchronisation directe avec l'API Meta (compte Meta et jeton `catalog_management`
 * requis). Tout ce qui précède l'appel externe (flux, exclusions, options) est couvert ici.
 */

const SLUG = "atelier-beaute-nafi";
const OWNER = { email: "nafi@atelier-beaute-nafi.demo", password: "Demo-Axi-2026!" };
const TRAP = "=E2E Formule TikTok";
const NO_PHOTO = "E2E Sans photo";
const IMAGE = "https://images.unsplash.com/photo-1556228720-195a672e8a03";
const FEEDS = { meta: "Meta (WhatsApp, Facebook, Instagram)", google: "Google Merchant Center", tiktok: "TikTok Catalog" } as const;

async function loginOwner(page: Page, next: string) {
  await clearRateLimits();
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/adresse e-mail/i).fill(OWNER.email);
  await page.getByLabel(/^mot de passe/i).fill(OWNER.password);
  await page.getByRole("button", { name: /se connecter/i }).click({ noWaitAfter: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 240_000 });
}

/** Interrupteur du flux dont le nom est donné (chaque ligne porte le même libellé « Activé / Désactivé »). */
function feedSwitch(page: Page, name: string) {
  return page.getByText(name, { exact: true }).locator("xpath=ancestor::div[1]/following::input[@role='switch'][1]");
}

async function setFeed(page: Page, channel: keyof typeof FEEDS, enabled: boolean, storeId: string) {
  const sw = feedSwitch(page, FEEDS[channel]);
  await expect(async () => {
    if ((await sw.isChecked()) !== enabled) await sw.setChecked(enabled, { force: true });
    expect((await db.socialCatalogSync.findFirst({ where: { storeId, channel } }))?.enabled ?? false).toBe(enabled);
  }).toPass({ timeout: 150_000 });
}

/** Analyse le XML dans le navigateur : un document mal formé produit un élément `parsererror`. */
async function assertWellFormedXml(page: Page, xml: string) {
  const error = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    return doc.querySelector("parsererror")?.textContent ?? null;
  }, xml);
  expect(error, "le flux doit être un XML bien formé").toBeNull();
}

// Serveur de développement : la première visite d'une page la compile.
test.describe.configure({ mode: "serial", timeout: 600_000 });
test.use({ actionTimeout: 150_000, navigationTimeout: 150_000 });

test.describe("Lot 1 bis : flux catalogue WhatsApp, Google et TikTok", () => {
  let storeId = "";
  let initial: { channel: string; enabled: boolean }[] = [];

  test.beforeAll(async () => {
    const store = await db.store.findUnique({ where: { slug: SLUG }, select: { id: true, status: true } });
    if (!store) throw new Error(`Boutique de démo ${SLUG} absente : lancez pnpm db:seed`);
    storeId = store.id;
    expect(store.status).toBe("PUBLISHED");
    initial = (await db.socialCatalogSync.findMany({ where: { storeId }, select: { channel: true, enabled: true } })).map((r) => ({ channel: r.channel, enabled: r.enabled }));
    await db.product.deleteMany({ where: { storeId, name: { in: [TRAP, NO_PHOTO] } } });
    await db.product.createMany({
      data: [
        { storeId, name: TRAP, slug: `e2e-formule-tiktok-${Date.now().toString(36)}`, price: 5_000, status: "ACTIVE", sku: "E2E-SKU-TRAP", costPrice: 1_234, trackStock: true, stock: 7, tags: ["e2e-etiquette-privee"], images: [{ url: IMAGE, alt: "Pot de karité" }] as never },
        { storeId, name: NO_PHOTO, slug: `e2e-sans-photo-${Date.now().toString(36)}`, price: 6_000, status: "ACTIVE" },
      ],
    });
    await clearRateLimits();
  });

  test.afterAll(async () => {
    if (!storeId) return;
    await db.product.deleteMany({ where: { storeId, name: { in: [TRAP, NO_PHOTO] } } });
    for (const row of initial) await db.socialCatalogSync.updateMany({ where: { storeId, channel: row.channel }, data: { enabled: row.enabled } });
    await db.socialCatalogSync.deleteMany({ where: { storeId, channel: { in: ["meta", "google", "tiktok"] }, NOT: { channel: { in: initial.map((r) => r.channel) } } } });
  });

  test("flux désactivé : les adresses publiques répondent 404", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/integrations/whatsapp-catalogue`);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: "Flux catalogues" })).toBeVisible();
    for (const channel of ["meta", "google", "tiktok"] as const) await setFeed(page, channel, false, storeId);

    await logout(page);
    for (const file of ["meta.xml", "google.xml", "tiktok.csv"]) {
      expect((await page.request.get(`/s/${SLUG}/feeds/${file}`)).status(), file).toBe(404);
    }
  });

  test("flux activés : meta.xml et google.xml bien formés, sans champ privé", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/integrations/whatsapp-catalogue`);
    await setFeed(page, "meta", true, storeId);
    await setFeed(page, "google", true, storeId);
    // L'adresse publique du flux est affichée au commerçant dès l'activation.
    await expect(page.getByText(`/s/${SLUG}/feeds/meta.xml`).first()).toBeVisible();

    await logout(page);
    for (const file of ["meta.xml", "google.xml"]) {
      const res = await page.request.get(`/s/${SLUG}/feeds/${file}`);
      expect(res.status(), file).toBe(200);
      expect(res.headers()["content-type"]).toContain("xml");
      expect(res.headers()["x-robots-tag"]).toContain("noindex");
      const xml = await res.text();
      await assertWellFormedXml(page, xml);
      expect(xml).toContain("<rss");
      expect(xml).toContain("<item>");
      expect(xml).toContain("Beurre de karité brut 250 g");
      // Produit sans photo : exclu du flux.
      expect(xml).not.toContain(NO_PHOTO);
      // Aucune donnée privée.
      expect(xml).not.toContain("E2E-SKU-TRAP");
      expect(xml).not.toContain("e2e-etiquette-privee");
      expect(xml).not.toContain("1234");
      expect(xml.toLowerCase()).not.toContain("<g:quantity");
      expect(xml.toLowerCase()).not.toContain("cost");
      // Les URL sont échappées : aucun « & » nu.
      expect(/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(xml)).toBe(false);
    }
  });

  test("tiktok.csv : colonnes attendues, formule neutralisée, aucun champ privé", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/integrations/whatsapp-catalogue`);
    await setFeed(page, "tiktok", true, storeId);

    await logout(page);
    const res = await page.request.get(`/s/${SLUG}/feeds/tiktok.csv`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const csv = await res.text();
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("sku_id,title,description,availability,condition,price,sale_price,link,image_link,additional_image_link,brand,gtin,item_group_id,color,size,product_type");
    expect(lines.length).toBeGreaterThan(1);
    // Un tableur ne doit jamais interpréter un titre comme une formule : apostrophe protectrice.
    const trap = lines.find((l) => l.includes("E2E Formule TikTok"));
    expect(trap, "le produit au nom piégé doit être publié").toBeTruthy();
    expect(trap).toContain(`'${TRAP}`);
    expect(trap!.split(",")[1].startsWith("=")).toBe(false);
    // Aucune donnée privée, produit sans photo exclu.
    expect(csv).not.toContain("E2E-SKU-TRAP");
    expect(csv).not.toContain("e2e-etiquette-privee");
    expect(csv).not.toContain(NO_PHOTO);
    expect(csv).not.toContain("1234");
  });

  test("flux désactivés depuis l'écran : 404 immédiat", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/integrations/whatsapp-catalogue`);
    for (const channel of ["meta", "google", "tiktok"] as const) await setFeed(page, channel, false, storeId);

    await logout(page);
    for (const file of ["meta.xml", "google.xml", "tiktok.csv"]) {
      expect((await page.request.get(`/s/${SLUG}/feeds/${file}`)).status(), file).toBe(404);
    }
  });
});

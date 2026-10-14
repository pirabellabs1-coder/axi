import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { db, clearRateLimits } from "./db";
import { DEMO, expectNoAppError, logout } from "./helpers";

/**
 * Lot 2 · devises (docs/vague2/C-devises-taxes-checkout.md, RECETTE §4 sexies) sur la boutique de démo
 * Dantokpa Mode (FCFA, Bénin, plan Business) :
 *  1. le commerçant active l'euro depuis `/app/{id}/devises` (parité fixe BCEAO, exemple de conversion) ;
 *  2. un acheteur bascule le sélecteur de la vitrine et retrouve des prix en euros sur l'accueil, la collection,
 *     la fiche, la recherche et le panier, avec la mention « vous serez débité en FCFA » ;
 *  3. les données structurées schema.org gardent la devise de la boutique (XOF) ;
 *  4. la commande passée en affichage euro est calculée en FCFA et garde l'instantané de devise
 *     (`presentmentCurrency`, `presentmentRate`, `presentmentTotal`), la tentative de paiement restant en XOF.
 *
 * Données créées : produit « E2E Devise Parure » (10 000 FCFA, collection Accessoires), devise EUR de la
 * boutique, commande « E2E Devises ». Tout est supprimé à la fin (la devise est retirée pour rendre la
 * boutique de démo à son état initial).
 */

const SLUG = "dantokpa-mode";
const PRODUCT = "E2E Devise Parure";
const PRICE = 10_000;
/** 10 000 FCFA à la parité fixe 1 € = 655,957 FCFA, sans marge ni arrondi commercial. */
const PRICE_EUR = "15,24 €";
const BUYER = "E2E Devises";

async function loginMerchant(page: Page, next: string) {
  await clearRateLimits();
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/adresse e-mail/i).fill(DEMO.email);
  await page.getByLabel(/^mot de passe/i).fill(DEMO.password);
  await page.getByRole("button", { name: /se connecter/i }).click({ noWaitAfter: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 240_000 });
}

/** Bascule le sélecteur de devise de la vitrine (cookie `axi_cur` + rafraîchissement serveur). */
async function pickCurrency(page: Page, code: string) {
  // L'en-tête (ordinateur) et le menu en tiroir (mobile) montent chacun un sélecteur : on prend celui qui est visible.
  const picker = page.getByLabel(/devise d'affichage/i).filter({ visible: true }).first();
  await expect(async () => {
    await picker.selectOption(code);
    await expect(picker).toHaveValue(code, { timeout: 3_000 });
  }).toPass({ timeout: 120_000 });
}

// Serveur de développement : la première visite d'une page la compile.
test.describe.configure({ mode: "serial", timeout: 600_000 });
test.use({ actionTimeout: 150_000, navigationTimeout: 150_000 });

test.describe("Lot 2 : devises", () => {
  let storeId = "";
  let productSlug = "";
  let collectionSlug = "";
  let orderId = "";

  test.beforeAll(async () => {
    const store = await db.store.findUnique({ where: { slug: SLUG }, select: { id: true, currency: true, country: true } });
    if (!store) throw new Error("Boutique de démo dantokpa-mode absente : lancez pnpm db:seed");
    expect(store.currency).toBe("XOF");
    storeId = store.id;
    const category = await db.category.findFirstOrThrow({ where: { storeId, published: true }, orderBy: { position: "asc" }, select: { id: true, slug: true } });
    collectionSlug = category.slug;
    productSlug = `e2e-devise-parure-${Date.now().toString(36)}`;
    // Produit de test créé en base : la création de produit est couverte par les suites 03 et 09, ici elle
    // n'est qu'un prérequis. Prix rond (10 000) pour une conversion lisible.
    await db.product.create({ data: { storeId, categoryId: category.id, name: PRODUCT, slug: productSlug, price: PRICE, status: "ACTIVE", description: "Produit de recette automatisée (devises)." } });
    await db.storeCurrency.deleteMany({ where: { storeId, currency: "EUR" } });
    await clearRateLimits();
  });

  test.afterAll(async () => {
    await db.order.deleteMany({ where: { customerName: { startsWith: "E2E " } } });
    await db.customer.deleteMany({ where: { name: { startsWith: "E2E " } } });
    if (storeId) {
      await db.storeCurrency.deleteMany({ where: { storeId, currency: "EUR" } });
      await db.product.deleteMany({ where: { storeId, name: PRODUCT } });
    }
  });

  test("le commerçant active l'euro : parité fixe, statut « Affichée » et exemple de conversion", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/devises`);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: "Devises", exact: true })).toBeVisible();

    await page.getByLabel(/ajouter une devise/i).selectOption("EUR");
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect.poll(async () => db.storeCurrency.count({ where: { storeId, currency: "EUR", enabled: true } }), { timeout: 120_000 }).toBe(1);

    // `hasText` est insensible à la casse : on part de la région des devises pour ne pas attraper la barre latérale.
    const row = page.getByRole("region", { name: /Devises affichées/ }).getByRole("listitem").filter({ hasText: "EUR ·" }).first();
    await expect(row.getByText("Affichée", { exact: true })).toBeVisible();
    await expect(row.getByText(/1 EUR = 655,957 FCFA \(parité fixe BCEAO\)/)).toBeVisible();
    await expect(row.getByText(/10\s?000\s?FCFA ≈ 15,24\s?€/)).toBeVisible();
    await expectNoAppError(page);
  });

  test("la vitrine affiche les prix en euros : accueil, collection, fiche, recherche et panier", async ({ page }) => {
    await logout(page);

    // Accueil : le sélecteur apparaît dès qu'il y a deux devises. Un navigateur en fr-FR est servi en euros par
    // défaut (`src/lib/currency/pick.ts` : cookie → pays → langue) : on revient d'abord en FCFA, puis on bascule.
    await page.goto(`/s/${SLUG}`);
    await expectNoAppError(page);
    const homeCard = page.getByRole("article").filter({ hasText: PRODUCT }).first();
    await pickCurrency(page, "XOF");
    await expect(homeCard).toContainText(/10\s?000\s?FCFA/);
    await pickCurrency(page, "EUR");
    await expect(homeCard).toContainText(PRICE_EUR);
    // Mention obligatoire : l'encaissement a lieu en FCFA.
    await expect(page.getByText(/vous serez débité en FCFA/i).first()).toBeVisible();

    // Collection (catégorie publiée de la boutique).
    await page.goto(`/s/${SLUG}/collections/${collectionSlug}`);
    await expectNoAppError(page);
    await expect(page.getByRole("article").filter({ hasText: PRODUCT }).first()).toContainText(PRICE_EUR);

    // Fiche produit : prix en euros, données structurées en FCFA.
    await page.goto(`/s/${SLUG}/p/${productSlug}`);
    await expectNoAppError(page);
    await expect(page.getByText(PRICE_EUR).first()).toBeVisible();
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(jsonLd).toContain('"priceCurrency":"XOF"');
    expect(jsonLd).toContain(`"price":${PRICE}`);
    expect(jsonLd).not.toContain("EUR");

    // Recherche.
    await page.goto(`/s/${SLUG}/recherche?q=${encodeURIComponent("E2E Devise")}`);
    await expectNoAppError(page);
    await expect(page.getByRole("article").filter({ hasText: PRODUCT }).first()).toContainText(PRICE_EUR);

    // Panier : ajout depuis la fiche puis page panier.
    await page.goto(`/s/${SLUG}/p/${productSlug}`);
    await page.getByRole("button", { name: /ajouter au panier/i }).first().click();
    await page.goto(`/s/${SLUG}/panier`);
    await expectNoAppError(page);
    await expect(page.getByText(PRICE_EUR).first()).toBeVisible();
    await expect(page.getByText(/vous serez débité en FCFA/i).first()).toBeVisible();
  });

  test("commande en affichage euro : calculée en FCFA, instantané de devise sur la commande", async ({ page }) => {
    await page.goto(`/s/${SLUG}/p/${productSlug}`);
    await page.getByRole("button", { name: /ajouter au panier/i }).first().click();
    await page.goto(`/s/${SLUG}/commander`);
    await expectNoAppError(page);
    await pickCurrency(page, "EUR");

    await page.getByLabel(/nom complet/i).fill(BUYER);
    await page.getByLabel(/numéro whatsapp/i).fill("0196000041");
    await page.locator('input[name="fulfillmentType"][value="DELIVERY"]').first().check({ force: true });
    const zone = await db.deliveryZone.findFirstOrThrow({ where: { storeId }, orderBy: { position: "asc" }, select: { id: true, fee: true } });
    await page.locator(`input[name="deliveryZoneId"][value="${zone.id}"]`).first().check({ force: true });
    await page.getByLabel(/adresse ou repère/i).fill("Dantokpa, allée des tissus");
    await page.getByRole("radio", { name: /MTN MoMo/i }).first().check();

    // L'aperçu serveur (panier identifié) fournit l'instantané de conversion et la mention d'encaissement.
    // Le récapitulatif est monté deux fois (colonne mobile et colonne de droite) : on vise celui qui est visible.
    await expect(page.getByText(/Vous serez débité de .*FCFA \(≈ .*€\)/).filter({ visible: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /commander ·/i }).click();
    await page.waitForURL(/\/merci\//, { timeout: 150_000 });

    const token = new URL(page.url()).pathname.split("/").pop()!;
    const order = await db.order.findUniqueOrThrow({
      where: { trackingToken: token },
      select: { id: true, currency: true, subtotal: true, discount: true, taxTotal: true, total: true, presentmentCurrency: true, presentmentTotal: true, presentmentRate: true, deliveryFee: true, paymentAttempts: { select: { currency: true, amount: true } } },
    });
    orderId = order.id;
    expect(order.currency).toBe("XOF");
    // La collection « Femme » porte une remise automatique −15 % (seed) appliquée à l'encaissement (pas à l'affichage).
    // On vérifie donc l'invariant de total et le forfait de zone (aucun tarif d'expédition configuré → `zone.fee`),
    // plutôt qu'un total codé en dur qui ignorerait la remise.
    expect(order.subtotal).toBe(PRICE);
    expect(order.deliveryFee).toBe(zone.fee);
    expect(order.total).toBe(order.subtotal - order.discount + order.taxTotal + order.deliveryFee);
    expect(order.presentmentCurrency).toBe("EUR");
    expect(order.presentmentTotal).toBeGreaterThan(0);
    expect(Number(order.presentmentRate)).toBeGreaterThan(0);
    // Instantané cohérent : total affiché = total FCFA converti à la parité fixe (± 1 centime d'arrondi).
    expect(Math.abs(order.presentmentTotal! - Math.round((order.total * 100) / 655.957))).toBeLessThanOrEqual(1);
    // Encaissement toujours en devise boutique.
    for (const attempt of order.paymentAttempts) expect(attempt.currency).toBe("XOF");
    expect(orderId).toBeTruthy();
  });
});

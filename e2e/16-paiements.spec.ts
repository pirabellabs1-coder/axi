import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { db, clearRateLimits } from "./db";
import { DEMO, expectNoAppError, logout } from "./helpers";

/**
 * Lot 1 bis · paiements par agrégateur (docs/vague2/P1-paiements.md, RECETTE §4 quinquies) sur la boutique de
 * démo Chez Aïcha (Côte d'Ivoire, XOF, essai Business — seul pays couvert par Paystack dans le seed) :
 *  1. « Tester la connexion » avec une fausse clé de test : refus propre, aucun moyen enregistré ;
 *  2. le moyen enregistré expose ses portefeuilles (Wave, Orange Money) au checkout ;
 *  3. le paiement à la livraison n'est pas proposé pour un panier contenant une carte cadeau, ni pour un panier
 *     contenant un produit numérique.
 *
 * Limite assumée : aucun paiement réel n'est joué (il faudrait un compte Paystack de test et une URL publique).
 * Tout ce qui précède l'appel externe est couvert ; les scénarios R1 à R7 de `docs/vague2/P1-paiements.md` restent
 * manuels. Le test de connexion appelle réellement Paystack : avec une clé invalide **ou** sans accès réseau, le
 * résultat attendu est le même — un message d'échec et aucun enregistrement.
 *
 * Nettoyage : moyen de paiement et produits « E2E … » supprimés à la fin.
 */

const SLUG = "chez-aicha";
const GATEWAY_LABEL = "E2E Wave et Orange Money";
const GIFT = "E2E Carte cadeau recette";
const DIGITAL = "E2E Guide numérique";

async function loginMerchant(page: Page, next: string) {
  await clearRateLimits();
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/adresse e-mail/i).fill(DEMO.email);
  await page.getByLabel(/^mot de passe/i).fill(DEMO.password);
  await page.getByRole("button", { name: /se connecter/i }).click({ noWaitAfter: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 300_000 });
}

async function addToCart(page: Page, slug: string, opts: { giftCard?: boolean } = {}) {
  await page.goto(`/s/${SLUG}/p/${slug}`);
  await expectNoAppError(page);
  // Le bouton n'agit qu'une fois la fiche hydratée : on réessaie jusqu'à ce que l'en-tête ne soit plus « Panier vide ».
  await expect(async () => {
    if (opts.giftCard) {
      // Une carte cadeau exige un destinataire avant l'ajout au panier.
      await page.getByLabel(/nom du destinataire/i).fill("E2E Destinataire");
      await page.getByLabel(/whatsApp du destinataire/i).fill("0701020304");
    }
    await page.getByRole("button", { name: /ajouter au panier|offrir cette carte|précommander/i }).first().click();
    await expect(page.getByRole("button", { name: /panier vide/i })).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 150_000 });
}

/** Libellés des moyens de paiement proposés au checkout (section « Paiement » uniquement). */
async function paymentLabels(page: Page): Promise<string[]> {
  return page.locator('input[name="paymentMethodId"]').evaluateAll((els) => els.map((el) => (el.closest("label") as HTMLElement | null)?.innerText?.trim() ?? ""));
}

/** Ouvre le formulaire « Nouveau moyen de paiement » et choisit l'agrégateur Paystack avec ses portefeuilles. */
async function openGatewayForm(page: Page) {
  const dialog = page.getByRole("dialog", { name: /nouveau moyen de paiement/i });
  await expect(async () => {
    await page.getByRole("button", { name: /ajouter un moyen/i }).first().click();
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 120_000 });
  await dialog.locator('select[name="kind"]').selectOption("GATEWAY");
  await dialog.locator('select[name="provider"]').selectOption("paystack");
  return dialog;
}

// Serveur de développement : la première visite d'une page la compile.
test.describe.configure({ mode: "serial", timeout: 600_000 });
test.use({ actionTimeout: 180_000, navigationTimeout: 300_000 });

test.describe("Lot 1 bis : paiements Wave et Orange Money", () => {
  let storeId = "";
  let giftSlug = "";
  let digitalSlug = "";

  test.beforeAll(async () => {
    const store = await db.store.findUnique({ where: { slug: SLUG }, select: { id: true, country: true, currency: true } });
    if (!store) throw new Error(`Boutique de démo ${SLUG} absente : lancez pnpm db:seed`);
    storeId = store.id;
    expect(store.country).toBe("CI");
    giftSlug = `e2e-carte-cadeau-${Date.now().toString(36)}`;
    digitalSlug = `e2e-guide-numerique-${Date.now().toString(36)}`;
    await db.paymentMethod.deleteMany({ where: { storeId, label: { startsWith: "E2E " } } });
    await db.product.deleteMany({ where: { storeId, name: { in: [GIFT, DIGITAL] } } });
    // Prérequis du scénario (création de produits couverte par les suites 03 et 09).
    await db.product.create({ data: { storeId, name: GIFT, slug: giftSlug, price: 10_000, status: "ACTIVE", kind: "GIFT_CARD", isGiftCard: true, taxCategory: "exempt", description: "Carte cadeau de recette automatisée." } });
    await db.product.create({ data: { storeId, name: DIGITAL, slug: digitalSlug, price: 5_000, status: "ACTIVE", kind: "DIGITAL", description: "Produit numérique de recette automatisée." } });
    await clearRateLimits();
  });

  test.afterAll(async () => {
    if (!storeId) return;
    await db.order.deleteMany({ where: { storeId, customerName: { startsWith: "E2E " } } });
    await db.customer.deleteMany({ where: { storeId, name: { startsWith: "E2E " } } });
    await db.paymentMethod.deleteMany({ where: { storeId, label: { startsWith: "E2E " } } });
    await db.product.deleteMany({ where: { storeId, name: { in: [GIFT, DIGITAL] } } });
  });

  test("clé Paystack invalide : « Tester la connexion » échoue proprement, rien n'est enregistré", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/paiements`);
    await expectNoAppError(page);
    const dialog = await openGatewayForm(page);

    // Les portefeuilles du pays sont proposés (Côte d'Ivoire : Wave, Orange Money, MTN MoMo, carte).
    await expect(dialog.getByRole("checkbox", { name: "Wave", exact: true })).toBeVisible();
    await dialog.getByRole("checkbox", { name: "Wave", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "Orange Money", exact: true }).check();

    const before = await db.paymentMethod.count({ where: { storeId } });
    const key = dialog.locator('input[name^="cred_"]').first();
    await key.fill("sk_test_cle_invalide_e2e");
    await dialog.getByRole("button", { name: /tester la connexion/i }).click();
    // Appel réel au fournisseur (et compilation de l'action côté serveur de développement) : attente large.
    await expect(dialog.getByText(/échec du test de connexion/i)).toBeVisible({ timeout: 300_000 });
    // Un test de connexion n'enregistre jamais rien.
    expect(await db.paymentMethod.count({ where: { storeId } })).toBe(before);
  });

  test("moyen enregistré : les portefeuilles sont affichés au checkout", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/paiements`);
    const dialog = await openGatewayForm(page);
    await dialog.getByRole("checkbox", { name: "Wave", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "Orange Money", exact: true }).check();
    const label = dialog.locator('input[name="label"]');
    await expect(async () => {
      await label.fill(GATEWAY_LABEL);
      await expect(label).toHaveValue(GATEWAY_LABEL, { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await dialog.locator('input[name^="cred_"]').first().fill("sk_test_cle_invalide_e2e");
    await dialog.getByRole("button", { name: /^ajouter$/i }).click();
    // Serveur de développement : la première exécution d'une action serveur la compile (plusieurs minutes).
    await expect.poll(async () => db.paymentMethod.count({ where: { storeId, label: GATEWAY_LABEL } }), { timeout: 300_000, intervals: [1_000, 2_000, 5_000] }).toBe(1);
    const method = await db.paymentMethod.findFirstOrThrow({ where: { storeId, label: GATEWAY_LABEL }, select: { kind: true, channels: true, provider: true, credentialsEncrypted: true } });
    expect(method.kind).toBe("GATEWAY");
    expect(method.provider).toBe("paystack");
    expect(method.channels).toEqual(expect.arrayContaining(["wave", "orange_money"]));
    // Le secret n'est jamais stocké en clair.
    expect(method.credentialsEncrypted ?? "").not.toContain("sk_test_cle_invalide_e2e");

    await logout(page);
    const product = await db.product.findFirstOrThrow({ where: { storeId, isGiftCard: false, status: "ACTIVE", kind: "PHYSICAL", variants: { none: {} }, optionGroups: { none: {} } }, select: { slug: true } });
    await addToCart(page, product.slug);
    await page.goto(`/s/${SLUG}/commander`);
    await expectNoAppError(page);
    await page.getByRole("radio", { name: new RegExp(GATEWAY_LABEL) }).first().check();
    const wallets = page.getByRole("list", { name: /portefeuilles acceptés/i }).filter({ visible: true }).first();
    await expect(wallets).toContainText("Wave");
    await expect(wallets).toContainText("Orange Money");
  });

  test("carte cadeau au panier : pas de paiement à la livraison", async ({ page }) => {
    await logout(page);
    await addToCart(page, giftSlug, { giftCard: true });
    await page.goto(`/s/${SLUG}/commander`);
    await expectNoAppError(page);
    await expect(page.getByRole("radio", { name: new RegExp(GATEWAY_LABEL) }).first()).toBeVisible();
    expect(await paymentLabels(page)).not.toEqual(expect.arrayContaining([expect.stringMatching(/à la livraison/i)]));
  });

  test("produit numérique au panier : le paiement à la livraison n'est pas proposé, avec un message", async ({ page }) => {
    await logout(page);
    await addToCart(page, digitalSlug);
    await page.goto(`/s/${SLUG}/commander`);
    await expectNoAppError(page);
    await expect(page.getByRole("radio", { name: new RegExp(GATEWAY_LABEL) }).first()).toBeVisible();
    // L'option est retirée de la liste des moyens, et l'acheteur sait pourquoi.
    expect(await paymentLabels(page)).not.toEqual(expect.arrayContaining([expect.stringMatching(/à la livraison/i)]));
    await expect(page.getByText(/paiement à la livraison n'est pas proposé pour une commande contenant un produit numérique/i).filter({ visible: true }).first()).toBeVisible();
  });

});

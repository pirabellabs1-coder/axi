import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { db, clearRateLimits } from "./db";
import { expectNoAppError, logout } from "./helpers";

/**
 * Lot 2 · taxes et factures (docs/vague2/T-taxes-factures.md, RECETTE §4 sexies) sur la boutique de démo
 * Atelier Beauté Nafi (Sénégal, FCFA, plan Scale — boutique volontairement distincte de celles des suites
 * 01 à 09 pour ne pas perturber leurs montants) :
 *  1. le commerçant ajoute la TVA 18 %, l'active en TTC et enregistre son identité fiscale ;
 *  2. un acheteur commande : « dont TVA (18 %) » au checkout, facture au nom d'une entreprise ;
 *  3. le paiement confirmé déclenche l'émission automatique de la facture (numéro `F-AAAA-000001`, stable
 *     au rechargement) qui porte « dont TVA », la raison sociale et le numéro fiscal ;
 *  4. l'acheteur consulte le même document par son jeton de suivi ; un jeton inconnu donne « Facture introuvable » ;
 *  5. un remboursement partiel émet un avoir numéroté `A-AAAA-000001` dont la TVA est au prorata ;
 *  6. le régime TPS ne collecte rien : « TVA non applicable » au checkout et commande sans TVA.
 *
 * Les réglages fiscaux de la boutique sont remis dans leur état initial à la fin ; produits, commandes et taux
 * créés sont supprimés. Les compteurs de numérotation (`invoiceCounter`, `creditNoteCounter`) ne sont pas remis
 * à zéro : la numérotation fiscale doit rester continue.
 */

const SLUG = "atelier-beaute-nafi";
const OWNER = { email: "nafi@atelier-beaute-nafi.demo", password: "Demo-Axi-2026!" };
const PRODUCT = "E2E Taxe Savon noir";
const PRICE = 10_000;
const COMPANY = "E2E Entreprise SARL";

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const file = path.join(process.cwd(), ".env");
  if (existsSync(file)) {
    const m = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    if (m) return String(m[1]).trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} manquant pour la recette des taxes et factures`);
}

async function loginOwner(page: Page, next: string) {
  await clearRateLimits();
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/adresse e-mail/i).fill(OWNER.email);
  await page.getByLabel(/^mot de passe/i).fill(OWNER.password);
  await page.getByRole("button", { name: /se connecter/i }).click({ noWaitAfter: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 240_000 });
}

async function runJobs(page: Page) {
  const res = await page.request.post("/api/jobs/run", { headers: { "x-jobs-key": env("JOBS_RUN_KEY") } });
  expect(res.ok()).toBeTruthy();
}

/**
 * Ajoute une unité du produit de test au panier. Le bouton n'agit qu'une fois la page hydratée (serveur de
 * développement) : on réessaie jusqu'à ce que l'en-tête ne montre plus un panier vide.
 */
async function addToCart(page: Page) {
  await page.goto(`/s/${SLUG}/p/${productSlug}`);
  await expectNoAppError(page);
  await expect(async () => {
    await page.getByRole("button", { name: /ajouter au panier/i }).first().click();
    await expect(page.getByRole("button", { name: /panier vide/i })).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 150_000 });
}

/** Commande d'une unité du produit de test, payée en Wave manuel, avec livraison sur la première zone. */
async function placeOrder(page: Page, opts: { buyer: string; phone: string; company?: string }): Promise<{ token: string; fee: number }> {
  await logout(page);
  await addToCart(page);
  await page.goto(`/s/${SLUG}/commander`);
  await expectNoAppError(page);
  await page.getByLabel(/nom complet/i).fill(opts.buyer);
  await page.getByLabel(/numéro whatsapp/i).fill(opts.phone);
  await page.locator('input[name="fulfillmentType"][value="DELIVERY"]').first().check({ force: true });
  const zone = await db.deliveryZone.findFirstOrThrow({ where: { storeId }, orderBy: { position: "asc" }, select: { id: true, fee: true } });
  await page.locator(`input[name="deliveryZoneId"][value="${zone.id}"]`).first().check({ force: true });
  await page.getByLabel(/adresse ou repère/i).fill("Sacré-Coeur 3, villa 9120");
  await page.getByRole("radio", { name: /Wave/i }).first().check();
  if (opts.company) {
    await page.getByRole("checkbox", { name: /facture au nom d'une entreprise/i }).check();
    await page.getByRole("textbox", { name: /raison sociale/i }).fill(opts.company);
    await page.getByRole("textbox", { name: /numéro fiscal/i }).fill("IFU-E2E-0001");
  }
  return { token: await submitCheckout(page), fee: zone.fee };
}

async function submitCheckout(page: Page): Promise<string> {
  await page.getByRole("button", { name: /commander ·/i }).click();
  await page.waitForURL(/\/merci\//, { timeout: 150_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

let storeId = "";
let productSlug = "";

// Serveur de développement : la première visite d'une page la compile.
test.describe.configure({ mode: "serial", timeout: 600_000 });
test.use({ actionTimeout: 150_000, navigationTimeout: 150_000 });

test.describe("Lot 2 : taxes et factures", () => {
  let initial: { taxesEnabled: boolean; pricesIncludeTax: boolean; taxRegistration: unknown } | null = null;
  let orderId = "";
  let orderToken = "";
  let orderTotal = 0;
  let invoiceNumber = "";

  test.beforeAll(async () => {
    const store = await db.store.findUnique({ where: { slug: SLUG }, select: { id: true, country: true, taxesEnabled: true, pricesIncludeTax: true, taxRegistration: true } });
    if (!store) throw new Error(`Boutique de démo ${SLUG} absente : lancez pnpm db:seed`);
    storeId = store.id;
    expect(store.country).toBe("SN");
    initial = { taxesEnabled: store.taxesEnabled, pricesIncludeTax: store.pricesIncludeTax, taxRegistration: store.taxRegistration };
    productSlug = `e2e-taxe-savon-${Date.now().toString(36)}`;
    await db.product.create({ data: { storeId, name: PRODUCT, slug: productSlug, price: PRICE, status: "ACTIVE", description: "Produit de recette automatisée (taxes)." } });
    await db.taxRate.deleteMany({ where: { storeId } });
    await clearRateLimits();
  });

  test.afterAll(async () => {
    await db.order.deleteMany({ where: { storeId, customerName: { startsWith: "E2E " } } });
    await db.customer.deleteMany({ where: { storeId, name: { startsWith: "E2E " } } });
    if (storeId) {
      await db.product.deleteMany({ where: { storeId, name: PRODUCT } });
      await db.taxRate.deleteMany({ where: { storeId } });
      if (initial) await db.store.update({ where: { id: storeId }, data: { taxesEnabled: initial.taxesEnabled, pricesIncludeTax: initial.pricesIncludeTax, taxRegistration: initial.taxRegistration as never } });
    }
  });

  test("le commerçant active la TVA 18 % en TTC avec son identité fiscale", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/parametres/taxes`);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: "Taxes et factures" })).toBeVisible();

    await page.getByRole("button", { name: /ajouter TVA 18/i }).click();
    await expect.poll(async () => db.taxRate.count({ where: { storeId, rateBps: 1800, taxCategory: "standard" } }), { timeout: 120_000 }).toBe(1);

    // L'interrupteur du kit UI est une case `sr-only` sous une pastille décorative : on cible le rôle `switch`.
    await page.getByRole("switch", { name: /collecter la TVA sur mes ventes/i }).check({ force: true });
    await page.locator('input[name="pricesIncludeTax"][value="true"]').check();
    await page.getByLabel(/raison sociale/i).fill("Atelier Beauté Nafi SARL");
    await page.getByLabel(/numéro fiscal \(IFU, NIF/i).fill("SN-IFU-E2E-77");
    await page.getByLabel(/^RCCM/i).fill("SN-DKR-2026-E2E");
    // Émission automatique au paiement : proposée cochée à la première configuration.
    await expect(page.getByLabel(/émettre la facture automatiquement au paiement/i)).toBeChecked();
    await page.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect.poll(async () => (await db.store.findUniqueOrThrow({ where: { id: storeId } })).taxesEnabled, { timeout: 120_000 }).toBe(true);

    const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { pricesIncludeTax: true, taxRegistration: true } });
    expect(store.pricesIncludeTax).toBe(true);
    expect(store.taxRegistration).toMatchObject({ taxId: "SN-IFU-E2E-77", regime: "TVA", autoIssueInvoices: true });

    // Exemple chiffré de l'écran : 10 000 + 1 000 en TTC → « dont TVA (18 %) » 1 678.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Exemple" })).toBeVisible();
    await expect(page.getByRole("term").filter({ hasText: /dont TVA \(18 %\)/ })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /1\s?678\s?FCFA/ })).toBeVisible();
  });

  test("checkout : « dont TVA (18 %) » et facture au nom d'une entreprise", async ({ page }) => {
    const placed = await placeOrder(page, { buyer: "E2E Taxe Acheteuse", phone: "771100220", company: COMPANY });
    orderToken = placed.token;

    const order = await db.order.findUniqueOrThrow({
      where: { trackingToken: orderToken },
      select: { id: true, total: true, taxTotal: true, taxesIncluded: true, taxLines: true, buyerCompany: true, buyerTaxId: true, deliveryFee: true, items: { select: { taxAmount: true, taxRateBps: true } } },
    });
    orderId = order.id;
    orderTotal = order.total;
    // TTC : le total payé reste prix + livraison, la TVA est contenue dedans.
    expect(order.total).toBe(PRICE + placed.fee);
    expect(order.taxesIncluded).toBe(true);
    expect(order.taxTotal).toBeGreaterThan(0);
    const lines = order.taxLines as { name: string; rateBps: number; amount: number }[];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(order.taxTotal);
    expect(lines[0].rateBps).toBe(1800);
    expect(order.items[0].taxRateBps).toBe(1800);
    expect(order.items[0].taxAmount).toBeGreaterThan(0);
    expect(order.buyerCompany).toBe(COMPANY);
    expect(order.buyerTaxId).toBe("IFU-E2E-0001");

    // La mention « dont TVA » doit être lisible par l'acheteur avant de valider : on la relit sur un nouveau panier.
    await addToCart(page);
    await page.goto(`/s/${SLUG}/commander`);
    await page.getByLabel(/nom complet/i).fill("E2E Taxe Lecture");
    await page.getByLabel(/numéro whatsapp/i).fill("771100221");
    await expect(page.getByText(/dont TVA \(18 %\)/).filter({ visible: true }).first()).toBeVisible();
  });

  test("paiement confirmé : facture émise automatiquement, numérotée et stable", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/commandes/${orderId}`);
    await expect(async () => {
      await page.getByRole("button", { name: /confirmer le paiement/i }).filter({ visible: true }).first().click();
      await expect(page.getByRole("button", { name: /oui, paiement reçu/i }).filter({ visible: true })).toHaveCount(1, { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByRole("button", { name: /oui, paiement reçu/i }).filter({ visible: true }).first().click();
    await expect.poll(async () => (await db.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus, { timeout: 60_000 }).toBe("PAID");

    // Émission automatique par le job `payment.succeeded`.
    await expect
      .poll(
        async () => {
          await runJobs(page);
          return db.orderInvoice.count({ where: { orderId, kind: "INVOICE" } });
        },
        { timeout: 120_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(1);
    const invoice = await db.orderInvoice.findFirstOrThrow({ where: { orderId, kind: "INVOICE" } });
    invoiceNumber = invoice.number;
    expect(invoiceNumber).toMatch(/^F-\d{4}-\d{6}$/);
    expect(invoice.taxTotal).toBeGreaterThan(0);
    expect(invoice.amount).toBe(orderTotal);

    await page.goto(`/app/${storeId}/commandes/${orderId}/facture`);
    await expectNoAppError(page);
    const doc = page.getByRole("article", { name: `Facture ${invoiceNumber}` });
    await expect(doc).toBeVisible();
    await expect(doc.getByText(/dont TVA 18\s?%/)).toBeVisible();
    await expect(doc.getByText("Atelier Beauté Nafi SARL")).toBeVisible();
    await expect(doc.getByText(/SN-IFU-E2E-77/)).toBeVisible();
    await expect(doc.getByText(COMPANY)).toBeVisible();
    // Document immuable : aucun bouton d'émission, et le numéro ne change pas au rechargement.
    await expect(page.getByRole("button", { name: /émettre la facture/i })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: `Facture ${invoiceNumber}` })).toBeVisible();
    expect(await db.orderInvoice.count({ where: { orderId, kind: "INVOICE" } })).toBe(1);
  });

  test("l'acheteur consulte sa facture par son jeton de suivi", async ({ page }) => {
    await logout(page);
    await page.goto(`/suivi/${orderToken}/facture`);
    await expectNoAppError(page);
    await expect(page.getByRole("article", { name: `Facture ${invoiceNumber}` })).toBeVisible();
    await expect(page.getByText(/dont TVA 18\s?%/).first()).toBeVisible();

    // Jeton inconnu : aucun document, aucun indice.
    await page.goto(`/suivi/${"z".repeat(32)}/facture`);
    await expect(page.getByText(/facture introuvable/i)).toBeVisible();
  });

  test("remboursement partiel : avoir numéroté avec la TVA au prorata", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/commandes/${orderId}`);
    await expectNoAppError(page);
    await page.getByRole("button", { name: /enregistrer un remboursement/i }).filter({ visible: true }).first().click();
    const amount = 5_000;
    await page.getByLabel(/^montant \(/i).fill(String(amount));
    await page.getByRole("textbox", { name: /motif \(optionnel\)/i }).fill("E2E avoir partiel");
    await page.getByRole("dialog").getByRole("button", { name: /^enregistrer$/i }).click();

    await expect.poll(async () => db.orderInvoice.count({ where: { orderId, kind: "CREDIT_NOTE" } }), { timeout: 120_000 }).toBe(1);
    const credit = await db.orderInvoice.findFirstOrThrow({ where: { orderId, kind: "CREDIT_NOTE" } });
    expect(credit.number).toMatch(/^A-\d{4}-\d{6}$/);
    expect(credit.amount).toBe(amount);
    const invoice = await db.orderInvoice.findFirstOrThrow({ where: { orderId, kind: "INVOICE" } });
    // Avoir partiel : TVA strictement positive et au plus celle de la facture (prorata).
    expect(credit.taxTotal).toBeGreaterThan(0);
    expect(credit.taxTotal).toBeLessThanOrEqual(invoice.taxTotal);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe("PARTIALLY_REFUNDED");

    await page.goto(`/app/${storeId}/commandes/${orderId}/facture`);
    await expect(page.getByRole("article", { name: `Avoir ${credit.number}` })).toBeVisible();
    // Aucun remboursement sans avoir.
    await expect(page.getByText(/remboursement sans avoir/i)).toHaveCount(0);
  });

  test("régime TPS : aucune TVA collectée, mention « TVA non applicable »", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/parametres/taxes`);
    await expectNoAppError(page);
    await page.getByLabel(/régime fiscal/i).selectOption("TPS");
    await page.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect
      .poll(async () => (await db.store.findUniqueOrThrow({ where: { id: storeId } })).taxRegistration as { regime?: string } | null, { timeout: 120_000 })
      .toMatchObject({ regime: "TPS" });

    const placed = await placeOrder(page, { buyer: "E2E Taxe TPS", phone: "771100222" });
    const order = await db.order.findUniqueOrThrow({ where: { trackingToken: placed.token }, select: { taxTotal: true, total: true, taxLines: true } });
    expect(order.taxTotal).toBe(0);
    expect(order.total).toBe(PRICE + placed.fee);
    expect(order.taxLines ?? []).toEqual([]);

    // Mention visible au checkout d'un nouveau panier.
    await addToCart(page);
    await page.goto(`/s/${SLUG}/commander`);
    await page.getByLabel(/nom complet/i).fill("E2E Taxe TPS Lecture");
    await page.getByLabel(/numéro whatsapp/i).fill("771100223");
    await expect(page.getByText(/TVA non applicable/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/dont TVA/)).toHaveCount(0);
  });
});

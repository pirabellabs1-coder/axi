import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { db, E2E_DOMAIN, clearRateLimits } from "./db";
import { DEMO, expectNoAppError, login, logout } from "./helpers";

/**
 * Lot 1 (docs/specs/LOT-1-ventes-fidelite.md §9) sur la boutique de démo Dantokpa Mode (plan Business) :
 *  1. connexion acheteur par code (e-mail), historique, réachat ;
 *  2. retour acheteur → approbation, réception avec remise en stock, résolution en avoir ;
 *  3. checkout connecté : « 2 achetés = 1 offert », points, avoir et carte cadeau de démo, puis annulation et recrédit ;
 *  4. achat d'une carte cadeau (envoi numérique, pas de paiement à la livraison), paiement confirmé par le commerçant,
 *     utilisation partielle sur une seconde commande, annulation et recrédit ;
 *  5. plan Gratuit : remises automatiques en upsell.
 *
 * Données de test : client « E2E … » (e-mail @e2e.test) et produit « E2E Carte cadeau », supprimés à la fin.
 * Code de connexion : l'application n'en garde que le HMAC ; le test REMPLACE ce hachage en base par celui d'un code
 * connu, calculé ici avec APP_SECRET (même dérivation que src/lib/buyer/otp.ts). Aucune porte dérobée côté application.
 * Raccourcis de préparation assumés : commande passée en « livrée » par la base (pas de livreur en recette),
 * tâches de fond déclenchées par /api/jobs/run (clé JOBS_RUN_KEY).
 * Captures : docs/captures/lot1-*.png (375 et 1440 px).
 */

const SLUG = "dantokpa-mode";
const DEMO_CARD = "KD7M4XQ29PRTH3VW";
const KNOWN_CODE = "424242";
const CAPTURES = path.join(process.cwd(), "docs", "captures");

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const file = path.join(process.cwd(), ".env");
  if (existsSync(file)) {
    const m = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} manquant pour les tests du lot 1`);
}

/** Même dérivation que hashOtp (src/lib/buyer/otp.ts) : HMAC(HMAC(APP_SECRET, "buyer-otp"), storeId:destination:code). */
function otpHash(storeId: string, destination: string, code: string): string {
  const key = createHmac("sha256", env("APP_SECRET")).update("buyer-otp").digest();
  return createHmac("sha256", key).update(`${storeId}:${destination}:${code}`).digest("hex");
}

/** Déchiffre `GiftCard.codeEnc` (format `v1.iv.tag.enc`, AES-256-GCM, clé sha256(APP_SECRET)) : test uniquement. */
function decryptCode(enc: string): string {
  const [, iv, tag, data] = enc.split(".");
  const d = createDecipheriv("aes-256-gcm", createHash("sha256").update(env("APP_SECRET")).digest(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

async function shot(page: Page, name: string) {
  if (!existsSync(CAPTURES)) mkdirSync(CAPTURES, { recursive: true });
  // En haut de page : l'en-tête collant ne vient pas se superposer au milieu de la capture pleine page.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(CAPTURES, `lot1-${name}.png`), fullPage: true });
}

async function runJobs(page: Page) {
  const res = await page.request.post("/api/jobs/run", { headers: { "x-jobs-key": env("JOBS_RUN_KEY") } });
  expect(res.ok()).toBeTruthy();
}

async function loginBuyer(page: Page, storeId: string, email: string, next = `/s/${SLUG}/compte`) {
  await clearRateLimits();
  await page.goto(`/s/${SLUG}/compte/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/numéro de téléphone ou e-mail/i).fill(email);
  const requestedAt = new Date(Date.now() - 1_000);
  await page.getByRole("button", { name: /recevoir un code/i }).click();
  const code = page.getByLabel(/code reçu/i);
  await expect(code).toBeVisible();
  // Pour un e-mail, le code est émis après la réponse (after(), anti-énumération) : on attend le nouveau code.
  let otp: { id: string } | null = null;
  await expect.poll(async () => {
    otp = await db.customerOtp.findFirst({ where: { storeId, destination: email, createdAt: { gte: requestedAt }, usedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return otp?.id ?? null;
  }, { timeout: 30_000, message: "un code a été émis pour l'e-mail vérifié" }).not.toBeNull();
  await db.customerOtp.update({ where: { id: otp!.id }, data: { codeHash: otpHash(storeId, email, KNOWN_CODE) } });
  await code.fill(KNOWN_CODE);
  await page.getByRole("button", { name: /me connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/connexion"), { timeout: 90_000 });
}

async function addFromProduct(page: Page, productSlug: string, qty: number) {
  await page.goto(`/s/${SLUG}/p/${productSlug}`, { waitUntil: "networkidle" });
  await expectNoAppError(page);
  for (let i = 1; i < qty; i++) await page.getByRole("button", { name: "Augmenter la quantité" }).first().click();
  await page.getByRole("button", { name: /ajouter au panier/i }).first().click();
}

async function cancelAsMerchant(page: Page, storeId: string, orderId: string) {
  await page.goto(`/app/${storeId}/commandes/${orderId}`);
  await expect(async () => {
    await page.getByRole("button", { name: /annuler la commande/i }).filter({ visible: true }).first().click();
    await expect(page.getByPlaceholder(/client injoignable/i).filter({ visible: true })).toHaveCount(1, { timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  // Le panneau d'actions existe en double (mobile et ordinateur) : on vise la boîte de dialogue visible.
  await page.getByPlaceholder(/client injoignable/i).filter({ visible: true }).first().fill("Recette E2E lot 1");
  await page.getByRole("button", { name: /confirmer l.annulation/i }).filter({ visible: true }).first().click();
  await expect.poll(async () => (await db.order.findUnique({ where: { id: orderId }, select: { status: true } }))?.status, { timeout: 30_000 }).toBe("CANCELLED");
}

test.describe.configure({ mode: "serial" });

test.describe("Lot 1 : ventes et fidélité", () => {
  let storeId = "";
  let email = "";
  let customerId = "";
  let giftProductSlug = "";
  let demoCardBalance = 0;
  const stocks = new Map<string, number>();

  test.beforeAll(async () => {
    const store = await db.store.findUnique({ where: { slug: SLUG }, select: { id: true, accountsEnabled: true } });
    if (!store) throw new Error("Boutique de démo dantokpa-mode absente : lancez pnpm db:seed");
    storeId = store.id;
    if (!store.accountsEnabled) await db.store.update({ where: { id: storeId }, data: { accountsEnabled: true } });
    const suffix = Date.now().toString(36);
    email = `acheteur-${suffix}@${E2E_DOMAIN}`;
    const phone = `2290197${String(Date.now()).slice(-6)}`;
    const c = await db.customer.create({ data: { storeId, name: "E2E Akouavi Lot1", phone, phoneVerifiedAt: new Date(), email, emailVerifiedAt: new Date(), loyaltyPoints: 600 } });
    customerId = c.id;
    await db.loyaltyLedger.create({ data: { storeId, customerId, delta: 600, reason: "adjustment" } });
    giftProductSlug = `e2e-carte-cadeau-${suffix}`;
    await db.product.create({ data: { storeId, name: "E2E Carte cadeau", slug: giftProductSlug, price: 10_000, isGiftCard: true, trackStock: false, status: "ACTIVE", description: "Carte cadeau de recette." } });
    const card = await db.giftCard.findFirst({ where: { storeId, last4: DEMO_CARD.slice(-4) }, select: { balance: true, status: true } });
    if (!card || card.status !== "ACTIVE") throw new Error("Carte cadeau de démo absente ou inactive : lancez pnpm db:seed");
    demoCardBalance = card.balance;
    // Stock des articles utilisés : mémorisé (rétabli à la fin) et complété si une recette précédente l'a entamé.
    for (const [slug, min] of [["sac-a-main-cuir-et-wax", 4], ["collier-de-perles", 8]] as const) {
      const p = await db.product.findFirstOrThrow({ where: { storeId, slug }, select: { id: true, stock: true } });
      stocks.set(p.id, p.stock);
      if (p.stock < min) await db.product.update({ where: { id: p.id }, data: { stock: min } });
    }
  });

  test.afterAll(async () => {
    // Filet de sécurité : si un test a échoué avant l'annulation, la commande E2E sera supprimée par cleanupE2E
    // sans recrédit ; la carte de démo est alors remise à son solde initial (ajustement journalisé).
    const card = await db.giftCard.findFirst({ where: { storeId, last4: DEMO_CARD.slice(-4) } });
    if (card && demoCardBalance > 0 && card.balance !== demoCardBalance) {
      await db.$transaction([
        db.giftCard.update({ where: { id: card.id }, data: { balance: demoCardBalance } }),
        db.giftCardTransaction.create({ data: { storeId, giftCardId: card.id, kind: "ADJUST", amount: demoCardBalance - card.balance, balanceAfter: demoCardBalance, note: "Recette E2E lot 1 : solde de démonstration rétabli" } }),
      ]);
    }
    await db.product.deleteMany({ where: { storeId, slug: giftProductSlug } });
    // Cartes émises pour le test (commande E2E) : supprimées avec la commande par cleanupE2E ; les cartes elles-mêmes ici.
    await db.giftCard.deleteMany({ where: { storeId, recipientName: { startsWith: "E2E " } } });
    for (const [id, stock] of stocks) await db.product.update({ where: { id }, data: { stock } });
    await db.customerOtp.deleteMany({ where: { storeId, destination: { endsWith: `@${E2E_DOMAIN}` } } });
  });

  test("connexion acheteur par code, icône Compte, historique vide", async ({ page }) => {
    await page.goto(`/s/${SLUG}`);
    await expectNoAppError(page);
    await expect(page.getByRole("link", { name: /se connecter à mon compte/i }).first()).toBeVisible();
    await loginBuyer(page, storeId, email);
    await expect(page).toHaveURL(new RegExp(`/s/${SLUG}/compte`));
    await page.goto(`/s/${SLUG}`);
    await expect(page.getByRole("link", { name: /^mon compte$/i }).first()).toBeVisible();
  });

  test("retour : demande acheteur, approbation, réception avec remise en stock, avoir ; historique et réachat", async ({ page }) => {
    await loginBuyer(page, storeId, email, `/s/${SLUG}/commander`);
    await addFromProduct(page, "collier-de-perles", 1);
    await page.goto(`/s/${SLUG}/commander`);
    // Connecté : nom prérempli, téléphone vérifié verrouillé.
    await expect(page.getByLabel(/nom complet/i)).toHaveValue("E2E Akouavi Lot1");
    await expect(page.locator('input[name="phone"]')).toHaveAttribute("readonly", "");
    await page.getByRole("radio", { name: /MTN MoMo/i }).check();
    await page.getByRole("button", { name: /commander ·/i }).click();
    await page.waitForURL(/\/merci\//, { timeout: 90_000 });
    const token = new URL(page.url()).pathname.split("/").pop()!;
    const order = await db.order.findUniqueOrThrow({ where: { trackingToken: token }, select: { id: true, reference: true, customerId: true } });
    expect(order.customerId).toBe(customerId);
    const stockBefore = (await db.product.findFirstOrThrow({ where: { storeId, slug: "collier-de-perles" }, select: { stock: true } })).stock;
    // Préparation : commande livrée (pas de livreur en recette).
    await db.order.update({ where: { id: order.id }, data: { status: "DELIVERED", deliveredAt: new Date() } });

    // Historique et bouton « Retourner des articles »
    await page.goto(`/s/${SLUG}/compte/commandes`);
    await expect(page.getByText(order.reference).first()).toBeVisible();
    await page.goto(`/s/${SLUG}/compte/commandes/${order.reference}`);
    await page.getByRole("link", { name: /retourner des articles/i }).click();
    await page.waitForURL(/\/compte\/retours\?commande=/, { timeout: 90_000 });
    await page.getByLabel(/quantité à retourner pour collier de perles/i).selectOption("1");
    await page.locator("label", { hasText: /^Avoir$/ }).first().click();
    await page.getByRole("button", { name: /envoyer la demande/i }).click();
    await expect.poll(async () => db.returnRequest.count({ where: { storeId, orderId: order.id } }), { timeout: 30_000 }).toBe(1);
    const ret = await db.returnRequest.findFirstOrThrow({ where: { storeId, orderId: order.id }, select: { id: true, status: true } });
    expect(ret.status).toBe("REQUESTED");

    // Commerçant : approbation, réception (remise en stock), résolution en avoir.
    await logout(page);
    await login(page, DEMO.email, DEMO.password, `/app/${storeId}/retours/${ret.id}`);
    await page.goto(`/app/${storeId}/retours/${ret.id}`);
    await expect(async () => {
      await page.getByRole("button", { name: /approuver le retour/i }).click({ timeout: 5_000 });
      await expect.poll(async () => (await db.returnRequest.findUniqueOrThrow({ where: { id: ret.id } })).status, { timeout: 8_000 }).toBe("APPROVED");
    }).toPass({ timeout: 60_000 });
    await page.reload();
    await page.getByRole("button", { name: /enregistrer la réception/i }).click();
    await expect.poll(async () => (await db.returnRequest.findUniqueOrThrow({ where: { id: ret.id } })).status, { timeout: 30_000 }).toBe("RECEIVED");
    const stockAfter = (await db.product.findFirstOrThrow({ where: { storeId, slug: "collier-de-perles" }, select: { stock: true } })).stock;
    expect(stockAfter).toBe(stockBefore + 1);
    await page.reload();
    await page.locator("label", { hasText: /^Avoir$/ }).first().click();
    await page.getByRole("button", { name: /valider : avoir/i }).click();
    await expect.poll(async () => (await db.returnRequest.findUniqueOrThrow({ where: { id: ret.id } })).status, { timeout: 30_000 }).toBe("RESOLVED");
    const credit = (await db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { storeCreditBalance: true } })).storeCreditBalance;
    expect(credit).toBeGreaterThan(0);

    // Réachat depuis l'espace compte
    await logout(page);
    await loginBuyer(page, storeId, email, `/s/${SLUG}/compte/commandes/${order.reference}`);
    await page.getByRole("button", { name: /commander à nouveau/i }).click();
    await expect.poll(async () => page.evaluate((slug) => JSON.parse(localStorage.getItem(`axi:cart:${slug}`) ?? "[]").length, SLUG), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.evaluate((slug) => localStorage.removeItem(`axi:cart:${slug}`), SLUG);
  });

  test("checkout connecté : 2 achetés = 1 offert, points, avoir et carte cadeau ; annulation et recrédit", async ({ page }) => {
    await loginBuyer(page, storeId, email, `/s/${SLUG}`);
    await page.evaluate((slug) => localStorage.removeItem(`axi:cart:${slug}`), SLUG);
    // 2 sacs + 1 collier (collection Accessoires) : le moins cher est offert ; la carte ne couvre pas tout.
    await addFromProduct(page, "sac-a-main-cuir-et-wax", 2);
    await addFromProduct(page, "collier-de-perles", 1);
    // Fiche : bloc « Offres disponibles » (remise automatique de la collection Accessoires).
    await page.reload(); // tiroir du panier fermé pour la capture
    await expect(page.getByText("2 accessoires achetés = 1 offert").first()).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, "fiche-offres-1440");
    await page.setViewportSize({ width: 375, height: 812 });
    await shot(page, "fiche-offres-375");
    await page.goto(`/s/${SLUG}/commander`);
    await expectNoAppError(page);
    const recap = page.locator("aside").filter({ hasText: "Récapitulatif" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(recap.getByText("2 accessoires achetés = 1 offert")).toBeVisible();

    const creditBefore = (await db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { storeCreditBalance: true } })).storeCreditBalance;
    await page.getByText(/^Utiliser \d[\d\s ]* points/).click();
    await page.getByText(/^Utiliser mon avoir/).click();
    await page.getByRole("button", { name: /^carte cadeau/i }).click();
    await page.getByLabel(/code de la carte cadeau/i).fill(DEMO_CARD);
    await page.getByLabel(/code de la carte cadeau/i).locator("xpath=following-sibling::button[1]").click();
    await expect(recap.getByText(`Carte cadeau •••• ${DEMO_CARD.slice(-4)}`)).toBeVisible();
    await expect(recap.getByText("Reste à payer")).toBeVisible();
    await expect(recap.getByText(/^Avoir$/)).toBeVisible();
    await page.getByRole("radio", { name: /MTN MoMo/i }).check();
    await shot(page, "checkout-1440");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByText(/afficher le récapitulatif/i).click();
    await shot(page, "checkout-375");

    const submit = page.getByRole("button", { name: /commander ·/i });
    await expect(submit).toBeEnabled();
    await submit.click();
    await page.waitForURL(/\/merci\//, { timeout: 90_000 });
    await expectNoAppError(page);
    await shot(page, "merci-375");
    const token = new URL(page.url()).pathname.split("/").pop()!;
    const order = await db.order.findUniqueOrThrow({ where: { trackingToken: token }, include: { discounts: true } });
    expect(order.discounts.some((d) => d.source === "automatic" && d.label === "2 accessoires achetés = 1 offert" && d.amount === 4500)).toBeTruthy();
    expect(order.loyaltyPointsRedeemed).toBeGreaterThan(0);
    expect(order.storeCreditAmount).toBe(Math.min(creditBefore, order.storeCreditAmount));
    expect(order.storeCreditAmount).toBeGreaterThan(0);
    expect(order.giftCardAmount).toBeGreaterThan(0);
    expect(order.amountDue).toBe(order.total - order.giftCardAmount - order.storeCreditAmount);
    const cardAfter = await db.giftCard.findFirstOrThrow({ where: { storeId, last4: DEMO_CARD.slice(-4) } });
    expect(cardAfter.balance).toBe(demoCardBalance - order.giftCardAmount);

    // Annulation par le commerçant : carte de démo et avoir recrédités.
    await logout(page);
    await login(page, DEMO.email, DEMO.password, `/app/${storeId}/commandes/${order.id}`);
    await cancelAsMerchant(page, storeId, order.id);
    expect((await db.giftCard.findFirstOrThrow({ where: { storeId, last4: DEMO_CARD.slice(-4) } })).balance).toBe(demoCardBalance);
    expect((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).storeCreditBalance).toBe(creditBefore);
  });

  test("carte cadeau : envoi numérique, pas de paiement à la livraison, émission après paiement, utilisation partielle", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/s/${SLUG}/p/${giftProductSlug}`);
    await expectNoAppError(page);
    await page.getByLabel(/nom du destinataire/i).fill("E2E Codjo");
    await page.getByLabel(/whatsapp du destinataire/i).fill("0196000011");
    await page.getByLabel(/^message/i).fill("Bon anniversaire !");
    await shot(page, "fiche-carte-cadeau-375");
    await page.getByRole("button", { name: /offrir cette carte/i }).first().click();
    await page.goto(`/s/${SLUG}/commander`);
    await expect(page.getByText("Envoi numérique").first()).toBeVisible();
    await expect(page.getByRole("radio", { name: /paiement à la livraison/i })).toHaveCount(0);
    await page.getByLabel(/nom complet/i).fill("E2E Afi Cadeau");
    await page.getByLabel(/numéro whatsapp/i).fill("0196000012");
    await page.getByRole("radio", { name: /MTN MoMo/i }).check();
    await page.getByRole("button", { name: /commander ·/i }).click();
    await page.waitForURL(/\/merci\//, { timeout: 90_000 });
    await expect(page.getByText(/dès que le paiement est confirmé/i)).toBeVisible();
    const token = new URL(page.url()).pathname.split("/").pop()!;
    const order = await db.order.findUniqueOrThrow({ where: { trackingToken: token } });
    expect(order.fulfillmentType).toBe("DIGITAL");

    // Le commerçant confirme le paiement ; l'émission passe par la file de tâches.
    await login(page, DEMO.email, DEMO.password, `/app/${storeId}/commandes/${order.id}`);
    await page.goto(`/app/${storeId}/commandes/${order.id}`);
    await page.setViewportSize({ width: 1366, height: 860 });
    // Le bouton peut être cliqué avant l'hydratation : on recommence jusqu'à l'ouverture de la boîte de dialogue.
    await expect(async () => {
      await page.getByRole("button", { name: /confirmer le paiement/i }).filter({ visible: true }).first().click();
      await expect(page.getByRole("button", { name: /oui, paiement reçu/i }).filter({ visible: true })).toHaveCount(1, { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByRole("button", { name: /oui, paiement reçu/i }).filter({ visible: true }).first().click();
    await expect.poll(async () => (await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus, { timeout: 30_000 }).toBe("PAID");
    // Émission par la file de tâches (job giftcard.issue créé avec la confirmation du paiement).
    await expect
      .poll(
        async () => {
          await runJobs(page);
          return db.giftCard.count({ where: { storeId, sourceOrderId: order.id } });
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(1);
    const card = await db.giftCard.findFirstOrThrow({ where: { storeId, sourceOrderId: order.id } });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/s/${SLUG}/merci/${token}`);
    await expect(page.getByText(`•••• ${card.last4}`)).toBeVisible();
    await expect(page.getByRole("link", { name: /envoyer sur whatsapp/i })).toHaveAttribute("href", /wa\.me/);
    await shot(page, "merci-carte-cadeau-375");

    // Utilisation partielle sur une seconde commande (invité), puis annulation et recrédit.
    await logout(page);
    await addFromProduct(page, "collier-de-perles", 1);
    await page.goto(`/s/${SLUG}/commander`);
    await expect(page.getByRole("link", { name: /connectez-vous pour utiliser vos points ou votre avoir/i })).toBeVisible();
    await page.getByLabel(/nom complet/i).fill("E2E Afi Cadeau");
    await page.getByLabel(/numéro whatsapp/i).fill("0196000012");
    await page.getByRole("button", { name: /^carte cadeau/i }).click();
    await page.getByLabel(/code de la carte cadeau/i).fill(decryptCode(card.codeEnc));
    await page.getByLabel(/code de la carte cadeau/i).locator("xpath=following-sibling::button[1]").click();
    await expect(page.getByText(/rien à payer/i)).toBeVisible();
    await page.getByRole("button", { name: /commander ·/i }).click();
    await page.waitForURL(/\/merci\//, { timeout: 90_000 });
    const second = await db.order.findUniqueOrThrow({ where: { trackingToken: new URL(page.url()).pathname.split("/").pop()! } });
    expect(second.paymentStatus).toBe("PAID");
    expect((await db.giftCard.findUniqueOrThrow({ where: { id: card.id } })).balance).toBe(10_000 - second.giftCardAmount);
    await login(page, DEMO.email, DEMO.password, `/app/${storeId}/commandes/${second.id}`);
    await cancelAsMerchant(page, storeId, second.id);
    expect((await db.giftCard.findUniqueOrThrow({ where: { id: card.id } })).balance).toBe(10_000);
  });

  test("plan Gratuit : les remises automatiques sont présentées en upsell", async ({ page }) => {
    const free = await db.store.findUnique({ where: { slug: "cabinet-sante-plus" }, select: { id: true } });
    test.skip(!free, "boutique de démo du plan Gratuit absente");
    await login(page, "dr.adjovi@sante-plus.demo", DEMO.password, `/app/${free!.id}/promotions/automatiques`);
    await page.goto(`/app/${free!.id}/promotions/automatiques`);
    await expectNoAppError(page);
    await expect(page.getByText(/incluses à partir du plan Starter/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /abonnement|changer de plan|passer/i }).first()).toHaveAttribute("href", new RegExp(`/app/${free!.id}/abonnement`));
  });
});

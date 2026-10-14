import { test, expect } from "./fixtures";
import { db, uniqueEmail, verifyEmail, E2E_PASSWORD, clearRateLimits } from "./db";
import { expectNoAppError, storeIdFromUrl } from "./helpers";

/**
 * Parcours commerçant de A à Z, comme un vrai utilisateur :
 * inscription → vérification → assistant de création → coordonnées → produit → publication
 * → commande d'un client sur mobile → traitement complet dans l'espace marchand.
 */
test("du compte à la première commande livrée", async ({ page, browser }) => {
  const email = uniqueEmail("marchand");
  await clearRateLimits();

  // 1. Inscription
  await page.goto("/inscription");
  await page.getByLabel(/votre nom/i).fill("E2E Koffi Agbo");
  await page.getByLabel(/adresse e-mail/i).fill(email);
  await page.getByLabel(/^mot de passe/i).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /créer mon compte/i }).click();
  await page.waitForURL(/\/verification/);
  await expectNoAppError(page);

  // 2. Vérification (le code part dans la console du serveur : on valide en base)
  await verifyEmail(email);
  await page.goto("/app");
  await page.waitForURL(/\/app\/nouvelle-boutique/);

  // 3. Assistant de création
  const storeName = `E2E Maquis ${Date.now().toString(36)}`;
  await page.getByRole("textbox", { name: /nom de la boutique|comment s'appelle/i }).first().fill(storeName);
  await page.getByRole("button", { name: /suivant/i }).click();
  await page.getByLabel(/ville/i).fill("Cotonou");
  await page.getByRole("button", { name: /suivant/i }).click();
  // Le bouton radio est visuellement masqué : on clique la carte, comme un utilisateur.
  await page.locator("label").filter({ has: page.locator("#sector-restaurant") }).click();
  await expect(page.getByRole("radio", { name: /restaurant/i })).toBeChecked();
  await page.getByRole("button", { name: /suivant/i }).click();
  await page.getByRole("button", { name: /suivant/i }).click();
  await page.getByRole("button", { name: /créer ma boutique/i }).click();
  await page.waitForURL(/\/app\/[^/]+\/demarrage/, { timeout: 90_000 });
  await expectNoAppError(page);
  const storeId = storeIdFromUrl(page.url());

  const sub = await db.subscription.findUnique({ where: { storeId } });
  expect(sub?.status).toBe("TRIALING");
  expect(sub?.zone).toBe("AFRICA");

  // 4. Coordonnées WhatsApp
  await page.getByLabel(/numéro whatsapp/i).fill("0197000099");
  await page.getByRole("button", { name: /enregistrer les coordonnées/i }).click();
  await expect(page.getByText(/2290197000099|01 97 00 00 99/).first()).toBeVisible();

  // 5. Premier produit
  await page.goto(`/app/${storeId}/produits/nouveau`);
  await page.getByRole("textbox", { name: /^titre$/i }).fill("Riz jollof au poulet");
  await page.getByRole("textbox", { name: /^prix$/i }).fill("3500");
  await page.getByRole("button", { name: /créer le produit/i }).click();
  await page.waitForURL(new RegExp(`/app/${storeId}/produits/(?!nouveau)[^/]+$`));
  await expectNoAppError(page);

  // 6. Publication
  await page.goto(`/app/${storeId}/demarrage`);
  // Seule la première étape à faire est dépliée : on ouvre l'étape « Publication ».
  await page.getByText("Publication", { exact: true }).click();
  await page.getByRole("button", { name: /publier ma boutique/i }).click();
  await expect(page.getByText(/en ligne|boutique est publiée/i).first()).toBeVisible();
  await expect.poll(async () => (await db.store.findUniqueOrThrow({ where: { id: storeId } })).status, { timeout: 30_000 }).toBe("PUBLISHED");
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });

  // 7. Un client commande depuis son téléphone
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR" });
  const client = await mobile.newPage();
  await client.goto(`/s/${store.slug}`);
  await client.getByRole("button", { name: /^ajouter/i }).first().click();
  await client.goto(`/s/${store.slug}/commander`);
  await client.getByLabel(/nom complet/i).fill("E2E Afi Client");
  await client.getByLabel(/numéro whatsapp|téléphone/i).first().fill("0161000043");
  await client.getByRole("button", { name: /(confirmer la commande|commander) ·/i }).click();
  await client.waitForURL(/\/merci\//, { timeout: 90_000 });
  const token = new URL(client.url()).pathname.split("/").pop()!;
  await mobile.close();

  // 8. Traitement par le commerçant
  const order = await db.order.findUniqueOrThrow({ where: { trackingToken: token } });
  await page.goto(`/app/${storeId}/commandes`);
  await expect(page.getByText(order.reference).filter({ visible: true }).first()).toBeVisible();
  await page.goto(`/app/${storeId}/commandes/${order.id}`);
  await expectNoAppError(page);
  for (const step of [/confirmer la commande/i, /lancer la préparation/i, /marquer prête/i, /marquer livrée/i]) {
    await page.getByRole("button", { name: step }).first().click();
    await page.waitForTimeout(1500);
  }
  await expect.poll(async () => (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, { timeout: 30_000 }).toBe("DELIVERED");
  // « Remboursée » ne doit jamais être proposé comme étape suivante d'une commande non payée
  await expect(page.getByRole("button", { name: /marquer remboursée/i })).toHaveCount(0);

  // 9. Encaissement manuel
  await page.getByRole("button", { name: /confirmer le paiement/i }).first().click();
  const confirm = page.getByRole("button", { name: /oui, paiement reçu/i });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect.poll(async () => (await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus, { timeout: 30_000 }).toBe("PAID");

  const events = await db.orderEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } });
  expect(events.map((e) => e.toValue)).toEqual(expect.arrayContaining(["NEW", "CONFIRMED", "PREPARING", "READY", "DELIVERED", "PAID"]));
});

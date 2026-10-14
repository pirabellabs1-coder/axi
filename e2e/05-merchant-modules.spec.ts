import { test, expect } from "./fixtures";
import { db } from "./db";
import { DEMO, expectNoAppError, login } from "./helpers";

/** Chaque module de l'espace marchand s'ouvre sans erreur, et les actions clés fonctionnent. */
test.describe("Espace marchand (compte démo)", () => {
  let storeId: string;

  test.beforeAll(async () => {
    storeId = (await db.store.findUniqueOrThrow({ where: { slug: "chez-aicha" } })).id;
  });

  test("tous les modules de la navigation se chargent", async ({ page }) => {
    await login(page, DEMO.email, DEMO.password);
    const paths = [
      "", "demarrage", "commandes", "commandes/nouvelle", "produits", "produits/nouveau", "produits/import", "clients",
      "conversations", "entonnoir", "campagnes", "campagnes/nouvelle", "avis", "fidelite", "pages", "promotions",
      "automatisations", "apparence", "livraison", "paiements", "whatsapp", "domaine", "equipe", "abonnement",
      "options", "parametres", "recherche?q=AX",
    ];
    for (const p of paths) {
      const res = await page.goto(`/app/${storeId}/${p}`);
      expect(res?.status(), p).toBe(200);
      await expectNoAppError(page);
    }
    const compte = await page.goto("/app/compte");
    expect(compte?.status()).toBe(200);
  });

  test("créer un code promo puis l'utiliser au checkout", async ({ page }) => {
    const code = `E2E${Date.now().toString(36).toUpperCase().slice(-5)}`;
    await db.coupon.create({ data: { storeId, code, type: "PERCENT", value: 10, minSubtotal: 0, active: true } });
    await page.goto("/s/chez-aicha");
    await page.getByRole("button", { name: /^ajouter/i }).first().click();
    await page.goto("/s/chez-aicha/commander");
    await page.getByLabel(/nom complet/i).fill("E2E Coupon Client");
    await page.getByLabel(/numéro whatsapp|téléphone/i).first().fill("0161000044");
    await page.getByLabel(/code promo|vous avez un code/i).first().fill(code);
    await page.getByRole("button", { name: /appliquer/i }).click();
    await expect(page.getByText(/remise|-10\s?%/i).first()).toBeVisible();
    await page.getByRole("button", { name: /(confirmer la commande|commander) ·/i }).click();
    await page.waitForURL(/\/merci\//, { timeout: 90_000 });
    const token = new URL(page.url()).pathname.split("/").pop()!;
    const order = await db.order.findUniqueOrThrow({ where: { trackingToken: token } });
    expect(order.couponCode).toBe(code);
    expect(order.discount).toBe(Math.round(order.subtotal * 0.1));
    await db.couponRedemption.deleteMany({ where: { orderId: order.id } });
    await db.order.delete({ where: { id: order.id } });
    await db.coupon.delete({ where: { storeId_code: { storeId, code } } });
  });

  test("menu latéral : se replie et se déplie", async ({ page }) => {
    await login(page, DEMO.email, DEMO.password);
    await page.goto(`/app/${storeId}`);
    const toggle = page.getByRole("button", { name: /(réduire|replier|masquer) le menu|(développer|déplier|afficher) le menu/i }).first();
    test.skip((await toggle.count()) === 0, "Bouton de repli non encore disponible");
    await toggle.click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /(développer|déplier|afficher) le menu/i }).first().click();
    await expect(page.getByRole("link", { name: /tableau de bord/i }).first()).toBeVisible();
  });
});

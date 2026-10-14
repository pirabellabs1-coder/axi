import { test, expect } from "./fixtures";
import { expectNoAppError } from "./helpers";

test.describe("Site vitrine", () => {
  test("accueil : hero, CTA et navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /créer ma boutique/i }).first()).toBeVisible();
    await expectNoAppError(page);
    for (const label of ["Fonctionnalités", "Tarifs", "Développeurs", "Marketplace", "Aide"]) {
      await expect(page.getByRole("navigation", { name: /principale/i }).getByRole("link", { name: label })).toBeVisible();
    }
    // Positionnement « plateforme complète » : les quatre domaines produit sont reliés depuis l'accueil.
    for (const path of ["/boutique-en-ligne", "/paiements", "/whatsapp", "/ia"]) {
      await expect(page.locator(`main a[href="${path}"]`).first()).toBeVisible();
    }
  });

  test("tarifs : bascule euros / FCFA et mensuel / annuel", async ({ page }) => {
    await page.goto("/tarifs");
    await expectNoAppError(page);
    const main = page.locator("main");
    await expect(main.getByText(/29\s?€/).first()).toBeVisible();
    await main.getByText(/afrique/i).first().click();
    await expect(main.getByText(/15\s?000\s?FCFA/).first()).toBeVisible();
    await expect(main.getByText(/enterprise/i).first()).toBeVisible();
  });

  test("toutes les pages publiques répondent sans erreur", async ({ page }) => {
    const paths = [
      "/fonctionnalites",
      "/boutique-en-ligne",
      "/paiements",
      "/whatsapp",
      "/ia",
      "/developpeurs",
      "/aide",
      "/a-propos",
      "/contact",
      "/legal/cgu",
      "/legal/confidentialite",
      "/legal/cookies",
      "/statut",
    ];
    for (const path of paths) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expectNoAppError(page);
    }
    const res = await page.goto("/page-qui-n-existe-pas");
    expect(res?.status()).toBe(404);
  });

  test("menu mobile : s'ouvre et se ferme à volonté @mobile", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Parcours mobile");
    await page.goto("/");
    const burger = page.getByRole("button", { name: /ouvrir le menu/i });
    for (let i = 0; i < 3; i++) {
      await burger.click();
      await expect(page.getByRole("navigation", { name: /mobile/i }).getByRole("link", { name: "Tarifs" })).toBeVisible();
      await page.getByRole("button", { name: /fermer le menu/i }).click();
      await expect(page.getByRole("navigation", { name: /mobile/i }).getByRole("link", { name: "Tarifs" })).toBeHidden();
    }
    // Échap ferme aussi
    await burger.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: /mobile/i }).getByRole("link", { name: "Tarifs" })).toBeHidden();
    // Navigation depuis le menu
    await burger.click();
    await page.getByRole("navigation", { name: /mobile/i }).getByRole("link", { name: "Tarifs" }).click();
    await page.waitForURL("**/tarifs");
    await expect(page.getByRole("navigation", { name: /mobile/i }).getByRole("link", { name: "Tarifs" })).toBeHidden();
  });
});

test.describe("Marketplace", () => {
  test("recherche, catégorie et accès à une boutique", async ({ page }) => {
    await page.goto("/marketplace");
    await expectNoAppError(page);
    await page.locator("main").getByRole("combobox", { name: /rechercher/i }).first().fill("wax");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/marketplace\/recherche/);
    await expectNoAppError(page);
    await expect(page.locator("main a[href^='/s/']").first()).toBeVisible();

    const cat = await page.goto("/marketplace/categorie/mode");
    expect(cat?.status()).toBe(200);
    await expectNoAppError(page);

    await page.goto("/marketplace");
    const storeLink = page.locator("main a[href^='/s/']").first();
    const href = await storeLink.getAttribute("href");
    await page.goto(href!);
    await expectNoAppError(page);
    await expect(page.getByRole("button", { name: /panier/i }).first()).toBeVisible();
  });
});

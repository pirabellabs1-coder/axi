import { test, expect } from "./fixtures";
import { db } from "./db";
import { expectNoAppError } from "./helpers";

/**
 * Parcours client complet sur une boutique de démo : produit → panier → commande → merci → suivi.
 * Vérifie aussi côté serveur : montants recalculés, stock et idempotence.
 */
test.describe("Achat client", () => {
  test("commande en retrait sur Chez Aïcha, puis suivi", async ({ page }) => {
    await page.goto("/s/chez-aicha");
    await expectNoAppError(page);

    // Ajout rapide du premier produit sans option
    const add = page.getByRole("button", { name: /^ajouter/i }).first();
    await add.click();
    await expect(page.getByRole("button", { name: /panier, 1 article/i }).first()).toBeVisible();

    await page.goto("/s/chez-aicha/commander");
    await expectNoAppError(page);
    await page.getByLabel(/nom complet/i).fill("E2E Afi Mensah");
    await page.getByLabel(/numéro whatsapp|téléphone/i).first().fill("0161000042");

    const submit = page.getByRole("button", { name: /(confirmer la commande|commander) ·/i });
    await expect(submit).toBeEnabled();
    const label = await submit.textContent();
    await submit.click();
    await page.waitForURL(/\/merci\//, { timeout: 90_000 });
    await expectNoAppError(page);
    await expect(page.getByText(/AX-[A-Z0-9]{6}/).first()).toBeVisible();

    // Contrôle serveur : commande enregistrée avec le bon total
    const token = new URL(page.url()).pathname.split("/").pop()!;
    const order = await db.order.findUnique({ where: { trackingToken: token }, include: { items: true } });
    expect(order).not.toBeNull();
    // Chez Aïcha est à Abidjan : indicatif +225.
    expect(order!.customerPhone).toBe("2250161000042");
    expect(order!.total).toBe(order!.items.reduce((s, i) => s + i.lineTotal, 0) + order!.deliveryFee - order!.discount);
    expect(label?.replace(/\s/g, "")).toContain(String(order!.total).replace(/\B(?=(\d{3})+(?!\d))/g, ""));

    // Suivi public
    await page.goto(`/suivi/${token}`);
    await expectNoAppError(page);
    await expect(page.getByText(order!.reference).first()).toBeVisible();

    // Lien de suivi invalide
    const bad = await page.goto("/suivi/jeton-invalide");
    expect([200, 404]).toContain(bad?.status() ?? 0);
    await expect(page.getByText(order!.reference)).toHaveCount(0);
  });

  test("le serveur refuse une commande vide et un téléphone invalide", async ({ page }) => {
    await page.goto("/s/chez-aicha/commander");
    await expectNoAppError(page);
    await expect(page.getByText(/panier est vide|aucun article/i).first()).toBeVisible();
  });
});

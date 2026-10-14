import { test, expect } from "./fixtures";
import { db } from "./db";
import { DEMO, login } from "./helpers";

/** Isolation entre boutiques et contrôle d'accès (cahier des charges §26). */
test.describe("Sécurité et isolation", () => {
  test("un commerçant ne voit jamais la boutique d'un autre", async ({ page }) => {
    const other = await db.store.findUniqueOrThrow({ where: { slug: "maquis-tanti-rosine" } });
    const otherOrder = await db.order.findFirstOrThrow({ where: { storeId: other.id } });
    const own = await db.store.findUniqueOrThrow({ where: { slug: "chez-aicha" } });

    await login(page, DEMO.email, DEMO.password);
    // Espace d'une autre boutique : renvoyé vers ses propres boutiques
    await page.goto(`/app/${other.id}`);
    await expect(page).not.toHaveURL(new RegExp(`/app/${other.id}(/|$)`));
    // Commande d'une autre boutique via l'URL de sa propre boutique : introuvable
    // (le statut HTTP reste 200 car la page est diffusée en streaming avant notFound() : on vérifie le contenu)
    await page.goto(`/app/${own.id}/commandes/${otherOrder.id}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(/pas sur l'étal|introuvable/i);
    await expect(page.getByText(otherOrder.reference)).toHaveCount(0);
    // Console d'administration interdite
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("les espaces privés exigent une connexion", async ({ page }) => {
    for (const path of ["/app", "/admin", "/app/compte"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/connexion/);
    }
  });

  test("le worker de tâches refuse la clé dans l'URL", async ({ request }) => {
    const res = await request.get("/api/jobs/run?key=dev-jobs-key-local");
    expect(res.status()).toBe(401);
  });

  test("une redirection externe après connexion est neutralisée", async ({ page }) => {
    await login(page, DEMO.email, DEMO.password, "//evil.example");
    expect(new URL(page.url()).host).toBe(new URL(page.context().pages()[0].url()).host);
    await expect(page).toHaveURL(/\/app/);
  });
});

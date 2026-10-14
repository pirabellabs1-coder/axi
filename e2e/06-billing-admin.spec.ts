import { test, expect } from "./fixtures";
import { db, uniqueEmail, E2E_PASSWORD } from "./db";
import { ADMIN, expectNoAppError, login, logout } from "./helpers";
import { hash } from "@node-rs/argon2";

/**
 * Facturation V4 : un commerçant demande Business, la facture reste ouverte et le plan n'est pas activé
 * tant qu'elle n'est pas payée ; l'admin la marque payée, le plan devient actif.
 */
test("montée en gamme payée via l'administration", async ({ page }) => {
  const email = uniqueEmail("facturation");
  const user = await db.user.create({
    data: { email, name: "E2E Facturation", passwordHash: await hash(E2E_PASSWORD, { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 }), emailVerifiedAt: new Date() },
  });
  const slug = `e2e-fact-${Date.now().toString(36)}`;
  const store = await db.store.create({
    data: {
      name: "E2E Facturation",
      slug,
      currency: "XOF",
      country: "BJ",
      status: "PUBLISHED",
      memberships: { create: { userId: user.id, role: "OWNER" } },
      subscription: { create: { planId: "FREE", status: "ACTIVE", zone: "AFRICA", currency: "XOF" } },
    },
  });

  await login(page, email, E2E_PASSWORD);
  await page.goto(`/app/${store.id}/abonnement`);
  await expectNoAppError(page);
  await page.getByRole("button", { name: /choisir business|passer à business/i }).first().click();
  const confirm = page.getByRole("button", { name: /confirmer|continuer|payer/i }).first();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForURL(/\/abonnement\/factures\//, { timeout: 90_000 });
  await expectNoAppError(page);
  await expect(page.getByText(/15\s?000\s?FCFA/).first()).toBeVisible();

  const invoice = await db.invoice.findFirstOrThrow({ where: { subscription: { storeId: store.id }, status: "OPEN" } });
  expect(invoice.currency).toBe("XOF");
  expect((await db.subscription.findUniqueOrThrow({ where: { storeId: store.id } })).planId).toBe("FREE");

  // L'admin encaisse
  await logout(page);
  await login(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/admin/);
  await page.goto(`/admin/abonnements`);
  await expectNoAppError(page);
  const row = page.locator("tr, li, article").filter({ hasText: invoice.number }).first();
  await row.getByRole("button", { name: /marquer (comme )?payée/i }).click();
  const ok = page.getByRole("dialog").getByRole("button", { name: /confirmer/i });
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await expect.poll(async () => (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, { timeout: 30_000 }).toBe("PAID");
  const sub = await db.subscription.findUniqueOrThrow({ where: { storeId: store.id } });
  expect(sub.planId).toBe("BUSINESS");
  expect(sub.status).toBe("ACTIVE");
});

test("console admin : toutes les sections se chargent", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/admin/);
  for (const p of ["", "boutiques", "utilisateurs", "abonnements", "tarifs", "options", "credits", "paiements", "tickets", "taches", "audit"]) {
    const res = await page.goto(`/admin/${p}`);
    expect(res?.status(), p).toBe(200);
    await expectNoAppError(page);
  }
});

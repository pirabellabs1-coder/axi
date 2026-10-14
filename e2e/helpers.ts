import { expect, type Page } from "@playwright/test";
import { clearRateLimits } from "./db";

export const DEMO = { email: "demo@axi.africa", password: "Demo-Axi-2026!" };
export const ADMIN = { email: "admin@axi.africa", password: "Admin-Axi-2026!" };

/** Aucune page ne doit afficher l'écran d'erreur générique ni l'overlay d'erreur Next. */
export async function expectNoAppError(page: Page) {
  await expect(page.getByText("Un problème est survenu")).toHaveCount(0);
  await expect(page.locator("nextjs-portal [data-nextjs-dialog]")).toHaveCount(0);
}

export async function login(page: Page, email: string, password: string, next?: string) {
  await clearRateLimits();
  await page.goto(`/connexion${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel(/adresse e-mail/i).fill(email);
  await page.getByLabel(/^mot de passe/i).fill(password);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 90_000 });
}

export async function logout(page: Page) {
  await page.context().clearCookies();
}

/** Identifiant de boutique depuis une URL /app/{id}/… */
export function storeIdFromUrl(url: string): string {
  const m = new URL(url).pathname.match(/^\/app\/([^/]+)/);
  if (!m) throw new Error(`URL inattendue : ${url}`);
  return m[1];
}

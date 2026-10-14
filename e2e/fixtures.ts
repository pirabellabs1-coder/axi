import { test as base, expect } from "@playwright/test";

/** Pixel PNG transparent : remplace les photos distantes pendant les tests (réseau lent ou absent). */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(/^https:\/\/(images\.unsplash\.com|.*\.(googletagmanager|facebook)\.(com|net))\//, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
    );
    await use(context);
  },
  page: async ({ page }, use) => {
    // N'attend que le rendu du document : les ressources tierces ne bloquent pas les parcours.
    const goto = page.goto.bind(page);
    page.goto = (async (url: string, options?: Parameters<typeof goto>[1]) => {
      const opts = { waitUntil: "domcontentloaded" as const, ...options };
      try {
        return await goto(url, opts);
      } catch (e) {
        // Une navigation vitrine peut être interrompue (net::ERR_ABORTED) quand elle suit de trop près une
        // navigation précédente (déconnexion, redirection). On retente une fois : la nouvelle tentative aboutit.
        if (e instanceof Error && e.message.includes("net::ERR_ABORTED")) {
          await page.waitForTimeout(500);
          return await goto(url, opts);
        }
        throw e;
      }
    }) as typeof page.goto;
    await use(page);
  },
});

export { expect };

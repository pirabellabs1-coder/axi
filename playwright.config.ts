import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Tests de bout en bout (parcours réels dans un navigateur) contre le serveur local.
 *   pnpm db:local   (Postgres embarqué)   +   pnpm dev
 *   pnpm e2e
 * Les tests créent leurs propres données (e-mails uniques @e2e.test) et les suppriment à la fin.
 * PLAYWRIGHT_CHROMIUM : chemin d'un Chromium déjà installé (évite un téléchargement).
 */
const localChromium = path.join(homedir(), "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
// Repli sur un Chrome / Edge installé quand les navigateurs Playwright ne sont pas téléchargés.
const systemBrowsers = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? [localChromium, ...systemBrowsers].find((p) => existsSync(p));

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "e2e-report", open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "fr-FR",
    timezoneId: "Africa/Porto-Novo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});

/**
 * Captures du site vitrine (Playwright, Chrome système).
 *
 *   node scripts/vitrine-captures.mjs produit   → public/vitrine/*.png  (preuve par le produit)
 *   node scripts/vitrine-captures.mjs recette   → docs/captures/vitrine-*.png (recette 375/768/1440, clair/sombre)
 *
 * Le serveur de développement doit tourner sur http://localhost:3000.
 * La recette échoue (code 1) en cas de débordement horizontal ou d'erreur console.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MODE = process.argv[2] ?? "produit";
/** Filtre facultatif par nom : `node scripts/vitrine-captures.mjs produit editeur` ou `... recette developpeurs`. */
const ONLY = (process.argv[3] ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ROOT = path.join(import.meta.dirname, "..");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

/** Session de démonstration créée par `pnpm db:seed` (propriétaire demo@axi.africa). */
const SESSION = "testsession0000000000000000000000000000000000000000000000000001";

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Écrans réels du produit réutilisés comme illustrations du site vitrine. */
const PRODUIT = [
  { name: "editeur", url: "/app/{dantokpa}/apparence", viewport: DESK, dark: true, wait: 60000, clip: { x: 0, y: 0, width: 1440, height: 700 } },
  { name: "produits", url: "/app/{aicha}/produits", viewport: DESK, dark: true },
  // Onglet « Terminées » : les commandes anciennes du jeu de démonstration, sans entrées de test récentes.
  { name: "commandes", url: "/app/{dantokpa}/commandes?statut=terminees&paiement=PAID", viewport: DESK, dark: true },
  { name: "paiements", url: "/app/{aicha}/paiements", viewport: DESK, dark: true },
  // La boîte partagée n'a d'intérêt qu'avec un fil ouvert : on sélectionne la première conversation.
  { name: "conversations", url: "/app/{aicha}/conversations", viewport: DESK, dark: true, click: "text=Mariam Touré" },
  { name: "entonnoir", url: "/app/{aicha}/entonnoir", viewport: DESK, dark: true },
  { name: "connecteur-ia", url: "/app/{aicha}/integrations/ia", viewport: DESK, dark: true, clip: { x: 0, y: 0, width: 1440, height: 660 } },
  // Vitrine acheteur : thème de la boutique, toujours en clair.
  { name: "boutique-mobile", url: "/s/dantokpa-mode", viewport: PHONE, dark: false, wait: 2500, maxWidth: 780, clip: { x: 0, y: 0, width: 390, height: 690 } },
  { name: "fiche-produit", url: "/s/dantokpa-mode/p/robe-soleil-en-pagne", viewport: PHONE, dark: false, wait: 2500, maxWidth: 780 },
  { name: "boutique-bureau", url: "/s/chez-aicha", viewport: DESK, dark: false, wait: 2500 },
];

/** Pages du site vitrine à vérifier (largeurs x thèmes). */
const PAGES = [
  ["accueil", "/"],
  ["fonctionnalites", "/fonctionnalites"],
  ["boutique-en-ligne", "/boutique-en-ligne"],
  ["paiements", "/paiements"],
  ["whatsapp", "/whatsapp"],
  ["ia", "/ia"],
  ["tarifs", "/tarifs"],
  ["developpeurs", "/developpeurs"],
  ["marketplace", "/marketplace"],
  ["aide", "/aide"],
  ["a-propos", "/a-propos"],
  ["contact", "/contact"],
  ["cgu", "/legal/cgu"],
];
const WIDTHS = [375, 768, 1440];

async function storeIds(browser) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "axi_session", value: SESSION, url: BASE }]);
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(120_000);
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("a[href^='/app/']")].map((a) => a.getAttribute("href").split("/")[2]).filter((v, i, a) => v && a.indexOf(v) === i),
  );
  const found = {};
  for (const id of ids) {
    await page.goto(`${BASE}/app/${id}`, { waitUntil: "domcontentloaded" });
    const slug = await page.evaluate(() => document.querySelector("a[href^='/s/']")?.getAttribute("href")?.split("/")[2] ?? null);
    if (slug === "chez-aicha") found.aicha = id;
    if (slug === "dantokpa-mode") found.dantokpa = id;
  }
  await ctx.close();
  return found;
}

/**
 * Redimensionne une capture PNG et la réencode en WebP, dans le navigateur (aucune dépendance Node).
 * `maxWidth` est la largeur finale en pixels réels : au-delà, l'image est réduite proportionnellement.
 */
async function toWebp(browser, png, maxWidth, quality = 0.82) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("about:blank");
  const dataUrl = await page.evaluate(
    async ([b64, max, q]) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const scale = Math.min(1, max / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const g = canvas.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", q);
    },
    [png.toString("base64"), maxWidth, quality],
  );
  await ctx.close();
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

/** Nombre d'images visibles non chargées, dans la page et dans ses cadres (aperçu de l'éditeur compris). */
async function brokenImages(page, maxY) {
  const count = (f) =>
    f
      .evaluate((limit) => {
        const vh = limit ?? window.innerHeight;
        return [...document.images].filter((i) => {
          const r = i.getBoundingClientRect();
          return r.bottom > 0 && r.top < vh && r.width > 24 && i.naturalWidth === 0;
        }).length;
      }, maxY)
      .catch(() => 0);
  const counts = await Promise.all(page.frames().map(count));
  return counts.reduce((a, b) => a + b, 0);
}

const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined });
let failures = 0;

if (MODE === "produit") {
  const out = path.join(ROOT, "public", "vitrine");
  mkdirSync(out, { recursive: true });
  const ids = await storeIds(browser);
  for (const s of PRODUIT.filter((s) => ONLY.length === 0 || ONLY.includes(s.name))) {
    const url = s.url.replace("{aicha}", ids.aicha ?? "").replace("{dantokpa}", ids.dantokpa ?? "");
    const ctx = await browser.newContext({
      viewport: s.viewport,
      deviceScaleFactor: 2,
      locale: "fr-FR",
      timezoneId: "Africa/Porto-Novo",
      colorScheme: s.dark ? "dark" : "light",
      reducedMotion: "reduce",
    });
    await ctx.addCookies([{ name: "axi_session", value: SESSION, url: BASE }]);
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("axi-theme", t);
        // Bandeau de consentement déjà répondu : il n'a rien à faire sur une capture produit.
        for (const slug of ["chez-aicha", "dantokpa-mode", "tech-hub-cotonou"]) localStorage.setItem(`axi:consent:${slug}`, "denied");
      } catch {}
    }, s.dark ? "dark" : "light");
    const page = await ctx.newPage();
    try {
      // Première visite : le serveur de développement compile la route, parfois longuement.
      try {
        await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 240_000 });
      } catch {}
      await page.goto(BASE + url, { waitUntil: "load", timeout: 120_000 });
      // Indicateur de développement Next : hors sujet sur une capture produit.
      await page.addStyleTag({ content: "nextjs-portal,[data-nextjs-toast],#__next-build-watcher{display:none!important}" });
      // Aucune image cassée ni aperçu en cours de chargement : Unsplash est parfois lent,
      // on recharge plutôt que de livrer un cadre gris.
      for (let attempt = 0; ; attempt++) {
        await page.waitForTimeout(s.wait ?? 1500);
        const broken = await brokenImages(page, s.clip?.height);
        const loading = await page.getByText("Chargement de l'aperçu").count();
        if (broken === 0 && loading === 0) break;
        if (attempt === 3) throw new Error(`${broken} image(s) non chargée(s)${loading ? ", aperçu en cours" : ""}`);
        await page.reload({ waitUntil: "domcontentloaded", timeout: 180_000 });
        await page.addStyleTag({ content: "nextjs-portal,[data-nextjs-toast],#__next-build-watcher{display:none!important}" });
      }
      if (s.click) {
        await page
          .locator(s.click)
          .first()
          .click({ timeout: 15_000 })
          .catch(() => {});
        await page.waitForTimeout(2500);
      }
      const png = await page.screenshot({ clip: s.clip });
      // Le loader next/image sert les fichiers locaux tels quels : on livre directement un WebP à la bonne taille.
      const file = path.join(out, `${s.name}.webp`);
      const bytes = await toWebp(browser, png, s.maxWidth ?? 1800);
      writeFileSync(file, bytes);
      console.log(`OK  ${s.name}  ${url}  ${Math.round(bytes.length / 1024)} Ko`);
    } catch (e) {
      failures++;
      console.log(`ERR ${s.name}  ${url}  ${e.message}`);
    }
    await ctx.close();
  }
} else {
  const out = path.join(ROOT, "docs", "captures");
  mkdirSync(out, { recursive: true });
  for (const theme of ["clair", "sombre"]) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 900 },
        deviceScaleFactor: 1,
        locale: "fr-FR",
        timezoneId: "Africa/Porto-Novo",
        colorScheme: theme === "sombre" ? "dark" : "light",
        reducedMotion: "reduce",
      });
      await ctx.addInitScript((t) => {
        try {
          localStorage.setItem("axi-theme", t);
        } catch {}
      }, theme === "sombre" ? "dark" : "light");
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      for (const [name, url] of PAGES.filter(([n]) => ONLY.length === 0 || ONLY.includes(n))) {
       errors.length = 0;
       try {
        const res = await page.goto(BASE + url, { waitUntil: "load", timeout: 180_000 });
        // Indicateur de développement Next : hors sujet sur une capture de recette.
        await page.addStyleTag({ content: "nextjs-portal,[data-nextjs-toast],#__next-build-watcher{display:none!important}" }).catch(() => {});
        // Défilement par paliers : déclenche le chargement paresseux des images, puis on attend leur décodage.
        await page.evaluate(async () => {
          const step = window.innerHeight * 0.8;
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 250));
          }
          window.scrollTo(0, 0);
          await new Promise((r) => setTimeout(r, 250));
          await Promise.race([
            Promise.all([...document.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => {}))),
            new Promise((r) => setTimeout(r, 15000)),
          ]);
        });
        await page.waitForTimeout(900);
        const overflow = await page.evaluate(() => {
          const d = document.documentElement;
          const guilty = [...document.querySelectorAll("body *")]
            .filter((el) => el.getBoundingClientRect().right > d.clientWidth + 1 && getComputedStyle(el).position !== "fixed")
            .slice(0, 3)
            .map((el) => el.tagName + "." + (el.className?.toString?.().slice(0, 60) ?? ""));
          return { scroll: d.scrollWidth > d.clientWidth + 1, client: d.clientWidth, scrollWidth: d.scrollWidth, guilty };
        });
        const file = path.join(out, `vitrine-${name}-${theme}-${width}.png`);
        await page.screenshot({ path: file, fullPage: width === 1440 && theme === "clair" });
        const bad = res?.status() !== 200 || overflow.scroll || errors.length > 0;
        if (bad) failures++;
        console.log(
          `${bad ? "KO " : "OK "} ${name} ${theme} ${width} status=${res?.status()}${overflow.scroll ? ` OVERFLOW ${overflow.scrollWidth}>${overflow.client} ${JSON.stringify(overflow.guilty)}` : ""}${errors.length ? ` CONSOLE ${JSON.stringify(errors.slice(0, 2))}` : ""}`,
        );
       } catch (e) {
        // Le serveur de développement peut redémarrer en cours de recette (travail en parallèle).
        failures++;
        console.log(`KO  ${name} ${theme} ${width} ${String(e.message).split(/\r?\n/)[0]}`);
       }
      }
      await ctx.close();
    }
  }
}

await browser.close();
if (failures) {
  console.log(`\n${failures} problème(s).`);
  process.exit(1);
}
console.log("\nToutes les captures sont passées.");

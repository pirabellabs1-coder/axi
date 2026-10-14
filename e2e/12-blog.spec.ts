import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { db, clearRateLimits } from "./db";
import { expectNoAppError, logout } from "./helpers";

/**
 * Lot 2 · blog de la boutique (docs/vague2/B-blog.md, RECETTE §4 sexies) sur la boutique de démo
 * Atelier Beauté Nafi (plan Scale, blog illimité ; boutique distincte de celles des suites 01 à 09) :
 *  1. le commerçant crée une catégorie puis un article publié (liste, citation, lien interne) et le retrouve
 *     sur `/blog`, `/blog/categorie/{adresse}` et sur sa page, avec les données structurées `BlogPosting` ;
 *  2. un article programmé est invisible d'un visiteur anonyme, puis visible à l'heure dite sans aucune action
 *     (la publication ne dépend d'aucune tâche : seules les lectures publiques filtrent sur la date) ;
 *  3. la section « Derniers articles » ajoutée à l'accueil depuis l'éditeur de thème affiche les articles ;
 *  4. le flux RSS liste l'article publié et jamais le brouillon ;
 *  5. un brouillon est introuvable d'un visiteur anonyme.
 *
 * Nettoyage : articles et catégorie « e2e-… » supprimés, document de thème (brouillon et version en ligne)
 * remis dans son état initial, versions de thème créées pendant le test supprimées.
 *
 * Limite assumée : pour vérifier qu'un article programmé devient visible « tout seul », le test avance l'heure
 * de publication en base (aucune action applicative) plutôt que d'attendre réellement les minutes du délai
 * minimum de programmation imposé par le formulaire.
 */

const SLUG = "atelier-beaute-nafi";
const OWNER = { email: "nafi@atelier-beaute-nafi.demo", password: "Demo-Axi-2026!" };
const CATEGORY = "E2E Conseils";
const CATEGORY_SLUG = "e2e-conseils";
const PUBLISHED = "E2E Article publie";
const SCHEDULED = "E2E Article programme";
const DRAFT = "E2E Article brouillon";
const BODY = ["## Nos conseils", "", "- karité brut", "- huile de chébé", "", "> Appliquer sur cheveux humides.", "", "[Voir le catalogue](/catalogue)"].join("\n");

async function loginOwner(page: Page, next: string) {
  await clearRateLimits();
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/adresse e-mail/i).fill(OWNER.email);
  await page.getByLabel(/^mot de passe/i).fill(OWNER.password);
  await page.getByRole("button", { name: /se connecter/i }).click({ noWaitAfter: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 240_000 });
}

/** Remplit l'éditeur d'article et valide avec l'intention demandée. */
async function writePost(page: Page, storeId: string, opts: { title: string; intent: "draft" | "publish" | "schedule"; category?: boolean; scheduledLocal?: string }) {
  await page.goto(`/app/${storeId}/blog/nouveau`);
  await expectNoAppError(page);
  // L'éditeur est un formulaire contrôlé : une saisie faite avant l'hydratation est effacée par React
  // (serveur de développement). On répète la saisie jusqu'à ce que les valeurs tiennent.
  const title = page.getByRole("textbox", { name: "Titre", exact: true });
  const body = page.locator("#bp-body");
  const intent = page.locator(`input[name="intent-choice"][value="${opts.intent}"]`);
  await expect(async () => {
    await title.fill(opts.title);
    await body.fill(BODY);
    if (opts.category) await page.getByRole("combobox", { name: "Catégorie", exact: true }).selectOption({ label: CATEGORY });
    await intent.check();
    await expect(title).toHaveValue(opts.title, { timeout: 3_000 });
    await expect(body).toHaveValue(BODY, { timeout: 3_000 });
    await expect(intent).toBeChecked({ timeout: 3_000 });
  }).toPass({ timeout: 150_000 });
  if (opts.scheduledLocal) {
    const when = page.locator('input[name="scheduledAt"]');
    await expect(async () => {
      await when.fill(opts.scheduledLocal!);
      await expect(when).toHaveValue(opts.scheduledLocal!, { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
  }
  const submit = { draft: /enregistrer le brouillon/i, publish: /^publier$/i, schedule: /^programmer$/i }[opts.intent];
  await page.getByRole("button", { name: submit }).click();
  await expect.poll(async () => db.blogPost.count({ where: { storeId, title: opts.title } }), { timeout: 120_000 }).toBe(1);
  return db.blogPost.findFirstOrThrow({ where: { storeId, title: opts.title }, select: { id: true, slug: true, status: true, publishedAt: true, categoryId: true } });
}

// Serveur de développement : la première visite d'une page la compile.
test.describe.configure({ mode: "serial", timeout: 600_000 });
test.use({ actionTimeout: 150_000, navigationTimeout: 150_000 });

test.describe("Lot 2 : blog", () => {
  let storeId = "";
  let theme: { themeDoc: unknown; themeDocDraft: unknown } | null = null;
  let startedAt = new Date();
  let publishedSlug = "";
  let scheduledSlug = "";
  let scheduledId = "";
  let draftSlug = "";

  test.beforeAll(async () => {
    const store = await db.store.findUnique({ where: { slug: SLUG }, select: { id: true, timezone: true, themeDoc: true, themeDocDraft: true } });
    if (!store) throw new Error(`Boutique de démo ${SLUG} absente : lancez pnpm db:seed`);
    storeId = store.id;
    theme = { themeDoc: store.themeDoc, themeDocDraft: store.themeDocDraft };
    startedAt = new Date();
    await db.blogPost.deleteMany({ where: { storeId, title: { startsWith: "E2E " } } });
    await db.blogCategory.deleteMany({ where: { storeId, slug: CATEGORY_SLUG } });
    await clearRateLimits();
  });

  test.afterAll(async () => {
    if (!storeId) return;
    await db.blogPost.deleteMany({ where: { storeId, title: { startsWith: "E2E " } } });
    await db.blogCategory.deleteMany({ where: { storeId, slug: CATEGORY_SLUG } });
    await db.themeVersion.deleteMany({ where: { storeId, createdAt: { gte: startedAt } } });
    if (theme) await db.store.update({ where: { id: storeId }, data: { themeDoc: theme.themeDoc as never, themeDocDraft: theme.themeDocDraft as never } });
  });

  test("catégorie et article publié : visibles sur le blog, la catégorie et la page de l'article", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/blog/categories`);
    await expectNoAppError(page);
    const name = page.getByRole("textbox", { name: "Nom", exact: true });
    const slug = page.getByRole("textbox", { name: "Adresse", exact: true });
    await expect(async () => {
      await name.fill(CATEGORY);
      await slug.fill(CATEGORY_SLUG);
      await expect(name).toHaveValue(CATEGORY, { timeout: 3_000 });
      await expect(slug).toHaveValue(CATEGORY_SLUG, { timeout: 3_000 });
    }).toPass({ timeout: 150_000 });
    await page.getByRole("button", { name: /créer la catégorie/i }).click();
    await expect.poll(async () => db.blogCategory.count({ where: { storeId, slug: CATEGORY_SLUG } }), { timeout: 120_000 }).toBe(1);

    const post = await writePost(page, storeId, { title: PUBLISHED, intent: "publish", category: true });
    publishedSlug = post.slug;
    expect(post.status).toBe("PUBLISHED");
    expect(post.publishedAt).not.toBeNull();
    expect(post.categoryId).not.toBeNull();

    await logout(page);
    await page.goto(`/s/${SLUG}/blog`);
    await expectNoAppError(page);
    await expect(page.getByRole("link", { name: new RegExp(PUBLISHED) }).first()).toBeVisible();

    await page.goto(`/s/${SLUG}/blog/categorie/${CATEGORY_SLUG}`);
    await expectNoAppError(page);
    await expect(page.getByRole("link", { name: new RegExp(PUBLISHED) }).first()).toBeVisible();

    await page.goto(`/s/${SLUG}/blog/${publishedSlug}`);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: PUBLISHED, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nos conseils" })).toBeVisible();
    await expect(page.getByRole("blockquote")).toContainText("Appliquer sur cheveux humides.");
    await expect(page.getByRole("link", { name: "Voir le catalogue" })).toHaveAttribute("href", `/s/${SLUG}/catalogue`);
    const jsonLd = (await page.locator('script[type="application/ld+json"]').allTextContents()).join(" ");
    expect(jsonLd).toContain('"@type":"BlogPosting"');
    expect(jsonLd).toContain(PUBLISHED);
  });

  test("article programmé : introuvable avant l'heure, visible ensuite sans aucune action", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/blog/nouveau`);
    // Fuseau de la boutique : Africa/Dakar (UTC). Le formulaire exige au moins 2 minutes dans le futur.
    const when = new Date(Date.now() + 10 * 60_000);
    const local = `${when.toISOString().slice(0, 16)}`;
    const post = await writePost(page, storeId, { title: SCHEDULED, intent: "schedule", scheduledLocal: local });
    scheduledSlug = post.slug;
    scheduledId = post.id;
    expect(post.status).toBe("SCHEDULED");
    expect(post.publishedAt!.getTime()).toBeGreaterThan(Date.now());

    await logout(page);
    expect((await page.goto(`/s/${SLUG}/blog/${scheduledSlug}`))?.status()).toBe(404);
    await page.goto(`/s/${SLUG}/blog`);
    await expect(page.getByRole("link", { name: new RegExp(SCHEDULED) })).toHaveCount(0);

    // L'heure passe (simulée en base, aucune action applicative) : l'article apparaît de lui-même.
    await db.blogPost.update({ where: { id: scheduledId }, data: { publishedAt: new Date(Date.now() - 60_000) } });
    expect((await page.goto(`/s/${SLUG}/blog/${scheduledSlug}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: SCHEDULED, level: 1 })).toBeVisible();
    await page.goto(`/s/${SLUG}/blog`);
    await expect(page.getByRole("link", { name: new RegExp(SCHEDULED) }).first()).toBeVisible();
    expect((await db.blogPost.findUniqueOrThrow({ where: { id: scheduledId } })).status).toBe("SCHEDULED");
  });

  test("brouillon : introuvable d'un visiteur anonyme et absent du flux RSS", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/blog/nouveau`);
    const post = await writePost(page, storeId, { title: DRAFT, intent: "draft" });
    draftSlug = post.slug;
    expect(post.status).toBe("DRAFT");

    await logout(page);
    expect((await page.goto(`/s/${SLUG}/blog/${draftSlug}`))?.status()).toBe(404);
    await page.goto(`/s/${SLUG}/blog`);
    await expect(page.getByRole("link", { name: new RegExp(DRAFT) })).toHaveCount(0);

    const rss = await page.request.get(`/s/${SLUG}/blog/rss.xml`);
    expect(rss.status()).toBe(200);
    expect(rss.headers()["content-type"]).toContain("application/rss+xml");
    const xml = await rss.text();
    expect(xml).toContain("<rss");
    expect(xml).toContain(PUBLISHED);
    expect(xml).toContain(SCHEDULED);
    expect(xml).not.toContain(DRAFT);
  });

  test("section « Derniers articles » publiée sur l'accueil depuis l'éditeur de thème", async ({ page }) => {
    await loginOwner(page, `/app/${storeId}/apparence`);
    await expectNoAppError(page);
    // L'éditeur est une application cliente : on attend que ses commandes répondent.
    const add = page.getByRole("button", { name: /^ajouter une section$/i }).filter({ visible: true }).first();
    await expect(add).toBeVisible({ timeout: 150_000 });
    await add.click();
    const dialog = page.getByRole("dialog", { name: /ajouter une section/i });
    await dialog.getByLabel(/rechercher une section/i).fill("Derniers articles");
    await dialog.getByRole("button", { name: /^derniers articles/i }).first().click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: /^publier/i }).click();
    await expect(page.getByText(/thème publié sur la boutique/i)).toBeVisible({ timeout: 150_000 });

    await logout(page);
    await page.goto(`/s/${SLUG}`);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: "Derniers articles" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(PUBLISHED) }).first()).toBeVisible();
    // Un brouillon n'apparaît jamais dans la section.
    await expect(page.getByRole("link", { name: new RegExp(DRAFT) })).toHaveCount(0);
  });
});

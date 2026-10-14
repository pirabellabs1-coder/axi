import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { db, clearRateLimits } from "./db";
import { DEMO, expectNoAppError, logout } from "./helpers";

/**
 * Lot 4A · personnalisation de la boutique (docs/vague2/T1-moteur.md, T2-editeur.md, T3-rendu.md, D-donnees.md,
 * RECETTE §4 septies) sur la boutique de démo Chez Aïcha (essai Business) :
 *  1. champ personnalisé créé, renseigné sur un produit, puis affiché en boutique par la section
 *     « Caractéristiques du produit » ;
 *  2. une section enregistrée est réinsérée depuis l'onglet « Mes sections » (identifiants distincts) ;
 *  3. la bibliothèque de sections Axi insère une composition ;
 *  4. le panneau Qualité signale un défaut de contraste et le corrige en un clic ;
 *  5. un modèle alternatif de produit est créé et apparaît dans le sélecteur de page ;
 *  6. la visibilité par audience d'une section est enregistrée dans le brouillon ;
 *  7. un réglage de la section « Recherche » (main-search) publié se retrouve sur `/recherche`.
 *
 * Le document de thème (brouillon et version en ligne) est remis dans son état initial à la fin ; le champ
 * personnalisé, sa valeur, les sections enregistrées et les versions de thème créées sont supprimés.
 */

const SLUG = "chez-aicha";
const FIELD_NAME = "E2E Matière";
const FIELD_KEY = "e2e_matiere";
const FIELD_VALUE = "Beurre de karité et vanille";
const SAVED_SECTION = "E2E Section enregistrée";
const SEARCH_HEADING = "E2E Trouver une pâtisserie";

type ThemeDoc = { settings?: Record<string, unknown>; templates?: Record<string, { sections?: Record<string, { type: string; visibility?: { mode?: string } }>; order?: string[] }>; alternates?: Record<string, Record<string, unknown>> };

async function loginMerchant(page: Page, next: string) {
  await clearRateLimits();
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/adresse e-mail/i).fill(DEMO.email);
  await page.getByLabel(/^mot de passe/i).fill(DEMO.password);
  await page.getByRole("button", { name: /se connecter/i }).click({ noWaitAfter: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 300_000 });
}

let storeId = "";

/** Brouillon du thème tel qu'enregistré par la sauvegarde automatique de l'éditeur. */
async function draft(): Promise<ThemeDoc> {
  return ((await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { themeDocDraft: true } })).themeDocDraft ?? {}) as ThemeDoc;
}

function sectionsOf(doc: ThemeDoc, template: string) {
  return Object.entries(doc.templates?.[template]?.sections ?? {}).map(([id, s]) => ({ id, ...s }));
}

/** Nom de la section principale attendue dans la liste, par modèle de page (preuve que la bascule a pris). */
const MAIN_SECTION: Record<string, string> = { home: "Bannière principale", product: "Fiche produit", search: "Recherche" };

/** Ouvre l'éditeur sur un modèle de page et attend que la liste des sections corresponde à ce modèle. */
async function openEditor(page: Page, template: string) {
  await page.goto(`/app/${storeId}/apparence`);
  await expectNoAppError(page);
  const selector = page.locator("#template-select");
  const sections = page.getByRole("list", { name: /sections, dans l'ordre d'affichage/i });
  const marker = sections.getByText(MAIN_SECTION[template], { exact: true }).first();
  // Le sélecteur est contrôlé par React : un choix fait avant l'hydratation est annulé. On recommence jusqu'à
  // ce que la liste des sections montre bien la section principale du modèle demandé.
  await expect(async () => {
    await selector.selectOption(template);
    await expect(marker).toBeVisible({ timeout: 5_000 });
    await expect(selector).toHaveValue(template, { timeout: 2_000 });
  }).toPass({ timeout: 300_000 });
}

/** Ajoute une section par son nom depuis la fenêtre « Ajouter une section ». */
async function addSection(page: Page, name: string) {
  await page.getByRole("button", { name: /^ajouter une section$/i }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: /ajouter une section/i });
  await dialog.getByLabel(/rechercher une section/i).fill(name);
  await dialog.getByRole("button", { name: new RegExp(`^${name}`, "i") }).first().click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Sélectionne dans la liste la première section MODIFIABLE (les sections obligatoires portent l'icône
 * « obligatoire ») et renvoie son nom. Les boutons d'action de l'arbre n'apparaissent qu'au survol : on clique
 * donc sur le nom de la section, qui est le libellé de son bouton de sélection.
 */
async function selectEditableSection(page: Page): Promise<string> {
  const items = page.getByRole("list", { name: /sections, dans l'ordre d'affichage/i }).getByRole("listitem");
  await expect(items.first()).toBeVisible({ timeout: 180_000 });
  for (let i = 0; i < (await items.count()); i++) {
    const item = items.nth(i);
    if ((await item.getByLabel("obligatoire").count()) > 0) continue;
    const name = ((await item.locator("span.truncate").first().textContent()) ?? "").trim();
    if (!name) continue;
    await item.getByText(name, { exact: true }).first().click();
    return name;
  }
  throw new Error("Aucune section modifiable dans la liste des sections.");
}

async function publish(page: Page) {
  await page.getByRole("button", { name: /^publier/i }).click();
  await expect(page.getByText(/thème publié sur la boutique/i)).toBeVisible({ timeout: 180_000 });
}

// Serveur de développement : la première visite d'une page la compile.
test.describe.configure({ mode: "serial", timeout: 900_000 });
test.use({ actionTimeout: 180_000, navigationTimeout: 300_000 });

test.describe("Lot 4A : personnalisation de la boutique", () => {
  let theme: { themeDoc: unknown; themeDocDraft: unknown } | null = null;
  let startedAt = new Date();
  let productId = "";
  let productSlug = "";

  test.beforeAll(async () => {
    const store = await db.store.findUnique({ where: { slug: SLUG }, select: { id: true, themeDoc: true, themeDocDraft: true } });
    if (!store) throw new Error(`Boutique de démo ${SLUG} absente : lancez pnpm db:seed`);
    storeId = store.id;
    theme = { themeDoc: store.themeDoc, themeDocDraft: store.themeDocDraft };
    startedAt = new Date();
    const product = await db.product.findFirstOrThrow({ where: { storeId, status: "ACTIVE", isGiftCard: false }, orderBy: { name: "asc" }, select: { id: true, slug: true } });
    productId = product.id;
    productSlug = product.slug;
    await db.metafieldDefinition.deleteMany({ where: { storeId, key: FIELD_KEY } });
    await db.savedSection.deleteMany({ where: { storeId, name: { startsWith: "E2E " } } });
    await clearRateLimits();
  });

  test.afterAll(async () => {
    if (!storeId) return;
    await db.metafieldDefinition.deleteMany({ where: { storeId, key: FIELD_KEY } });
    await db.savedSection.deleteMany({ where: { storeId, name: { startsWith: "E2E " } } });
    await db.themeVersion.deleteMany({ where: { storeId, createdAt: { gte: startedAt } } });
    if (theme) await db.store.update({ where: { id: storeId }, data: { themeDoc: theme.themeDoc as never, themeDocDraft: theme.themeDocDraft as never } });
  });

  test("champ personnalisé : créé, renseigné sur un produit et affiché en boutique", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/parametres/champs`);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: "Champs personnalisés" })).toBeVisible();

    const dialog = page.getByRole("dialog", { name: /nouveau champ/i });
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau champ/i }).first().click();
      await expect(dialog).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 120_000 });
    const name = dialog.getByRole("textbox", { name: "Nom", exact: true });
    const key = dialog.getByRole("textbox", { name: "Clé", exact: true });
    await expect(async () => {
      await name.fill(FIELD_NAME);
      await key.fill(FIELD_KEY);
      await expect(name).toHaveValue(FIELD_NAME, { timeout: 3_000 });
      await expect(key).toHaveValue(FIELD_KEY, { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await expect(dialog.getByRole("checkbox", { name: /visible dans la boutique/i })).toBeChecked();
    await dialog.getByRole("button", { name: /créer le champ/i }).click();
    await expect.poll(async () => db.metafieldDefinition.count({ where: { storeId, key: FIELD_KEY, ownerType: "PRODUCT", storefrontVisible: true } }), { timeout: 300_000, intervals: [1_000, 2_000, 5_000] }).toBe(1);

    // Valeur sur la fiche produit du commerçant.
    await page.goto(`/app/${storeId}/produits/${productId}`);
    await expectNoAppError(page);
    const value = page.getByRole("textbox", { name: new RegExp(FIELD_NAME) }).first();
    const save = page.getByRole("button", { name: /enregistrer les champs/i });
    // Le bouton ne s'active qu'avec une vraie modification côté React : la saisie doit suivre l'hydratation.
    await expect(async () => {
      // On vide avant de resaisir : refaire `fill` avec la même valeur n'émettrait aucun événement et React
      // (non encore hydraté lors de la première tentative) resterait sans modification à enregistrer.
      await value.fill("");
      await value.fill(FIELD_VALUE);
      await expect(value).toHaveValue(FIELD_VALUE, { timeout: 3_000 });
      await expect(save).toBeEnabled({ timeout: 3_000 });
    }).toPass({ timeout: 180_000 });
    // Un seul enregistrement : recliquer renverrait le formulaire remis à zéro par le rafraîchissement et
    // effacerait la valeur. On attend que l'écran n'ait plus de modification en attente, puis la base.
    await save.click();
    await expect(save).toBeDisabled({ timeout: 300_000 });
    await expect.poll(async () => db.metafieldValue.count({ where: { storeId, ownerId: productId } }), { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).toBe(1);

    // Affichage en boutique : section « Caractéristiques du produit » (mode automatique).
    await openEditor(page, "product");
    await addSection(page, "Caractéristiques du produit");
    await expect.poll(async () => sectionsOf(await draft(), "product").some((s) => s.type === "product-specs"), { timeout: 120_000 }).toBe(true);
    await publish(page);

    await logout(page);
    await page.goto(`/s/${SLUG}/p/${productSlug}`);
    await expectNoAppError(page);
    await expect(page.getByText(FIELD_NAME).first()).toBeVisible();
    await expect(page.getByText(FIELD_VALUE).first()).toBeVisible();
  });

  test("section enregistrée : réinsérée depuis « Mes sections » avec un identifiant distinct", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/apparence`);
    await openEditor(page, "home");
    expect(sectionsOf(await draft(), "home").length, "l'accueil doit avoir des sections").toBeGreaterThan(0);

    // Sélection d'une section modifiable puis « Enregistrer cette section » (inspecteur).
    await selectEditableSection(page);
    await page.getByRole("button", { name: /enregistrer cette section/i }).click();
    const saveDialog = page.getByRole("dialog", { name: /enregistrer cette section/i });
    await saveDialog.getByLabel("Nom", { exact: true }).fill(SAVED_SECTION);
    await saveDialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect.poll(async () => db.savedSection.count({ where: { storeId, name: SAVED_SECTION } }), { timeout: 120_000 }).toBe(1);

    // Réinsertion depuis « Mes sections ».
    const countBefore = sectionsOf(await draft(), "home").length;
    await page.getByRole("button", { name: /^ajouter une section$/i }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog", { name: /ajouter une section/i });
    await dialog.getByRole("tab", { name: /mes sections/i }).click();
    await dialog.getByRole("button", { name: new RegExp(SAVED_SECTION) }).first().click();
    await expect.poll(async () => sectionsOf(await draft(), "home").length, { timeout: 120_000 }).toBe(countBefore + 1);
    const ids = sectionsOf(await draft(), "home").map((s) => s.id);
    expect(new Set(ids).size, "les identifiants de section restent uniques").toBe(ids.length);
  });

  test("bibliothèque de sections : une composition Axi est insérée", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/apparence`);
    await openEditor(page, "home");
    const countBefore = sectionsOf(await draft(), "home").length;
    await page.getByRole("button", { name: /^ajouter une section$/i }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog", { name: /ajouter une section/i });
    await dialog.getByRole("tab", { name: /bibliothèque/i }).click();
    // On insère la première composition RÉELLEMENT insérable : certaines cartes sont désactivées quand la section
    // (singleton) est déjà présente dans le brouillon. On vérifie qu'au moins une s'insère, pas un compte exact.
    const items = dialog.getByRole("list").getByRole("button", { disabled: false });
    await expect(items.first()).toBeVisible({ timeout: 60_000 });
    await items.first().click();
    await expect.poll(async () => sectionsOf(await draft(), "home").length, { timeout: 120_000 }).toBe(countBefore + 1);
  });

  test("panneau Qualité : le défaut de contraste est corrigé en un clic", async ({ page }) => {
    // Préparation : un texte gris clair sur fond clair dans le brouillon (le panneau Qualité le détecte).
    const current = (await draft()) as { settings?: { colors?: Record<string, unknown> } };
    const colors = { ...(current.settings?.colors ?? {}), text: "#CFCFCF" };
    await db.store.update({ where: { id: storeId }, data: { themeDocDraft: { ...current, settings: { ...(current.settings ?? {}), colors } } as never } });

    await loginMerchant(page, `/app/${storeId}/apparence`);
    await openEditor(page, "home");
    await page.getByRole("radio", { name: /qualité/i }).click();
    const issue = page.getByRole("listitem").filter({ hasText: /contraste inférieur/i }).first();
    await expect(issue).toBeVisible({ timeout: 120_000 });
    await issue.getByRole("button", { name: /rendre le texte lisible/i }).click();

    // La correction est appliquée au brouillon (et le problème disparaît de la liste).
    await expect
      .poll(async () => ((await draft()) as { settings?: { colors?: { text?: string } } }).settings?.colors?.text, { timeout: 120_000 })
      .not.toBe("#CFCFCF");
    await expect(page.getByRole("listitem").filter({ hasText: /contraste inférieur/i })).toHaveCount(0);
  });

  test("modèle alternatif de produit : créé et proposé dans le sélecteur de page", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/apparence`);
    await openEditor(page, "product");
    await page.getByRole("button", { name: /modèles .*: gérer les modèles alternatifs/i }).click();
    const dialog = page.getByRole("dialog").filter({ visible: true }).first();
    const field = dialog.getByRole("textbox").first();
    await expect(async () => {
      await field.fill("luxe");
      await expect(field).toHaveValue("luxe", { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await dialog.getByRole("button", { name: /^créer/i }).click();

    await expect.poll(async () => Object.keys(((await draft()).alternates?.product ?? {}) as object), { timeout: 120_000 }).toContain("luxe");
    await expect(page.locator("#template-select")).toHaveValue("product:luxe");
    await expect(page.locator('#template-select option[value="product:luxe"]')).toHaveCount(1);
  });

  test("visibilité par audience : la règle est enregistrée dans le brouillon", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/apparence`);
    await openEditor(page, "home");
    await selectEditableSection(page);
    await page.getByRole("radio", { name: /seulement si/i }).click();

    await expect
      .poll(async () => sectionsOf(await draft(), "home").some((s) => s.visibility?.mode === "show"), { timeout: 120_000 })
      .toBe(true);
    // Repère visible dans la liste des sections.
    await expect(page.getByLabel("visible selon l'audience").first()).toBeVisible();
  });

  test("page de recherche : un réglage de la section « Recherche » se retrouve en vitrine", async ({ page }) => {
    await loginMerchant(page, `/app/${storeId}/apparence`);
    await openEditor(page, "search");
    // Section principale du modèle « Recherche » (obligatoire : son nom porte l'icône « obligatoire »).
    await page.getByRole("button", { name: /^Recherche/ }).first().click();
    const heading = page.getByRole("textbox", { name: /titre de la page/i }).first();
    await expect(async () => {
      await heading.fill(SEARCH_HEADING);
      await expect(heading).toHaveValue(SEARCH_HEADING, { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await expect.poll(async () => JSON.stringify(await draft()).includes(SEARCH_HEADING), { timeout: 120_000 }).toBe(true);
    await publish(page);

    await logout(page);
    await page.goto(`/s/${SLUG}/recherche`);
    await expectNoAppError(page);
    await expect(page.getByRole("heading", { name: SEARCH_HEADING })).toBeVisible();
  });
});

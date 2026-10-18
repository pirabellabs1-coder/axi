"use server";

import { shouldPauseStore } from "@/lib/billing/rules";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { guard, fail, success, zId, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { formatDateTime } from "@/lib/utils";
import { isKnownPreset, SECTOR_PRESETS } from "@/lib/storefront/theme";
import { checkImageWrite } from "@/lib/storage/write-guard";
import { collectReferences, issueKey, MAX_DOCUMENT_BYTES, validateThemeDocument, type ValidationIssue } from "@/lib/theme-engine/validate";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { editorDocument, publishedDocument, starterDocument } from "./bootstrap";
import { canRestoreVersions, canUsePreset, PRESET_UPSELL, themePlanRules, VERSIONS_UPSELL } from "./plan-rules";
import { CORE_MENUS, MAX_CUSTOM_MENUS, MENU_HANDLE_RE, menuTargets, validateMenuItems, menuTitle } from "./menu-schema";
import { listThemeVersions, type ThemeVersionSummary } from "./versions";
import { lot4PlanIssue } from "./editor-plan";
import { decideStoreGoOnline, publishThemeMessage } from "./publish-rules";

/* ───────────── Utilitaires ───────────── */

function revalidateEditor(storeId: string) {
  revalidatePath(`/app/${storeId}/apparence`);
}

function revalidateStorefront(storeId: string, slug: string) {
  revalidateEditor(storeId);
  revalidatePath(`/s/${slug}`, "layout");
}

/** Erreurs de validation → ActionResult avec `fieldErrors` indexés par clé d'éditeur (voir `issueKey`). */
function invalid(errors: ValidationIssue[]): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};
  for (const e of errors) (fieldErrors[issueKey(e.path)] ??= []).push(e.message);
  return fail(errors[0]?.message ?? "Réglages invalides.", fieldErrors);
}

/** Parse + valide un document envoyé par l'éditeur, références vérifiées contre la boutique. */
async function parseDocument(ctx: StoreContext, json: string): Promise<{ doc: ThemeDocument } | { error: ActionResult<never> }> {
  if (typeof json !== "string" || json.length > MAX_DOCUMENT_BYTES) return { error: fail("Le thème est trop volumineux (images trop lourdes ?). Utilisez des liens https pour les grandes images.") };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: fail("Document de thème illisible.") };
  }
  const first = validateThemeDocument(raw);
  if (!first.ok) return { error: invalid(first.errors) };
  const refs = collectReferences(first.doc);
  const storeId = ctx.store.id;
  const [collections, products, menus] = await Promise.all([
    refs.collectionIds.length ? db.category.findMany({ where: { storeId, id: { in: refs.collectionIds } }, select: { id: true } }) : [],
    refs.productIds.length ? db.product.findMany({ where: { storeId, id: { in: refs.productIds } }, select: { id: true } }) : [],
    db.storeMenu.findMany({ where: { storeId }, select: { handle: true } }),
  ]);
  const checked = validateThemeDocument(first.doc, {
    refs: {
      collectionIds: new Set(collections.map((c) => c.id)),
      productIds: new Set(products.map((p) => p.id)),
      menuHandles: new Set([...CORE_MENUS.map((m) => m.handle), ...menus.map((m) => m.handle)]),
    },
  });
  if (!checked.ok) return { error: invalid(checked.errors) };
  // Images : aucune nouvelle data-URL (seulement celles déjà présentes dans le thème publié, le brouillon ou
  // l'ancien format converti par l'éditeur), et les médias téléversés doivent appartenir à la boutique.
  const s = ctx.store;
  const imageIssue = checkImageWrite(checked.doc, { storeId, existing: [s.themeDoc, s.themeDocDraft, s.themeConfig, s.themeDraft, s.logoUrl, s.bannerUrl] });
  if (imageIssue) return { error: fail(imageIssue) };
  const planIssue = lot4PlanIssue(ctx.planId, checked.doc, [publishedDocument(s), editorDocument(s).doc]); if (planIssue) return { error: fail(planIssue) }; // lot 4 (T2)
  return { doc: { ...checked.doc, updatedAt: new Date().toISOString() } };
}

const json = (doc: ThemeDocument) => doc as unknown as Prisma.InputJsonValue;

/** Préréglage « actuel » pour les règles de plan : celui PUBLIÉ (jamais celui du brouillon, modifiable par le client). */
function currentPublishedPreset(store: StoreContext["store"]): string {
  return publishedDocument(store)?.preset ?? store.themeId;
}
const storeIdSchema = zId;

/* ───────────── Brouillon / publication ───────────── */

/** Sauvegarde automatique du brouillon (`themeDocDraft`). La boutique publique ne change pas. */
export async function saveThemeDraft(storeId: string, docJson: string): Promise<ActionResult<{ savedAt: string }>> {
  return guard(async () => {
    if (!storeIdSchema.safeParse(storeId).success) return fail("Boutique invalide.");
    const ctx = await requireStore(storeId, "theme.manage");
    const parsed = await parseDocument(ctx, docJson);
    if ("error" in parsed) return parsed.error;
    if (!canUsePreset(ctx.planId, ctx.store.sector, currentPublishedPreset(ctx.store), parsed.doc.preset)) return fail(PRESET_UPSELL);
    await db.store.update({ where: { id: ctx.store.id }, data: { themeDocDraft: json(parsed.doc) } });
    return success({ savedAt: parsed.doc.updatedAt! });
  });
}

const labelSchema = z.string().trim().max(80, "Nom de version : 80 caractères maximum.").optional();

/** État de mise en ligne renvoyé par `publishTheme` pour que l'éditeur affiche un message juste. */
export type PublishStoreOutcome = {
  /** La boutique est publique (visible des clients) après cette publication. */
  online: boolean;
  /** Elle vient d'être mise en ligne par CETTE publication (était en brouillon). */
  justPublished: boolean;
  /** Prérequis manquants qui empêchent la mise en ligne (boutique encore en brouillon). */
  missing: string[];
  /** Suspendue par la plateforme : la mise en ligne est impossible côté marchand. */
  suspended: boolean;
};

/**
 * Publie : brouillon → `themeDoc`, version ajoutée à l'historique (`ThemeVersion`), anciennes versions élaguées selon le plan.
 * De plus, si la boutique est encore en brouillon (`DRAFT`) et que les prérequis sont réunis (numéro WhatsApp,
 * au moins un produit actif, un moyen de paiement actif), elle est MISE EN LIGNE dans la même transaction —
 * « Publier » rend donc réellement la boutique visible, pas seulement le thème. Sinon le thème est publié et le
 * message indique ce qu'il reste à ajouter.
 */
export async function publishTheme(storeId: string, docJson: string, label?: string): Promise<ActionResult<{ versions: ThemeVersionSummary[]; store: PublishStoreOutcome }>> {
  return guard(async () => {
    if (!storeIdSchema.safeParse(storeId).success) return fail("Boutique invalide.");
    const l = labelSchema.safeParse(label);
    if (!l.success) return fail(l.error.issues[0]?.message ?? "Nom invalide.");
    const ctx = await requireStore(storeId, "theme.manage");
    const parsed = await parseDocument(ctx, docJson);
    if ("error" in parsed) return parsed.error;
    const doc = parsed.doc;
    const current = currentPublishedPreset(ctx.store);
    if (!canUsePreset(ctx.planId, ctx.store.sector, current, doc.preset)) return fail(PRESET_UPSELL);
    const rules = themePlanRules(ctx.planId, ctx.store.sector, current);

    // Mise en ligne de la boutique (si encore en brouillon). Mêmes prérequis que `publishStore`.
    const s = ctx.store;
    const preOnline = s.status === "PUBLISHED" || s.status === "CLOSED_TEMPORARILY";
    // En pause (abonnement), ou sans plan ouvrant droit avant le passage du cron : jamais remise en ligne ici.
    const prePaused = s.status === "PAUSED" || (s.status !== "PUBLISHED" && s.status !== "CLOSED_TEMPORARILY" && !!s.subscription && shouldPauseStore(s.subscription));
    const preSuspended = s.status === "SUSPENDED" || prePaused;
    const [activeProducts, activePaymentMethods] = preOnline || preSuspended
      ? [1, 1] // non pertinent : la boutique est déjà en ligne ou suspendue.
      : await Promise.all([
          db.product.count({ where: { storeId: s.id, status: "ACTIVE" } }),
          db.paymentMethod.count({ where: { storeId: s.id, active: true } }),
        ]);
    const { alreadyOnline, suspended, missing, bringOnline } = decideStoreGoOnline({
      status: prePaused ? "PAUSED" : s.status,
      hasWhatsapp: !!s.whatsappNumber,
      activeProducts,
      activePaymentMethods,
    });

    await db.$transaction(async (tx) => {
      await tx.store.update({
        where: { id: ctx.store.id },
        // Le logo de l'en-tête devient le logo de la boutique (espace marchand, marketplace, reçus).
        data: {
          themeDoc: json(doc),
          themeDocDraft: json(doc),
          logoUrl: doc.settings.header.logo?.url ?? null,
          ...(isKnownPreset(doc.preset) ? { themeId: doc.preset } : {}),
          // Mise en ligne effective de la boutique dans la même transaction.
          ...(bringOnline ? { status: "PUBLISHED" as const, publishedAt: s.publishedAt ?? new Date(), onboardingCompleted: true, onboardingStep: 99, statusReason: null } : {}),
        },
      });
      const v = await tx.themeVersion.create({ data: { storeId: ctx.store.id, label: l.data || null, document: json(doc), publishedAt: new Date(), actorId: ctx.user.id } });
      const stale = await tx.themeVersion.findMany({ where: { storeId: ctx.store.id }, orderBy: { createdAt: "desc" }, skip: rules.versionsKept, select: { id: true } });
      if (stale.length) await tx.themeVersion.deleteMany({ where: { storeId: ctx.store.id, id: { in: stale.map((s) => s.id) } } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.published", target: v.id, metadata: { preset: doc.preset, label: l.data || null } }, tx);
      if (bringOnline) {
        await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "store.published" }, tx);
        await enqueue("store.published", { storeId: ctx.store.id }, { storeId: ctx.store.id }, tx);
      }
    });
    revalidateStorefront(ctx.store.id, ctx.store.slug);
    if (bringOnline) revalidatePath("/marketplace");

    const store: PublishStoreOutcome = { online: alreadyOnline || bringOnline, justPublished: bringOnline, missing, suspended };
    return success({ versions: await listThemeVersions(ctx.store.id), store }, publishThemeMessage({ bringOnline, suspended, missing, paused: prePaused }));
  });
}

/** Abandonne le brouillon : revient au thème publié (ou au thème d'origine). */
export async function discardThemeDraft(storeId: string): Promise<ActionResult<{ doc: ThemeDocument }>> {
  return guard(async () => {
    if (!storeIdSchema.safeParse(storeId).success) return fail("Boutique invalide.");
    const ctx = await requireStore(storeId, "theme.manage");
    const { doc } = editorDocument({ ...ctx.store, themeDocDraft: null });
    await db.store.update({ where: { id: ctx.store.id }, data: { themeDocDraft: json(doc) } });
    revalidateEditor(ctx.store.id);
    return success({ doc }, "Modifications abandonnées : retour à la version publiée");
  });
}

/** Restaure une version publiée dans le brouillon (fonction `advancedEditor`). */
export async function restoreThemeVersion(storeId: string, versionId: string): Promise<ActionResult<{ doc: ThemeDocument }>> {
  return guard(async () => {
    if (!storeIdSchema.safeParse(storeId).success || !zId.safeParse(versionId).success) return fail("Version introuvable.");
    const ctx = await requireStore(storeId, "theme.manage");
    if (!canRestoreVersions(ctx.planId)) return fail(VERSIONS_UPSELL);
    const version = await db.themeVersion.findFirst({ where: { id: versionId, storeId: ctx.store.id } });
    if (!version) return fail("Version introuvable.");
    const v = validateThemeDocument(version.document);
    if (!v.ok) return fail("Cette version n'est plus compatible avec l'éditeur et ne peut pas être restaurée.");
    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: ctx.store.id }, data: { themeDocDraft: json(v.doc) } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.version_restored", target: version.id }, tx);
    });
    revalidateEditor(ctx.store.id);
    return success({ doc: v.doc }, `Version du ${formatDateTime(version.publishedAt ?? version.createdAt)} restaurée dans le brouillon. Publiez pour la mettre en ligne.`);
  });
}

const presetSchema = z.object({ presetId: z.string().max(40), keepContent: z.boolean() });

/**
 * Change le modèle de départ (secteur) du brouillon. Plan Gratuit : 2 modèles (`limits.themes`).
 * `keepContent` conserve logo, menus, réseaux sociaux, pied de page et favicon.
 */
export async function changeThemePreset(storeId: string, presetId: string, keepContent: boolean): Promise<ActionResult<{ doc: ThemeDocument }>> {
  return guard(async () => {
    const p = presetSchema.safeParse({ presetId, keepContent });
    if (!storeIdSchema.safeParse(storeId).success || !p.success) return fail("Modèle inconnu.");
    const ctx = await requireStore(storeId, "theme.manage");
    const preset = SECTOR_PRESETS.find((s) => s.id === p.data.presetId);
    if (!preset) return fail("Modèle inconnu.");
    const current = editorDocument(ctx.store).doc;
    if (!canUsePreset(ctx.planId, ctx.store.sector, currentPublishedPreset(ctx.store), preset.id)) return fail(PRESET_UPSELL);
    const next = starterDocument(preset.id, ctx.store);
    if (p.data.keepContent) {
      const s = current.settings;
      next.settings.header = { ...next.settings.header, logo: s.header.logo, logoWidth: s.header.logoWidth, menu: s.header.menu, announcement: s.header.announcement };
      next.settings.footer = s.footer;
      next.settings.social = s.social;
    }
    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: ctx.store.id }, data: { themeDocDraft: json(next) } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.preset_changed", metadata: { preset: preset.id, keepContent: p.data.keepContent } }, tx);
    });
    revalidateEditor(ctx.store.id);
    return success({ doc: next }, `Modèle « ${preset.name} » appliqué au brouillon. Publiez pour le mettre en ligne.`);
  });
}

/** Masquer « Propulsé par Axi » : fonctionnalité removeBranding (Starter et plus). */
export async function setShowPoweredBy(storeId: string, show: boolean): Promise<ActionResult> {
  return guard(async () => {
    if (!storeIdSchema.safeParse(storeId).success || typeof show !== "boolean") return fail("Requête invalide.");
    const ctx = await requireStore(storeId, "theme.manage");
    if (!show && !PLANS[ctx.planId].features.removeBranding) return fail("Masquer le logo Axi est inclus à partir du plan Starter.");
    await db.store.update({ where: { id: ctx.store.id }, data: { showPoweredBy: show } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.branding_changed", metadata: { showPoweredBy: show } });
    revalidateStorefront(ctx.store.id, ctx.store.slug);
    return success(undefined, show ? "Logo Axi affiché" : "Logo Axi masqué");
  });
}

/* ───────────── Menus ───────────── */

function revalidateMenus(storeId: string, slug: string) {
  revalidatePath(`/app/${storeId}/navigation`);
  revalidateStorefront(storeId, slug);
}

const handleSchema = z.string().regex(MENU_HANDLE_RE, "Identifiant de menu : minuscules, chiffres et tirets (40 caractères maximum).");

/** Enregistre les éléments d'un menu (création si absent). Cibles vérifiées : elles doivent appartenir à la boutique. */
export async function saveMenu(storeId: string, handle: string, itemsJson: string): Promise<ActionResult> {
  return guard(async () => {
    const h = handleSchema.safeParse(handle);
    if (!storeIdSchema.safeParse(storeId).success || !h.success) return fail("Menu invalide.");
    if (typeof itemsJson !== "string" || itemsJson.length > 200_000) return fail("Menu trop volumineux.");
    const ctx = await requireStore(storeId, "theme.manage");
    let raw: unknown;
    try {
      raw = JSON.parse(itemsJson);
    } catch {
      return fail("Menu illisible.");
    }
    const first = validateMenuItems(raw);
    if (!first.ok) return fail(first.error);
    const t = menuTargets(first.items);
    const sid = ctx.store.id;
    const [collections, products, pages] = await Promise.all([
      t.collectionIds.length ? db.category.findMany({ where: { storeId: sid, id: { in: t.collectionIds } }, select: { id: true } }) : [],
      t.productIds.length ? db.product.findMany({ where: { storeId: sid, id: { in: t.productIds } }, select: { id: true } }) : [],
      t.pageIds.length ? db.storePage.findMany({ where: { storeId: sid, id: { in: t.pageIds } }, select: { id: true } }) : [],
    ]);
    const checked = validateMenuItems(first.items, {
      collectionIds: new Set(collections.map((c) => c.id)),
      productIds: new Set(products.map((p) => p.id)),
      pageIds: new Set(pages.map((p) => p.id)),
    });
    if (!checked.ok) return fail(checked.error);
    const isCore = CORE_MENUS.some((m) => m.handle === h.data);
    if (!isCore) {
      const exists = await db.storeMenu.findUnique({ where: { storeId_handle: { storeId: sid, handle: h.data } }, select: { id: true } });
      if (!exists) return fail("Menu introuvable.");
    }
    const items = checked.items as unknown as Prisma.InputJsonValue;
    await db.storeMenu.upsert({ where: { storeId_handle: { storeId: sid, handle: h.data } }, create: { storeId: sid, handle: h.data, items }, update: { items } });
    await audit({ storeId: sid, actorId: ctx.user.id, action: "theme.menu_saved", target: h.data, metadata: { items: checked.items.length } });
    revalidateMenus(sid, ctx.store.slug);
    return success(undefined, `« ${menuTitle(h.data)} » enregistré`);
  });
}

/** Crée un menu supplémentaire (ex. « legal », « aide »). */
export async function createMenu(storeId: string, handle: string): Promise<ActionResult<{ handle: string }>> {
  return guard(async () => {
    const h = handleSchema.safeParse(handle);
    if (!storeIdSchema.safeParse(storeId).success) return fail("Boutique invalide.");
    if (!h.success) return fail(h.error.issues[0]?.message ?? "Identifiant invalide.", { handle: [h.error.issues[0]?.message ?? "Identifiant invalide."] });
    const ctx = await requireStore(storeId, "theme.manage");
    const sid = ctx.store.id;
    if (CORE_MENUS.some((m) => m.handle === h.data)) return fail("Ce menu existe déjà.", { handle: ["Ce menu existe déjà."] });
    const custom = await db.storeMenu.count({ where: { storeId: sid, handle: { notIn: CORE_MENUS.map((m) => m.handle) } } });
    if (custom >= MAX_CUSTOM_MENUS) return fail(`${MAX_CUSTOM_MENUS} menus supplémentaires maximum.`);
    const exists = await db.storeMenu.findUnique({ where: { storeId_handle: { storeId: sid, handle: h.data } }, select: { id: true } });
    if (exists) return fail("Ce menu existe déjà.", { handle: ["Ce menu existe déjà."] });
    await db.storeMenu.create({ data: { storeId: sid, handle: h.data, items: [] } });
    await audit({ storeId: sid, actorId: ctx.user.id, action: "theme.menu_created", target: h.data });
    revalidateMenus(sid, ctx.store.slug);
    return success({ handle: h.data }, "Menu créé");
  });
}

/** Supprime un menu supplémentaire (les menus principal et pied de page sont seulement vidables). */
export async function deleteMenu(storeId: string, handle: string): Promise<ActionResult> {
  return guard(async () => {
    const h = handleSchema.safeParse(handle);
    if (!storeIdSchema.safeParse(storeId).success || !h.success) return fail("Menu invalide.");
    if (CORE_MENUS.some((m) => m.handle === h.data)) return fail("Ce menu ne peut pas être supprimé : videz-le si vous ne l'utilisez pas.");
    const ctx = await requireStore(storeId, "theme.manage");
    const res = await db.storeMenu.deleteMany({ where: { storeId: ctx.store.id, handle: h.data } });
    if (!res.count) return fail("Menu introuvable.");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.menu_deleted", target: h.data });
    revalidateMenus(ctx.store.id, ctx.store.slug);
    return success(undefined, "Menu supprimé");
  });
}

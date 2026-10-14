import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { isStoredMediaUrl } from "@/lib/storage/public-url";
import { SECTOR_PRESETS } from "@/lib/storefront/theme";
import { editorDocument, publishedDocument } from "@/lib/theme/bootstrap";
import { themePlanRules } from "@/lib/theme/plan-rules";
import { CORE_MENUS, menuTitle } from "@/lib/theme/menu-schema";
import { listThemeVersions } from "@/lib/theme/versions";
import { ThemeEditor } from "@/components/theme-editor/theme-editor";
import { loadEditorLot4 } from "./lot4-data";

export const metadata: Metadata = { title: "Personnaliser la boutique" };

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const url = (images[0] as { url?: unknown } | undefined)?.url;
  return typeof url === "string" && (url.startsWith("https://") || url.startsWith("/")) ? url : null;
}

export default async function AppearancePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "theme.manage");
  const store = ctx.store;
  const { doc, recovered } = editorDocument(store);
  const rules = themePlanRules(ctx.planId, store.sector, publishedDocument(store)?.preset ?? doc.preset);

  const [collections, products, pages, menus, blogCategories, versions, lot4] = await Promise.all([
    db.category.findMany({ where: { storeId: store.id }, orderBy: { position: "asc" }, select: { id: true, name: true, slug: true, imageUrl: true } }),
    db.product.findMany({ where: { storeId: store.id, status: { not: "ARCHIVED" } }, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take: 500, select: { id: true, name: true, slug: true, images: true } }),
    db.storePage.findMany({ where: { storeId: store.id }, orderBy: { position: "asc" }, select: { id: true, title: true, slug: true } }),
    db.storeMenu.findMany({ where: { storeId: store.id }, select: { handle: true } }),
    db.blogCategory.findMany({ where: { storeId: store.id }, orderBy: { position: "asc" }, take: 200, select: { slug: true, name: true } }),
    listThemeVersions(store.id),
    loadEditorLot4(store, ctx.planId),
  ]);

  const menuHandles = [...new Set([...CORE_MENUS.map((m) => m.handle), ...menus.map((m) => m.handle)])];

  return (
    <ThemeEditor
      storeId={store.id}
      storeName={store.name}
      slug={store.slug}
      storeOnline={store.status === "PUBLISHED" || store.status === "CLOSED_TEMPORARILY"}
      initialDoc={doc}
      publishedDoc={publishedDocument(store)}
      recovered={recovered}
      resources={{
        storeId: store.id,
        collections: collections.map((c) => ({ ...c, imageUrl: c.imageUrl?.startsWith("https://") || (c.imageUrl && isStoredMediaUrl(c.imageUrl)) ? c.imageUrl : null })),
        products: products.map((p) => ({ id: p.id, name: p.name, slug: p.slug, imageUrl: firstImage(p.images) })),
        pages,
        menus: menuHandles.map((h) => ({ handle: h, title: menuTitle(h) })),
        blogCategories,
      }}
      presets={SECTOR_PRESETS.map((s) => ({ id: s.id, name: s.name, description: s.description, primary: s.config.primary, accent: s.config.accent, allowed: rules.allowedPresets.includes(s.id) }))}
      presetLimit={rules.presetLimit}
      versionHistory={rules.versionHistory}
      versions={versions}
      showPoweredBy={store.showPoweredBy}
      canRemoveBranding={rules.removeBranding}
      lot4={lot4}
    />
  );
}

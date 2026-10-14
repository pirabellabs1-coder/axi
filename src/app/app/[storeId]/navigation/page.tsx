import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { CORE_MENUS, menuTitle, readMenuItems } from "@/lib/theme/menu-schema";
import { MenusManager } from "./menus-manager";

export const metadata: Metadata = { title: "Navigation" };

export default async function NavigationPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ menu?: string }> }) {
  const { storeId } = await params;
  const { menu } = await searchParams;
  const ctx = await getStoreContext(storeId, "theme.manage");
  const sid = ctx.store.id;

  const [rows, collections, products, pages] = await Promise.all([
    db.storeMenu.findMany({ where: { storeId: sid }, select: { handle: true, items: true, updatedAt: true } }),
    db.category.findMany({ where: { storeId: sid }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    db.product.findMany({ where: { storeId: sid, status: { not: "ARCHIVED" } }, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take: 500, select: { id: true, name: true } }),
    db.storePage.findMany({ where: { storeId: sid }, orderBy: { position: "asc" }, select: { id: true, title: true } }),
  ]);

  const byHandle = new Map(rows.map((r) => [r.handle, r]));
  const core = CORE_MENUS.map((m) => ({ handle: m.handle, title: m.title, description: m.description, core: true, items: readMenuItems(byHandle.get(m.handle)?.items) }));
  const custom = rows
    .filter((r) => !CORE_MENUS.some((m) => m.handle === r.handle))
    .sort((a, b) => a.handle.localeCompare(b.handle))
    .map((r) => ({ handle: r.handle, title: menuTitle(r.handle), description: "Menu supplémentaire, à afficher dans le pied de page.", core: false, items: readMenuItems(r.items) }));
  const menus = [...core, ...custom];

  return (
    <>
      <PageHeader
        title="Navigation"
        description="Organisez les menus de votre boutique : en-tête, pied de page et menus supplémentaires. Glissez les éléments pour les réordonner, sur deux niveaux."
      />
      <MenusManager
        storeId={sid}
        menus={menus}
        initialHandle={menus.some((m) => m.handle === menu) ? menu! : "main"}
        targets={{
          collection: collections.map((c) => ({ id: c.id, label: c.name })),
          product: products.map((p) => ({ id: p.id, label: p.name })),
          page: pages.map((p) => ({ id: p.id, label: p.title })),
        }}
      />
    </>
  );
}

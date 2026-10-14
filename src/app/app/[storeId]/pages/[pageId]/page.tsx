import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { PageEditor } from "../page-editor";
import { MetafieldsEditor } from "@/components/app/metafields-editor";

export const metadata: Metadata = { title: "Modifier la page" };

export default async function EditPagePage({ params }: { params: Promise<{ storeId: string; pageId: string }> }) {
  const { storeId, pageId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const page = await db.storePage.findFirst({ where: { id: pageId, storeId: ctx.store.id } });
  if (!page) notFound();
  return (
    <>
      <PageHeader title={page.title} back={{ href: `/app/${ctx.store.id}/pages`, label: "Pages" }} />
      <PageEditor storeId={ctx.store.id} storeSlug={ctx.store.slug} page={{ id: page.id, title: page.title, slug: page.slug, body: page.body, published: page.published }} />
      <MetafieldsEditor storeId={ctx.store.id} ownerType="PAGE" ownerId={page.id} />
    </>
  );
}

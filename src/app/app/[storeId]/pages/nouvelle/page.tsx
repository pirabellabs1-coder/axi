import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { PAGE_TEMPLATES } from "@/lib/pages/constants";
import { PageHeader } from "@/components/ui/misc";
import { PageEditor } from "../page-editor";

export const metadata: Metadata = { title: "Nouvelle page" };

export default async function NewPagePage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "store.settings");
  const limit = PLANS[ctx.planId].limits.customPages;
  if (limit !== null) {
    const count = await db.storePage.count({ where: { storeId: ctx.store.id } });
    if (count >= limit) redirect(`/app/${ctx.store.id}/pages`);
  }
  const tpl = PAGE_TEMPLATES.find((t) => t.slug === sp.modele);
  return (
    <>
      <PageHeader title="Nouvelle page" back={{ href: `/app/${ctx.store.id}/pages`, label: "Pages" }} />
      <PageEditor storeId={ctx.store.id} storeSlug={ctx.store.slug} page={{ title: tpl?.title ?? "", slug: tpl?.slug ?? "", body: tpl?.body ?? "", published: true }} />
    </>
  );
}

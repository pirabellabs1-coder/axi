import type { Metadata } from "next";
import { Plus, LayoutGrid } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { describeRules, readRules, readSortOrder, resolveCollection, SORT_LABELS } from "@/lib/collections/rules";
import { thumbUrl } from "@/lib/image-loader";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { SortableCollectionList } from "./sortable-collection-list";

export const metadata: Metadata = { title: "Collections" };

export default async function CollectionsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "products.manage");
  const sid = ctx.store.id;
  const base = `/app/${sid}/collections`;
  const [cols, products] = await Promise.all([
    db.category.findMany({ where: { storeId: sid }, orderBy: [{ position: "asc" }, { name: "asc" }] }),
    db.product.findMany({
      where: { storeId: sid, status: "ACTIVE" },
      select: { id: true, name: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, compareAtPrice: true, tags: true, productType: true, vendor: true, categoryId: true, images: true, variants: { select: { price: true, compareAtPrice: true } } },
      take: 2000,
    }),
  ]);
  const rows = cols.map((c) => {
    const rules = readRules(c.rules);
    const members = resolveCollection(c.id, rules, "manual", products);
    const firstImg = members.map((m) => (Array.isArray(m.images) ? (m.images as { url?: string }[])[0]?.url : undefined)).find(Boolean);
    return { c, rules, count: members.length, image: c.imageUrl ?? firstImg ?? null };
  });

  const add = (
    <ButtonLink href={`${base}/nouvelle`} variant="primary">
      <Plus className="size-4" aria-hidden /> Créer une collection
    </ButtonLink>
  );

  return (
    <div>
      <PageHeader title="Collections" description="Regroupez vos produits pour la navigation de la boutique : manuellement, ou automatiquement par étiquette, prix, promotion ou titre." actions={add} />
      {rows.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="Aucune collection" description="Créez par exemple « Nouveautés », « Wax » ou « Moins de 10 000 F » : vos clients trouvent plus vite ce qu'ils cherchent." action={add} />
      ) : (
        <SortableCollectionList
          storeId={sid}
          rows={rows.map(({ c, rules, count, image }) => ({
            id: c.id,
            name: c.name,
            href: `${base}/${c.id}`,
            image: image ? thumbUrl(image, 120) : null,
            auto: rules.type === "auto",
            rulesLabel: rules.type === "auto" ? describeRules(rules) : "Manuelle",
            sortLabel: SORT_LABELS[readSortOrder(c.sortOrder)],
            count,
            published: c.published,
          }))}
        />
      )}
    </div>
  );
}

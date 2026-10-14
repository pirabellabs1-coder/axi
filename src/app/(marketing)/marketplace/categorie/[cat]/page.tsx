import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Store } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { MEDIA, unsplash } from "@/config/media";
import { SITE } from "@/config/site";
import { CollectionView } from "@/components/marketplace/collection-view";
import { JsonLd } from "@/components/marketplace/parts";
import { MARKETPLACE_CATEGORIES, categoryBySlug } from "@/lib/marketplace/categories";
import { getCollection } from "@/lib/marketplace/data";
import { searchHref } from "@/lib/marketplace/query";

export const dynamic = "force-dynamic";

type Params = Promise<{ cat: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const cat = categoryBySlug((await params).cat);
  if (!cat) return { title: "Catégorie introuvable" };
  return {
    title: `${cat.label} | Marketplace`,
    description: `${cat.description} Boutiques et produits sur la marketplace Axi, commande sur WhatsApp.`,
    alternates: { canonical: `/marketplace/categorie/${cat.slug}` },
    openGraph: { title: `${cat.label} sur Axi`, description: cat.description, images: [{ url: unsplash(MEDIA[cat.media].id, 1200, 630), width: 1200, height: 630 }] },
  };
}

export default async function CategoryPage({ params }: { params: Params }) {
  const cat = categoryBySlug((await params).cat);
  if (!cat) notFound();

  let data: Awaited<ReturnType<typeof getCollection>> | null = null;
  try {
    data = await getCollection({ cat: cat.slug }, { stores: 9, products: 12 });
  } catch (e) {
    console.error("[marketplace/categorie]", e);
  }

  if (!data) {
    return (
      <div className="container-x py-20">
        <EmptyState icon={Store} title="Cette page est momentanément indisponible" description="Nos serveurs rencontrent un souci temporaire. Réessayez dans quelques instants." action={<ButtonLink href={`/marketplace/categorie/${cat.slug}`} variant="outline">Réessayer</ButtonLink>} />
      </div>
    );
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: cat.label,
    itemListElement: data.stores.map((s, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/s/${s.slug}`, name: s.name })),
  };

  return (
    <>
      <CollectionView
        crumb={cat.short}
        title={cat.label}
        description={cat.description}
        media={cat.media}
        chips={MARKETPLACE_CATEGORIES.map((c) => ({ href: `/marketplace/categorie/${c.slug}`, label: c.short, active: c.slug === cat.slug }))}
        data={data}
        storesHref={searchHref({ cat: cat.slug, onglet: "boutiques" })}
        productsHref={searchHref({ cat: cat.slug })}
        emptyTitle="Pas encore de boutique dans cette catégorie"
        emptyDescription="Les premières boutiques arrivent. Découvrez les autres catégories ou ouvrez la vôtre."
      />
      {data.stores.length > 0 && <JsonLd data={jsonLd} />}
    </>
  );
}

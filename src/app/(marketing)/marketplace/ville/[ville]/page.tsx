import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Store } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { getCountry, SITE } from "@/config/site";
import { CollectionView } from "@/components/marketplace/collection-view";
import { JsonLd } from "@/components/marketplace/parts";
import { MARKETPLACE_CATEGORIES, citySlug } from "@/lib/marketplace/categories";
import { getCollection, resolveCity } from "@/lib/marketplace/data";
import { searchHref } from "@/lib/marketplace/query";
import type { CityCount } from "@/lib/marketplace/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ ville: string }>;

async function findCity(raw: string): Promise<CityCount | null | "error"> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // URL malformée : 404
  }
  const slug = citySlug(decoded);
  if (!slug) return null;
  try {
    return await resolveCity(slug);
  } catch (e) {
    console.error("[marketplace/ville]", e);
    return "error";
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const city = await findCity((await params).ville);
  if (!city || city === "error") return { title: "Ville | Marketplace" };
  return {
    title: `Boutiques à ${city.city} | Marketplace`,
    description: `Les boutiques de ${city.city} sur Axi : restauration, mode, beauté, téléphonie. Commandez sur WhatsApp, en livraison ou en retrait.`,
    alternates: { canonical: `/marketplace/ville/${city.slug}` },
  };
}

export default async function CityPage({ params }: { params: Params }) {
  const city = await findCity((await params).ville);
  if (city === null) notFound();

  let data: Awaited<ReturnType<typeof getCollection>> | null = null;
  if (city !== "error") {
    try {
      data = await getCollection({ ville: city.city }, { stores: 9, products: 12 });
    } catch (e) {
      console.error("[marketplace/ville]", e);
    }
  }

  if (city === "error" || !data) {
    return (
      <div className="container-x py-20">
        <EmptyState icon={Store} title="Cette page est momentanément indisponible" description="Nos serveurs rencontrent un souci temporaire. Réessayez dans quelques instants." action={<ButtonLink href="/marketplace" variant="outline">Retour à la marketplace</ButtonLink>} />
      </div>
    );
  }

  const country = getCountry(city.country).name;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Boutiques à ${city.city}`,
    itemListElement: data.stores.map((s, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/s/${s.slug}`, name: s.name })),
  };

  return (
    <>
      <CollectionView
        crumb={city.city}
        title={`Boutiques à ${city.city}`}
        description={`Les commerçants de ${city.city} (${country}) qui prennent vos commandes sur WhatsApp, en livraison ou en retrait.`}
        media="delivery"
        chips={MARKETPLACE_CATEGORIES.map((c) => ({ href: searchHref({ ville: city.city, cat: c.slug }), label: c.short }))}
        data={data}
        storesHref={searchHref({ ville: city.city, onglet: "boutiques" })}
        productsHref={searchHref({ ville: city.city })}
        emptyTitle={`Pas encore de boutique à ${city.city}`}
        emptyDescription="Les premières boutiques arrivent. Découvrez les autres villes ou ouvrez la vôtre."
      />
      {data.stores.length > 0 && <JsonLd data={jsonLd} />}
    </>
  );
}

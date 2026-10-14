import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, MapPin, Store } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { MEDIA, unsplash } from "@/config/media";
import { SITE } from "@/config/site";
import { CategoryTile } from "@/components/marketplace/category-tile";
import { JsonLd, MerchantCta, SectionHeading } from "@/components/marketplace/parts";
import { ProductCard } from "@/components/marketplace/product-card";
import { Rail } from "@/components/marketplace/rail";
import { RevealScope } from "@/components/marketplace/reveal-scope";
import { SearchBar } from "@/components/marketplace/search-bar";
import { StoreCard, StoreRow } from "@/components/marketplace/store-card";
import { MARKETPLACE_CATEGORIES } from "@/lib/marketplace/categories";
import { getCategoryCounts, getCities, getFeaturedStores, getMarketplaceStats, getNewStores, getPromoProducts, getTrendingProducts } from "@/lib/marketplace/data";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace : boutiques et produits près de chez vous",
  description: "Découvrez les boutiques indépendantes sur Axi : pâtisseries, mode, beauté, téléphonie. Cherchez par produit, ville ou catégorie, puis commandez en ligne ou par WhatsApp, avec livraison ou retrait.",
  alternates: { canonical: "/marketplace" },
  openGraph: {
    title: "Marketplace Axi : achetez local, livré ou à retirer",
    description: "Les boutiques de votre ville, leurs produits et leurs prix, au même endroit. Mobile Money, carte ou espèces à la livraison.",
    images: [{ url: unsplash(MEDIA.market.id, 1200, 630), width: 1200, height: 630, alt: MEDIA.market.alt }],
  },
};

const nf = new Intl.NumberFormat("fr-FR");

async function loadHome() {
  const [stats, featured, newStores, trending, promos, cities, counts] = await Promise.all([
    getMarketplaceStats(),
    getFeaturedStores(10),
    getNewStores(6),
    getTrendingProducts(10),
    getPromoProducts(8),
    getCities(8),
    getCategoryCounts(),
  ]);
  return { stats, featured, newStores, trending, promos, cities, counts };
}

export default async function MarketplacePage() {
  let data: Awaited<ReturnType<typeof loadHome>> | null = null;
  try {
    data = await loadHome();
  } catch (e) {
    console.error("[marketplace]", e);
  }

  if (!data) {
    return (
      <div data-mk className="container-x py-16 md:py-24">
        <Hero cities={[]} stats={null} spotlight={null} />
        <EmptyState
          className="mt-12"
          icon={Store}
          title="La marketplace ne répond pas"
          description="Nos serveurs rencontrent un souci temporaire. Réessayez dans quelques instants."
          action={
            <ButtonLink href="/marketplace" variant="outline">
              Réessayer
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const { stats, featured, newStores, trending, promos, cities, counts } = data;
  const categories = [...MARKETPLACE_CATEGORIES].sort((a, b) => (counts[b.slug] ?? 0) - (counts[a.slug] ?? 0));
  const isEmpty = stats.stores === 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Produits tendance sur la marketplace Axi",
    itemListElement: trending.products.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE.url}/s/${p.store.slug}/p/${p.slug}`,
      name: p.name,
    })),
  };

  return (
    <div data-mk>
      <Hero cities={cities} stats={stats} spotlight={trending.products.find((p) => p.image) ?? null} />

      {/* Catégories : bento à cellules exactes (1 grande, 1 large, 6 petites) */}
      <section aria-labelledby="mk-cats" className="container-x py-16 md:py-24">
        <SectionHeading id="mk-cats" title="Parcourir par catégorie" />
        <div className="grid auto-rows-[150px] grid-cols-2 gap-3 sm:auto-rows-[180px] md:grid-cols-4 md:gap-4">
          {categories.map((c, i) => (
            <CategoryTile
              key={c.slug}
              category={c}
              count={counts[c.slug]}
              size={i === 0 ? "lg" : "sm"}
              className={cn("reveal", i === 0 && "col-span-2 row-span-2", i === 1 && "col-span-2")}
              sizes={i === 0 ? "(max-width: 768px) 100vw, 50vw" : i === 1 ? "(max-width: 768px) 100vw, 50vw" : "(max-width: 768px) 50vw, 25vw"}
            />
          ))}
        </div>
      </section>

      {isEmpty ? (
        <section className="container-x pb-8">
          <EmptyState
            icon={Store}
            title="Les premières boutiques arrivent"
            description="La marketplace se remplit au fil des publications. Ouvrez votre boutique et soyez parmi les premières à y figurer."
            action={
              <ButtonLink href="/inscription" variant="primary" trailing>
                Ouvrir ma boutique
              </ButtonLink>
            }
          />
        </section>
      ) : (
        <>
          {featured.length > 0 && (
            <section aria-labelledby="mk-featured" className="overflow-hidden py-4 md:py-8">
              <div className="container-x">
                <SectionHeading
                  id="mk-featured"
                  title="Boutiques à la une"
                  description="Des commerçants sélectionnés pour la qualité de leur catalogue et de leur accueil."
                  href="/marketplace/recherche?onglet=boutiques"
                  hrefLabel="Toutes les boutiques"
                  withRailControls
                />
                <Rail label="Boutiques à la une" itemClassName="w-[82vw] max-w-[380px] sm:w-[340px] lg:w-[380px]">
                  {featured.map((s, i) => (
                    <StoreCard key={s.id} store={s} priority={i < 2} sizes="(max-width: 640px) 82vw, 380px" />
                  ))}
                </Rail>
              </div>
            </section>
          )}

          {trending.products.length > 0 && (
            <section aria-labelledby="mk-trending" className="container-x py-16 md:py-24">
              <SectionHeading
                id="mk-trending"
                title={trending.fromOrders ? "Produits tendance" : "Sélection du moment"}
                description={trending.fromOrders ? "Les plus commandés ces 30 derniers jours." : "Les produits mis en avant par les boutiques."}
                href="/marketplace/recherche"
                hrefLabel="Tous les produits"
              />
              <ul className="grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-3 lg:grid-cols-5">
                {trending.products.map((p, i) => (
                  <li key={p.id} className="reveal" style={{ transitionDelay: `${(i % 5) * 60}ms` }}>
                    <ProductCard product={p} sizes="(max-width: 768px) 48vw, (max-width: 1024px) 31vw, 19vw" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {promos.length > 0 && (
            <section aria-labelledby="mk-promos" className="py-4 md:py-8">
              <div className="container-x">
                <div className="overflow-hidden rounded-[var(--radius-2xl)] bg-surface-2 px-4 pb-6 pt-8 ring-1 ring-line sm:px-8 md:pt-10">
                  <SectionHeading id="mk-promos" title="Les bonnes affaires" description="Promotions en cours, prix fixés par chaque boutique." href="/marketplace/recherche?tri=prix-croissant" hrefLabel="Voir les prix" withRailControls />
                  <Rail label="Produits en promotion" itemClassName="w-[44vw] max-w-[230px] sm:w-[220px]">
                    {promos.map((p) => (
                      <ProductCard key={p.id} product={p} sizes="230px" />
                    ))}
                  </Rail>
                </div>
              </div>
            </section>
          )}

          {(cities.length > 0 || newStores.length > 0) && (
            <section aria-labelledby="mk-near" className="container-x py-16 md:py-24">
              <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
                <div>
                  <h2 id="mk-near" className="text-h2 font-semibold text-ink">
                    Près de chez vous
                  </h2>
                  <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-muted">Choisissez votre ville pour voir les boutiques qui livrent ou vous accueillent à côté.</p>
                  {cities.length > 0 && (
                    <ul className="mt-7 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                      {cities.map((c) => (
                        <li key={c.slug}>
                          <Link
                            href={`/marketplace/ville/${c.slug}`}
                            className="group flex min-h-14 items-center gap-3 rounded-[var(--radius-md)] bg-surface px-4 ring-1 ring-line transition-[transform,box-shadow] duration-300 ease-spring hover:-translate-y-px hover:shadow-[var(--shadow-card)]"
                          >
                            <MapPin className="size-[18px] text-primary" aria-hidden />
                            <span className="flex-1 font-medium text-ink">{c.city}</span>
                            <span className="text-sm text-ink-muted tabular">
                              {c.stores} {c.stores > 1 ? "boutiques" : "boutique"}
                            </span>
                            <ArrowUpRight className="size-4 text-ink-faint transition-transform duration-300 ease-spring group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {newStores.length > 0 && (
                  <div className="bezel reveal">
                    <div className="bezel-core p-3 sm:p-5">
                      <h3 className="px-2.5 pb-2 pt-1 text-lg font-semibold text-ink">Nouvelles boutiques</h3>
                      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {newStores.map((s) => (
                          <li key={s.id}>
                            <StoreRow store={s} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      <MerchantCta />
      {trending.products.length > 0 && <JsonLd data={jsonLd} />}
      <RevealScope />
    </div>
  );
}

/* ───────────── Hero ───────────── */

function Hero({
  cities,
  stats,
  spotlight,
}: {
  cities: { city: string; slug: string }[];
  stats: { stores: number; products: number; cities: number } | null;
  spotlight: Awaited<ReturnType<typeof getTrendingProducts>>["products"][number] | null;
}) {
  const photo = MEDIA.market;
  const chips = cities.length
    ? cities.slice(0, 5).map((c) => ({ href: `/marketplace/ville/${c.slug}`, label: c.city, icon: true }))
    : MARKETPLACE_CATEGORIES.slice(0, 4).map((c) => ({ href: `/marketplace/categorie/${c.slug}`, label: c.short, icon: false }));

  return (
    <section aria-labelledby="mk-hero" className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] bg-[radial-gradient(60%_60%_at_15%_0%,var(--color-primary-soft),transparent_65%)]" />
      <div className="container-x grid grid-cols-1 items-center gap-10 pb-6 pt-8 md:pt-14 lg:grid-cols-[1.08fr_1fr] lg:gap-14 lg:pt-20">
        <div className="relative z-20">
          <h1 id="mk-hero" className="animate-fade-up text-[clamp(2.3rem,4.4vw,3.9rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-ink">
            Achetez local. <span className="text-ink-muted">Livré ou à retirer.</span>
          </h1>
          <p className="mt-5 max-w-lg animate-fade-up text-[17px] leading-relaxed text-ink-muted [animation-delay:80ms]">
            Les boutiques de votre ville, leurs produits et leurs prix. Commandez en ligne ou par WhatsApp, payez en Mobile Money, par carte ou à la livraison.
          </p>
          <SearchBar className="mt-8 animate-fade-up [animation-delay:160ms]" />
          {chips.length > 0 && (
            <div className="mt-5 flex animate-fade-up flex-wrap items-center gap-2 [animation-delay:220ms]">
              <span className="mr-1 text-sm text-ink-muted">{cities.length ? "Villes :" : "Populaires :"}</span>
              {chips.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-sm font-medium text-ink ring-1 ring-line transition-[transform,box-shadow] duration-300 ease-spring hover:-translate-y-px hover:shadow-[var(--shadow-card)] active:scale-[0.97]"
                >
                  {c.icon && <MapPin className="size-3.5 text-primary" aria-hidden />}
                  {c.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bezel relative animate-fade-up [animation-delay:120ms]">
          <div className="bezel-core relative aspect-[16/11] overflow-hidden sm:aspect-[5/4] lg:aspect-[4/4.3]">
            <Image src={unsplash(photo.id, 1200, 1300)} alt={photo.alt} fill priority sizes="(max-width: 1024px) 100vw, 46vw" className="object-cover" />
            <div aria-hidden className="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent" />
          </div>

          {stats && stats.stores > 0 && (
            <dl className="absolute bottom-4 left-4 right-4 grid grid-cols-3 gap-1 rounded-[var(--radius-md)] bg-surface/95 p-3 shadow-[var(--shadow-lg)] ring-1 ring-line sm:bottom-6 sm:left-6 sm:right-auto sm:gap-4 sm:px-5">
              <Stat label={stats.stores > 1 ? "boutiques" : "boutique"} value={stats.stores} />
              <Stat label={stats.products > 1 ? "produits" : "produit"} value={stats.products} />
              <Stat label={stats.cities > 1 ? "villes" : "ville"} value={stats.cities} />
            </dl>
          )}

          {spotlight && (
            <Link
              href={`/s/${spotlight.store.slug}/p/${spotlight.slug}`}
              className="absolute right-4 top-4 hidden w-56 items-center gap-3 rounded-[var(--radius-md)] bg-surface p-2.5 pr-4 shadow-[var(--shadow-lg)] ring-1 ring-line transition-transform duration-500 ease-spring hover:-translate-y-1 sm:flex xl:-right-6 xl:top-8"
            >
              <span className="relative size-14 shrink-0 overflow-hidden rounded-[10px] bg-surface-2">
                {spotlight.image?.url.startsWith("https://") ? (
                  <Image src={spotlight.image.url} alt="" fill sizes="56px" className="object-cover" />
                ) : spotlight.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={spotlight.image.url} alt="" className="size-full object-cover" />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-ink">{spotlight.name}</span>
                <span className="block truncate text-xs text-ink-muted">{spotlight.store.name}</span>
                <span className="mt-0.5 block text-[13px] font-semibold text-primary tabular">{formatMoney(spotlight.price, spotlight.currency)}</span>
              </span>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center sm:text-left">
      <dt className="sr-only">{label}</dt>
      <dd className="text-xl font-semibold leading-none tracking-[-0.03em] text-ink tabular sm:text-2xl">{nf.format(value)}</dd>
      <dd aria-hidden className="mt-1 text-xs text-ink-muted">
        {label}
      </dd>
    </div>
  );
}

import Image from "next/image";
import Link from "next/link";
import { Store } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { MEDIA, unsplash } from "@/config/media";
import type { StoreCardData, ProductCardData } from "@/lib/marketplace/types";
import { cn } from "@/lib/utils";
import { Breadcrumbs, MerchantCta, SectionHeading } from "./parts";
import { ProductCard } from "./product-card";
import { RevealScope } from "./reveal-scope";
import { StoreCard } from "./store-card";

const nf = new Intl.NumberFormat("fr-FR");

/** Gabarit commun aux pages catégorie et ville : héros photo, liens rapides, boutiques, produits. */
export function CollectionView({
  crumb,
  title,
  description,
  media,
  chips,
  data,
  storesHref,
  productsHref,
  emptyTitle,
  emptyDescription,
}: {
  crumb: string;
  title: string;
  description: string;
  media: keyof typeof MEDIA;
  chips: { href: string; label: string; active?: boolean }[];
  data: { stores: StoreCardData[]; storeTotal: number; products: ProductCardData[]; productTotal: number };
  storesHref: string;
  productsHref: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const m = MEDIA[media];
  return (
    <div data-mk>
      <section aria-labelledby="mk-col-title" className="container-x pt-4 md:pt-8">
        <div className="relative isolate flex min-h-[320px] flex-col justify-end overflow-hidden rounded-[var(--radius-2xl)] bg-forest md:min-h-[420px]">
          <Image src={unsplash(m.id, 1600, 800)} alt={m.alt} fill priority sizes="(max-width: 1280px) 100vw, 1280px" className="-z-10 object-cover" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-linear-to-t from-forest-deep/95 via-forest-deep/45 to-forest-deep/10" />
          <div className="p-6 sm:p-10 lg:p-14">
            <div className="text-white/80 [&_a:hover]:text-white [&_a]:text-white/80 [&_span[aria-current]]:text-white [&_svg]:text-white/50">
              <Breadcrumbs items={[{ href: "/marketplace", label: "Marketplace" }, { label: crumb }]} />
            </div>
            <h1 id="mk-col-title" className="mt-4 max-w-3xl animate-fade-up text-h1 font-semibold text-white">
              {title}
            </h1>
            <p className="mt-3 max-w-xl animate-fade-up text-[16px] leading-relaxed text-white/80 [animation-delay:80ms]">{description}</p>
            {data.storeTotal > 0 && (
              <p className="mt-5 flex animate-fade-up flex-wrap gap-2 text-sm [animation-delay:140ms]">
                <span className="rounded-full bg-white/12 px-3 py-1.5 font-medium text-white ring-1 ring-white/20 tabular">
                  {nf.format(data.storeTotal)} {data.storeTotal > 1 ? "boutiques" : "boutique"}
                </span>
                <span className="rounded-full bg-white/12 px-3 py-1.5 font-medium text-white ring-1 ring-white/20 tabular">
                  {nf.format(data.productTotal)} {data.productTotal > 1 ? "produits" : "produit"}
                </span>
              </p>
            )}
          </div>
        </div>

        {chips.length > 0 && (
          <nav aria-label="Affiner" className="mt-5">
            <ul className="relative scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              {chips.map((c) => (
                <li key={c.href} className="shrink-0">
                  <Link
                    href={c.href}
                    aria-current={c.active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-10 items-center rounded-full px-4 text-sm font-medium ring-1 transition-[background-color,color,transform] duration-300 ease-spring active:scale-[0.97]",
                      c.active ? "bg-ink text-canvas ring-ink" : "bg-surface text-ink-muted ring-line hover:text-ink",
                    )}
                  >
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>

      {data.storeTotal === 0 ? (
        <section className="container-x py-16">
          <EmptyState
            icon={Store}
            title={emptyTitle}
            description={emptyDescription}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/marketplace" variant="outline">
                  Explorer la marketplace
                </ButtonLink>
                <ButtonLink href="/inscription" variant="primary" trailing>
                  Ouvrir ma boutique
                </ButtonLink>
              </div>
            }
          />
        </section>
      ) : (
        <>
          <section aria-labelledby="mk-col-stores" className="container-x py-14 md:py-20">
            <SectionHeading id="mk-col-stores" title="Les boutiques" href={data.storeTotal > data.stores.length ? storesHref : undefined} hrefLabel={`Voir les ${nf.format(data.storeTotal)}`} />
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.stores.map((s, i) => (
                <li key={s.id} className="reveal" style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                  <StoreCard store={s} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px" />
                </li>
              ))}
            </ul>
          </section>

          {data.products.length > 0 && (
            <section aria-labelledby="mk-col-products" className="container-x pb-6">
              <div className="rounded-[var(--radius-2xl)] bg-surface-2 px-4 py-10 ring-1 ring-line sm:px-8 md:py-14">
                <SectionHeading id="mk-col-products" title="À commander maintenant" href={productsHref} hrefLabel={`Tous les produits (${nf.format(data.productTotal)})`} />
                <ul className="grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-3 lg:grid-cols-4">
                  {data.products.map((p, i) => (
                    <li key={p.id} className="reveal" style={{ transitionDelay: `${(i % 4) * 60}ms` }}>
                      <ProductCard product={p} />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}

      <MerchantCta />
      <RevealScope />
    </div>
  );
}

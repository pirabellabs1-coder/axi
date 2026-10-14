import { shareableImageUrl } from "@/lib/storage/public-url";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import { schemaAvailability } from "@/lib/inventory/policy";
import type { SectionProps } from "../render-context";
import { ProductMain } from "../product/product-main";
import type { GalleryStyle } from "../product/gallery";
import { SectionShell } from "../ui";

const GALLERIES: GalleryStyle[] = ["thumbnails-left", "thumbnails-bottom", "carousel", "stacked", "grid-2"];

export default function MainProduct({ section, ctx }: SectionProps) {
  const product = ctx.data.product;
  if (!product) return null;
  const st = section.settings;
  const g = ctx.settings.product;
  const gallery = (GALLERIES as string[]).includes(S.str(st, "gallery")) ? (S.str(st, "gallery") as GalleryStyle) : g.gallery;
  const store = ctx.data.store;

  // Données structurées Product / Offer / AggregateRating : TOUJOURS dans la devise de la boutique (lot 2, §1.2),
  // jamais dans la devise d'affichage choisie par l'acheteur.
  const prices = product.variants.length ? product.variants.map((v) => v.price ?? product.basePrice) : [product.basePrice];
  const sellable = product.variants.length ? product.variants.filter((v) => v.available && v.inStock) : product.inStock ? [product] : [];
  // BackOrder quand seule une précommande est possible (rupture + « continuer à vendre ») ; jamais de quantité exposée.
  const availability = schemaAvailability({ sellable: sellable.length > 0, backorder: sellable.length > 0 && sellable.every((v) => v.backorder) });
  const absolute = (u: string) => shareableImageUrl(u);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    image: product.images.map((i) => absolute(i.url)).filter(Boolean),
    sku: product.sku ?? undefined,
    brand: product.vendor ? { "@type": "Brand", name: product.vendor } : { "@type": "Brand", name: store.name },
    offers: {
      "@type": product.variants.length > 1 ? "AggregateOffer" : "Offer",
      priceCurrency: store.currency,
      ...(product.variants.length > 1 ? { lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: product.variants.length } : { price: prices[0] }),
      availability,
      seller: { "@type": "Organization", name: store.name },
    },
    ...(product.rating && product.rating.count > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: product.rating.average, reviewCount: product.rating.count, bestRating: 5, worstRating: 1 } } : {}),
  };

  return (
    <SectionShell section={section} ctx={ctx} padded={false} className="pb-10 pt-3 sm:pb-14 sm:pt-5">
      <nav aria-label="Fil d'Ariane" className="mb-4 text-sm">
        <ol className="flex flex-wrap items-center gap-1 text-ink-muted">
          <li>
            <Link href={ctx.base} className="inline-flex min-h-10 items-center hover:text-ink">
              Accueil
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-3.5" />
          </li>
          <li>
            <Link href={product.collection ? `${ctx.base}/collections/${product.collection.handle}` : `${ctx.base}/catalogue`} className="inline-flex min-h-10 items-center hover:text-ink">
              {product.collection?.name ?? store.copy.catalogTitle}
            </Link>
          </li>
          <li aria-hidden className="hidden sm:block">
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="hidden max-w-[40ch] truncate text-ink sm:block">
            {product.name}
          </li>
        </ol>
      </nav>
      <ProductMain
        key={product.id}
        product={product}
        store={store}
        blocks={section.blocks}
        gallery={gallery}
        zoom={S.bool(st, "zoom", true)}
        stickyInfo={S.bool(st, "sticky_info", true)}
        stickyBar={S.bool(st, "sticky_add_to_cart", true) && g.stickyAddToCart}
        showSku={g.showSku}
        showStock={g.showStock}
        showShare={g.showShareButtons}
        cartType={ctx.settings.cart.type}
        base={ctx.base}
        shopper={ctx.data.shopper}
        promotions={ctx.data.promotions}
        showFavorite={ctx.settings.cards.showFavorite === true}
        view={ctx.data.currency}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </SectionShell>
  );
}

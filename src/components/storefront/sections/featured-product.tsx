import Link from "next/link";
import { S } from "@/lib/storefront/theme-doc";
import type { SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { QuickAddButton } from "../quick-add-button";
import { Stars } from "../stars";
import { ButtonLink, PriceTag, SectionShell, headingClass } from "../ui";
import { pickProducts } from "./featured-collection";

export default function FeaturedProduct({ section, ctx }: SectionProps) {
  const id = S.str(section.settings, "product");
  const product = (id && ctx.data.products[id]) || pickProducts(ctx, null, 1).products[0];
  if (!product) return null;
  const store = ctx.data.store;
  const url = `${ctx.base}/p/${product.slug}`;
  const [img, second] = product.images;
  return (
    <SectionShell section={section} ctx={ctx}>
      <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-14">
        <div className="grid grid-cols-[1fr] gap-3">
          <Link href={url} tabIndex={-1} aria-hidden>
            <ProductImage src={img?.url} alt="" ratio="aspect-[4/5]" className="rounded-[var(--store-card-radius)]" sizes="(max-width: 768px) 100vw, 50vw" priority={ctx.first} />
          </Link>
          {second && <span className="sr-only">{second.alt}</span>}
        </div>
        <div>
          {product.vendor && <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-muted">{product.vendor}</p>}
          <h2 className={headingClass("lg") + " mt-2"}>
            <Link href={url} className="hover:opacity-80">
              {product.name}
            </Link>
          </h2>
          {product.rating && (
            <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
              <Stars value={product.rating.average} size="sm" />
              {product.rating.count} avis
            </p>
          )}
          <PriceTag price={product.price} compareAt={product.compareAt} range={product.range} view={ctx.data.currency} itemKey={product.simple ? product.id : null} soldOut={product.soldOut} size="lg" className="mt-4" />
          {S.bool(section.settings, "show_description", true) && product.description && <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-ink-muted">{product.description}</p>}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {product.simple && !product.soldOut && !store.closed && (
              <QuickAddButton slug={store.slug} variant="pill" label={store.copy.addLabel} line={{ productId: product.id, variantId: null, optionIds: [], quantity: product.minQty, snapshot: { name: product.name, variantName: null, unitPrice: product.unitPrice, image: img?.url ?? null, productSlug: product.slug } }} />
            )}
            <ButtonLink href={url} label={product.simple ? "Voir le détail" : store.booking ? "Choisir" : "Choisir les options"} style={product.simple ? "outline" : "solid"} arrow />
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

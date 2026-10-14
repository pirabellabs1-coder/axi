import { S } from "@/lib/storefront/theme-doc";
import type { CardProduct } from "@/lib/storefront/render-types";
import type { RenderCtx, SectionProps } from "../render-context";
import { Carousel } from "../carousel";
import { ProductCard, gridClass, gridSizes } from "../product-card";
import { ButtonLink, SectionHeading, SectionShell } from "../ui";

/** Produits d'une collection ; sans collection choisie : produits mis en avant, complétés par le reste du catalogue. */
export function pickProducts(ctx: RenderCtx, collectionId: string | null, limit: number, exclude: string[] = []): { products: CardProduct[]; handle: string | null } {
  const coll = collectionId ? ctx.data.collections.find((c) => c.id === collectionId) : null;
  const ids = coll ? coll.productIds : [...ctx.data.allProductIds].sort((a, b) => Number(ctx.data.products[b]?.isFeatured) - Number(ctx.data.products[a]?.isFeatured));
  const products = ids
    .filter((id) => !exclude.includes(id))
    .map((id) => ctx.data.products[id])
    .filter((p): p is CardProduct => !!p)
    .slice(0, limit);
  return { products, handle: coll?.handle ?? null };
}

export default function FeaturedCollection({ section, ctx }: SectionProps) {
  const st = section.settings;
  const limit = Math.max(2, Math.min(24, S.num(st, "limit", 8)));
  const { products, handle } = pickProducts(ctx, S.str(st, "collection") || null, limit);
  if (products.length === 0) return null;
  const columns = S.str(st, "columns", "4");
  const viewAll = S.bool(st, "show_view_all", true) ? <ButtonLink href={handle ? `${ctx.base}/collections/${handle}` : `${ctx.base}/catalogue`} label="Tout voir" style="link" arrow /> : null;
  const n = Number(columns) || 4;
  const itemWidth = n >= 5 ? "w-[62%] sm:w-[36%] lg:w-[calc((100%-4*20px)/5)]" : n === 4 ? "w-[62%] sm:w-[38%] lg:w-[calc((100%-3*20px)/4)]" : n === 3 ? "w-[70%] sm:w-[44%] lg:w-[calc((100%-2*20px)/3)]" : "w-[80%] sm:w-[48%] lg:w-[calc((100%-20px)/2)]";
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} aside={viewAll} />
      {S.str(st, "layout", "grid") === "carousel" ? (
        <Carousel label={S.str(st, "heading", "Produits")} itemClassName={itemWidth}>
          {products.map((p, i) => (
            <ProductCard key={p.id} product={p} ctx={ctx} priority={ctx.first && i < 2} sizes={gridSizes(columns)} />
          ))}
        </Carousel>
      ) : (
        <div className={gridClass(columns)}>
          {products.map((p, i) => (
            <ProductCard key={p.id} product={p} ctx={ctx} priority={ctx.first && i < 2} sizes={gridSizes(columns)} />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

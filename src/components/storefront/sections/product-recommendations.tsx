import { S } from "@/lib/storefront/theme-doc";
import type { CardProduct } from "@/lib/storefront/render-types";
import type { SectionProps } from "../render-context";
import { Carousel } from "../carousel";
import { ProductCard, gridSizes } from "../product-card";
import { SectionHeading, SectionShell } from "../ui";

/** Produits similaires : même collection, puis tags communs, puis produits mis en avant. */
export default function ProductRecommendations({ section, ctx }: SectionProps) {
  const limit = Math.max(2, Math.min(12, S.num(section.settings, "limit", 4)));
  const current = ctx.data.product;
  const all = ctx.data.allProductIds.map((id) => ctx.data.products[id]).filter((p): p is CardProduct => !!p && p.id !== current?.id && !p.soldOut);
  let list: CardProduct[];
  if (current) {
    const coll = ctx.data.collections.find((c) => c.productIds.includes(current.id));
    const tags = new Set(current.tags.map((t) => t.toLowerCase()));
    const score = (p: CardProduct) => (coll?.productIds.includes(p.id) ? 4 : 0) + p.tags.filter((t) => tags.has(t.toLowerCase())).length * 2 + (p.isFeatured ? 1 : 0);
    list = [...all].sort((a, b) => score(b) - score(a)).slice(0, limit);
  } else {
    list = all.filter((p) => p.isFeatured).concat(all.filter((p) => !p.isFeatured)).slice(0, limit);
  }
  if (!list.length) return null;
  return (
    <SectionShell section={section} ctx={ctx} label={S.str(section.settings, "heading", "Vous aimerez aussi")}>
      <SectionHeading section={section} ctx={ctx} fallback="Vous aimerez aussi" />
      <Carousel label={S.str(section.settings, "heading", "Vous aimerez aussi")} itemClassName="w-[62%] sm:w-[38%] lg:w-[calc((100%-3*20px)/4)]">
        {list.map((p) => (
          <ProductCard key={p.id} product={p} ctx={ctx} sizes={gridSizes(4)} />
        ))}
      </Carousel>
    </SectionShell>
  );
}

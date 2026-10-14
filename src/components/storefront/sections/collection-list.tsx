import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { S } from "@/lib/storefront/theme-doc";
import type { CollectionData } from "@/lib/storefront/render-types";
import { cn } from "@/lib/utils";
import type { SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { SectionHeading, SectionShell } from "../ui";

export default function CollectionList({ section, ctx }: SectionProps) {
  const blocks = section.blocks.filter((b) => !b.disabled);
  // Sans bloc : toutes les collections publiées non vides.
  const items: { c: CollectionData; image: { url: string; alt?: string } | null }[] = (
    blocks.length
      ? blocks.map((b) => {
          const c = ctx.data.collections.find((x) => x.id === S.str(b.settings, "collection"));
          return c ? { c, image: S.img(b.settings, "image") ?? c.image } : null;
        })
      : ctx.data.collections.filter((c) => c.productIds.length > 0).slice(0, 12).map((c) => ({ c, image: c.image }))
  ).filter((x): x is { c: CollectionData; image: { url: string; alt?: string } | null } => !!x);
  if (!items.length) return null;
  const style = S.str(section.settings, "style", "tiles");
  const link = (c: CollectionData) => `${ctx.base}/collections/${c.handle}`;

  if (style === "chips") {
    return (
      <SectionShell section={section} ctx={ctx}>
        <SectionHeading section={section} ctx={ctx} />
        <nav aria-label={S.str(section.settings, "heading", "Catégories")}>
          <ul className="relative scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            <li>
              <Link href={`${ctx.base}/catalogue`} className="inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full bg-ink px-5 text-sm font-medium text-canvas">
                Tout voir
              </Link>
            </li>
            {items.map(({ c }) => (
              <li key={c.id}>
                <Link href={link(c)} className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-surface px-5 text-sm font-medium text-ink ring-1 ring-inset ring-line transition-shadow hover:ring-line-strong">
                  {c.name}
                  <span className="text-xs tabular text-ink-muted">{c.productIds.length}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </SectionShell>
    );
  }

  if (style === "circles") {
    return (
      <SectionShell section={section} ctx={ctx}>
        <SectionHeading section={section} ctx={ctx} />
        <ul className="scrollbar-none sf-snap relative -mx-4 flex gap-5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:justify-center sm:gap-8 sm:px-0">
          {items.map(({ c, image }) => (
            <li key={c.id} className="w-24 shrink-0 sm:w-32">
              <Link href={link(c)} className="group flex flex-col items-center gap-3 text-center">
                <ProductImage src={image?.url} alt="" ratio="aspect-square" className="rounded-full ring-1 ring-line transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]" sizes="128px" />
                <span className="text-sm font-medium leading-snug text-ink">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </SectionShell>
    );
  }

  const n = items.length;
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} />
      <ul className={cn("grid gap-3 sm:gap-5", n === 1 ? "" : n === 2 ? "sm:grid-cols-2" : n === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3")}>
        {items.map(({ c, image }, i) => (
          <li key={c.id} className={cn(n === 3 && i === 0 && "col-span-2 lg:col-span-1", n >= 5 && i === 0 && "col-span-2 lg:col-span-1")}>
            <Link href={link(c)} className="sf-card group relative block overflow-hidden rounded-[var(--store-card-radius)]">
              <ProductImage src={image?.url} alt="" ratio={n <= 2 ? "aspect-[16/10]" : "aspect-[4/5] sm:aspect-[4/5]"} imgClassName="sf-img-main" sizes="(max-width: 640px) 50vw, 33vw" />
              <span className="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,rgb(0_0_0/0.62))]" aria-hidden />
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 text-white sm:p-5">
                <span>
                  <span className="sf-heading block text-[calc(clamp(1.1rem,2.4vw,1.6rem)*var(--store-scale))] !text-white">{c.name}</span>
                  <span className="mt-0.5 block text-xs text-white/80">
                    {c.productIds.length} article{c.productIds.length > 1 ? "s" : ""}
                  </span>
                </span>
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/40 backdrop-blur-md transition-transform duration-300 group-hover:rotate-45" aria-hidden>
                  <ArrowUpRight className="size-4" />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

import Link from "next/link";
import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import type { CardProduct } from "@/lib/storefront/render-types";
import type { SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { PriceTag, SectionHeading, SectionShell, animItem } from "../ui";
import { fallbackVisual } from "./hero-banner";

type Spot = { id: string; n: number; x: number; y: number; product: CardProduct };

const clampPct = (v: number) => Math.max(4, Math.min(96, v));

/**
 * Look à acheter (bibliothèque premium, lot 4 §4) : photo avec repères numérotés (liens vers les produits, cibles
 * de 44 px) et la liste des mêmes produits à côté (ordinateur) ou en dessous (mobile). Les repères ne sont qu'un
 * raccourci visuel : la liste porte l'information pour les lecteurs d'écran (repères masqués de l'arbre).
 */
export default function Lookbook({ section, ctx }: SectionProps) {
  const st = section.settings;
  const img = S.img(st, "image") ?? fallbackVisual(ctx);
  const spots: Spot[] = [];
  for (const b of section.blocks) {
    if (b.disabled || b.type !== "hotspot") continue;
    const p = ctx.data.products[S.str(b.settings, "product")];
    if (!p) continue;
    spots.push({ id: b.id, n: spots.length + 1, x: clampPct(S.num(b.settings, "x", 50)), y: clampPct(S.num(b.settings, "y", 50)), product: p });
  }
  // Sans produit choisi : section masquée en boutique, maquette dans l'aperçu (produits d'exemple).
  if (!spots.length && ctx.preview) {
    const sample = ctx.data.allProductIds.slice(0, 2).map((id) => ctx.data.products[id]).filter(Boolean);
    sample.forEach((p, i) => spots.push({ id: `sample-${i}`, n: i + 1, x: i ? 60 : 38, y: i ? 68 : 32, product: p }));
  }
  if (!spots.length || !img) return null;
  const right = S.str(st, "image_position", "left") === "right";
  const text = S.str(st, "text").trim();
  const headingId = `lookbook-${section.id}`;
  return (
    <SectionShell section={section} ctx={ctx} animItems>
      <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-[1.2fr_1fr] md:gap-12">
        <div {...animItem(0)} className={cn("relative", right && "md:order-2")}>
          <div data-hover-zoom className="overflow-hidden rounded-[calc(var(--store-card-radius)+4px)]">
            <ProductImage src={img.url} alt={img.alt ?? ""} ratio="aspect-[4/5]" sizes="(max-width: 768px) 100vw, 55vw" priority={ctx.first} />
          </div>
          <div aria-hidden className="absolute inset-0">
            {spots.map((s) => (
              <Link
                key={s.id}
                href={`${ctx.base}/p/${s.product.slug}`}
                tabIndex={-1}
                style={{ left: `${s.x}%`, top: `${s.y}%` }}
                className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-sm font-semibold text-[#111412] shadow-[0_4px_16px_rgb(0_0_0/0.25)] ring-4 ring-white/40 transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:scale-110 motion-reduce:transition-none"
              >
                {s.n}
              </Link>
            ))}
          </div>
        </div>
        <div className={cn(right && "md:order-1")}>
          <SectionHeading section={section} ctx={ctx} id={headingId} />
          {text && <p {...animItem(1)} className="-mt-2 mb-6 max-w-[52ch] whitespace-pre-line text-[15px] leading-relaxed text-ink-muted">{text}</p>}
          <ol aria-labelledby={S.str(st, "heading") ? headingId : undefined} aria-label={S.str(st, "heading") ? undefined : "Produits du look"} className="space-y-3">
            {spots.map((s, i) => (
              <li key={s.id} {...animItem(i + 2)}>
                <Link href={`${ctx.base}/p/${s.product.slug}`} className="group flex items-center gap-4 rounded-[min(var(--store-card-radius),18px)] bg-surface p-3 ring-1 ring-line transition-shadow hover:ring-[var(--c-ink)]">
                  <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--store-primary)] text-sm font-semibold text-[var(--store-primary-contrast)]">
                    {s.n}
                  </span>
                  <ProductImage src={s.product.images[0]?.url} alt="" ratio="aspect-square" className="w-16 shrink-0 rounded-[12px]" sizes="64px" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink group-hover:underline group-hover:underline-offset-4">{s.product.name}</span>
                    <PriceTag price={s.product.price} compareAt={s.product.compareAt} range={s.product.range} view={ctx.data.currency} itemKey={s.product.simple ? s.product.id : null} soldOut={s.product.soldOut} />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </SectionShell>
  );
}

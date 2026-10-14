import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import type { RenderCtx, SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { SectionShell } from "../ui";
import { ContentBlocks } from "./blocks";

/** Visuel de repli : bannière de la boutique, sinon photo du produit mis en avant. */
export function fallbackVisual(ctx: RenderCtx): { url: string; alt: string } | null {
  const s = ctx.data.store;
  if (s.bannerUrl) return { url: s.bannerUrl, alt: s.name };
  const ids = ctx.data.allProductIds;
  for (const id of ids) {
    const p = ctx.data.products[id];
    if (p?.images[0]) return { url: p.images[0].url, alt: p.name };
  }
  return null;
}

const HEIGHT: Record<string, string> = {
  small: "min-h-[340px] sm:min-h-[400px]",
  medium: "min-h-[440px] sm:min-h-[520px]",
  large: "min-h-[520px] sm:min-h-[640px]",
  full: "min-h-[calc(100svh-64px)]",
};

const POSITION: Record<string, string> = {
  center: "items-center justify-center text-center",
  "bottom-left": "items-end justify-start",
  "middle-left": "items-center justify-start",
  "bottom-center": "items-end justify-center text-center",
};

export default function HeroBanner({ section, ctx }: SectionProps) {
  const st = section.settings;
  const desktop = S.img(st, "image") ?? fallbackVisual(ctx);
  const mobile = S.img(st, "image_mobile");
  const layout = S.str(st, "layout", "overlay");
  const height = S.str(st, "height", "large");
  const pos = S.str(st, "content_position", "bottom-left");
  const overlay = S.num(st, "overlay_opacity", 30) / 100;
  const priority = ctx.first;
  const centered = pos === "center" || pos === "bottom-center";
  const h1 = ctx.first && ctx.template === "home";
  const alt = desktop?.alt ?? "";

  const media = (ratio: string, sizes: string, cls = "") =>
    mobile ? (
      <>
        <ProductImage src={mobile.url} alt={mobile.alt ?? alt} ratio={ratio} className={cn("sm:hidden", cls)} sizes="100vw" priority={priority} />
        <ProductImage src={desktop?.url} alt={alt} ratio={ratio} className={cn("hidden sm:block", cls)} sizes={sizes} />
      </>
    ) : (
      <ProductImage src={desktop?.url} alt={alt} ratio={ratio} className={cls} sizes={sizes} priority={priority} />
    );

  if (layout === "split") {
    return (
      <SectionShell section={section} ctx={ctx} padded={false} className="py-6 sm:py-10">
        <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-[1.05fr_1fr] md:gap-14">
          <div className="sf-rise order-2 md:order-1">
            <ContentBlocks blocks={section.blocks} ctx={ctx} h1={h1} />
          </div>
          <div className="order-1 md:order-2">{media("aspect-[4/3] md:aspect-[5/6] lg:aspect-[1/1]", "(max-width: 768px) 100vw, 50vw", "rounded-[calc(var(--store-card-radius)+4px)]")}</div>
        </div>
      </SectionShell>
    );
  }

  if (layout === "below") {
    return (
      <SectionShell section={section} ctx={ctx} padded={false} className="pb-8 pt-4 sm:pb-12 sm:pt-6">
        {media("aspect-[4/3] sm:aspect-[21/9]", "(max-width: 1280px) 100vw, 1280px", "rounded-[calc(var(--store-card-radius)+4px)]")}
        <div className={cn("sf-rise mt-8 sm:mt-10", centered && "mx-auto max-w-3xl")}>
          <ContentBlocks blocks={section.blocks} ctx={ctx} h1={h1} align={centered ? "center" : "left"} />
        </div>
      </SectionShell>
    );
  }

  // Texte sur l'image : dégradé garantissant le contraste du texte blanc.
  return (
    <SectionShell section={section} ctx={ctx} full padded={false}>
      <div className="sf-container pt-3 sm:pt-5">
        <div className={cn("relative isolate flex overflow-hidden rounded-[calc(var(--store-card-radius)+6px)]", HEIGHT[height] ?? HEIGHT.large, POSITION[pos] ?? POSITION["bottom-left"], !desktop && "bg-[var(--store-primary)]")}>
          {desktop && (
            <div className="absolute inset-0 -z-10 overflow-hidden">
              {/* Lot 4 §2 : parallaxe CSS (animation-timeline: view()) si activée et supportée ; sinon image fixe. */}
              <div data-parallax className="h-full">
                {media("h-full", "(max-width: 1280px) 100vw, 1280px", "h-full")}
              </div>
            </div>
          )}
          {desktop && (
            <div
              className="absolute inset-0 -z-10"
              aria-hidden
              style={{ background: `linear-gradient(${pos.startsWith("middle") ? "90deg" : "180deg"}, rgb(0 0 0 / ${Math.max(0, overlay - 0.15)}) 10%, rgb(0 0 0 / ${Math.min(0.85, overlay + 0.35)}) 100%)` }}
            />
          )}
          <div className={cn("sf-rise w-full p-6 sm:p-10 md:p-14", centered && "flex justify-center")}>
            <div className={cn(centered ? "max-w-3xl" : "max-w-2xl")}>
              <ContentBlocks blocks={section.blocks} ctx={ctx} tone="light" h1={h1} align={centered ? "center" : "left"} />
            </div>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

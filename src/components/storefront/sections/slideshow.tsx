import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import { href, type SectionProps } from "../render-context";
import { Carousel } from "../carousel";
import { ProductImage } from "../product-image";
import { ButtonLink, SectionShell } from "../ui";
import { fallbackVisual } from "./hero-banner";

export default function Slideshow({ section, ctx }: SectionProps) {
  const slides = section.blocks.filter((b) => !b.disabled);
  if (!slides.length) return null;
  const autoplay = S.bool(section.settings, "autoplay", true) ? S.num(section.settings, "speed", 5) : 0;
  const tall = S.str(section.settings, "height", "large") === "large";
  const productImgs = ctx.data.allProductIds.map((id) => ctx.data.products[id]?.images[0]).filter(Boolean);
  const fallback = fallbackVisual(ctx);
  return (
    <SectionShell section={section} ctx={ctx} padded={false} className="pt-3 sm:pt-5" label="Diaporama">
      <Carousel label="Diaporama" itemClassName="w-full" gapClassName="gap-0" autoplay={autoplay} dots arrows="inside" bleed={false}>
        {slides.map((b, i) => {
          const img = S.img(b.settings, "image") ?? (i === 0 ? fallback : productImgs[i] ? { url: productImgs[i]!.url, alt: productImgs[i]!.alt ?? "" } : fallback);
          const heading = S.str(b.settings, "heading");
          const sub = S.str(b.settings, "subheading");
          const Tag = i === 0 && ctx.first && ctx.template === "home" ? "h1" : "h2";
          return (
            <div key={b.id} className={cn("relative isolate flex items-end overflow-hidden rounded-[calc(var(--store-card-radius)+6px)]", tall ? "min-h-[520px] sm:min-h-[640px]" : "min-h-[420px] sm:min-h-[500px]", !img && "bg-[var(--store-primary)]")}>
              {img && (
                <div className="absolute inset-0 -z-10">
                  <ProductImage src={img.url} alt={img.alt ?? ""} ratio="h-full" sizes="(max-width: 1280px) 100vw, 1280px" priority={i === 0 && ctx.first} />
                </div>
              )}
              <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(0_0_0/0.02)_30%,rgb(0_0_0/0.66)_100%)]" aria-hidden />
              <div className="w-full max-w-2xl p-6 pb-14 text-white sm:p-12 sm:pb-16">
                {heading && <Tag className="sf-heading text-[calc(clamp(2.2rem,6vw,4.5rem)*var(--store-scale))] !text-white">{heading}</Tag>}
                {sub && <p className="mt-3 max-w-[46ch] text-[17px] leading-relaxed text-white/90">{sub}</p>}
                <div className="mt-6">
                  <ButtonLink href={href(ctx, S.str(b.settings, "button_link"), "/catalogue")} label={S.str(b.settings, "button_label")} style={S.str(b.settings, "button_style", "solid") === "link" ? "link" : "light"} arrow className={S.str(b.settings, "button_style") === "link" ? "!text-white" : undefined} />
                </div>
              </div>
            </div>
          );
        })}
      </Carousel>
    </SectionShell>
  );
}

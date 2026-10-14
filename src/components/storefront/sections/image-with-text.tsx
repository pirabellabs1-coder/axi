import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import type { SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { SectionShell } from "../ui";
import { ContentBlocks } from "./blocks";
import { fallbackVisual } from "./hero-banner";

const RATIO: Record<string, string> = { square: "aspect-square", portrait: "aspect-[4/5]", landscape: "aspect-[4/3]" };

export default function ImageWithText({ section, ctx }: SectionProps) {
  const st = section.settings;
  const img = S.img(st, "image") ?? fallbackVisual(ctx);
  const right = S.str(st, "image_position", "left") === "right";
  return (
    <SectionShell section={section} ctx={ctx}>
      <div className={cn("grid items-center gap-8 md:gap-16", img ? "md:grid-cols-2" : "")}>
        {img && (
          <div className={cn(right && "md:order-2")}>
            <ProductImage src={img.url} alt={img.alt ?? ""} ratio={RATIO[S.str(st, "image_ratio", "portrait")] ?? RATIO.portrait} className="rounded-[var(--store-card-radius)]" sizes="(max-width: 768px) 100vw, 50vw" priority={ctx.first} />
          </div>
        )}
        <div className={cn("py-2", right && "md:order-1")}>
          <ContentBlocks blocks={section.blocks} ctx={ctx} />
        </div>
      </div>
    </SectionShell>
  );
}

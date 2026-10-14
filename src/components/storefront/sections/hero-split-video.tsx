import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import type { SectionProps } from "../render-context";
import { AmbientVideo, isAmbientVideoUrl } from "../ambient-video";
import { ProductImage } from "../product-image";
import { SectionShell, animItem } from "../ui";
import { ContentBlocks } from "./blocks";
import { fallbackVisual } from "./hero-banner";

const RATIO: Record<string, string> = { square: "aspect-square", portrait: "aspect-[4/5]", landscape: "aspect-[16/10]" };

/**
 * Vidéo et texte (bibliothèque premium, lot 4 §4). L'image de couverture (repli : bannière ou photo produit) occupe la
 * place de la vidéo dès le premier rendu : aucun décalage, LCP sur l'image ; la vidéo se superpose une fois lancée.
 */
export default function HeroSplitVideo({ section, ctx }: SectionProps) {
  const st = section.settings;
  const poster = S.img(st, "poster") ?? fallbackVisual(ctx);
  const video = S.str(st, "video");
  const left = S.str(st, "media_position", "right") === "left";
  const h1 = ctx.first && ctx.template === "home";
  const heading = section.blocks.find((b) => b.type === "heading" && !b.disabled);
  const label = (heading && S.str(heading.settings, "text")) || "vidéo de présentation";
  return (
    <SectionShell section={section} ctx={ctx} animItems>
      <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-14">
        <div {...animItem(0)} className={cn("relative overflow-hidden rounded-[calc(var(--store-card-radius)+4px)]", left ? "md:order-1" : "md:order-2")}>
          <ProductImage src={poster?.url} alt={poster?.alt ?? ""} ratio={RATIO[S.str(st, "media_ratio", "portrait")] ?? RATIO.portrait} sizes="(max-width: 768px) 100vw, 50vw" priority={ctx.first} />
          {isAmbientVideoUrl(video) && <AmbientVideo src={video} autoplay={S.bool(st, "autoplay", true)} label={label} />}
        </div>
        <div {...animItem(1)} className={cn(left ? "md:order-2" : "md:order-1")}>
          <ContentBlocks blocks={section.blocks} ctx={ctx} h1={h1} />
        </div>
      </div>
    </SectionShell>
  );
}

import { S } from "@/lib/storefront/theme-doc";
import { formatMoney } from "@/lib/money";
import { viewCurrency, viewPrice } from "@/lib/storefront/currency-view";
import type { SectionProps } from "../render-context";
import { SectionHeading, SectionShell } from "../ui";
import { StoriesStrip, type StoryItem } from "../live/stories-strip";
import { isDirectVideoUrl } from "./shoppable-video";

/**
 * Stories achetables (lot 4 §17, équipe CAN). Le contenu vient du document de thème (blocs « story ») :
 * image ou vidéo, titre, texte, produit mis en avant, durée. Une story sans visuel est ignorée ;
 * sans aucune story, la section est masquée (maquette d'exemple dans l'aperçu de l'éditeur).
 */
export default function Stories({ section, ctx }: SectionProps) {
  const st = section.settings;
  const data = ctx.data;
  const view = data.currency;
  const currency = viewCurrency(view);

  const stories: StoryItem[] = [];
  for (const b of section.blocks) {
    if (b.disabled || b.type !== "story") continue;
    const image = S.img(b.settings, "image");
    const video = S.str(b.settings, "video");
    if (!image && !isDirectVideoUrl(video)) continue;
    const p = data.products[S.str(b.settings, "product")];
    stories.push({
      id: b.id,
      title: S.str(b.settings, "title").slice(0, 24),
      text: S.str(b.settings, "text").slice(0, 120),
      image: image?.url ?? null,
      video: isDirectVideoUrl(video) ? video : null,
      durationMs: Math.min(15, Math.max(3, S.num(b.settings, "duration", 5))) * 1000,
      product: p
        ? {
            slug: p.slug,
            name: p.name,
            priceLabel: `${p.range ? "À partir de " : ""}${formatMoney(viewPrice(view, p.price, p.simple ? p.id : null), currency)}`,
            image: p.images[0]?.url ?? null,
          }
        : null,
    });
  }

  if (!stories.length) return null;
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} fallback="Nos stories" />
      <StoriesStrip stories={stories} base={ctx.base} size={S.str(st, "size", "md")} showLabels={S.bool(st, "show_labels", true)} />
    </SectionShell>
  );
}

import { S } from "@/lib/storefront/theme-doc";
import type { SectionProps } from "../render-context";
import { Carousel } from "../carousel";
import { ProductImage } from "../product-image";
import { Stars } from "../stars";
import { SectionHeading, SectionShell } from "../ui";

/** Témoignages saisis par le commerçant (distincts des avis vérifiés issus des commandes). */
export default function Testimonials({ section, ctx }: SectionProps) {
  const items = section.blocks.filter((b) => !b.disabled && S.str(b.settings, "quote").trim());
  if (!items.length) return null;
  const cards = items.map((b) => {
    const avatar = S.img(b.settings, "avatar");
    const author = S.str(b.settings, "author");
    return (
      <figure key={b.id} className="flex h-full flex-col rounded-[var(--store-card-radius)] bg-surface p-6 ring-1 ring-line">
        <Stars value={S.num(b.settings, "rating", 5)} size="sm" />
        <blockquote className="mt-4 flex-1 text-[16px] leading-relaxed text-ink">« {S.str(b.settings, "quote")} »</blockquote>
        {(author || avatar) && (
          <figcaption className="mt-5 flex items-center gap-3">
            {avatar && <ProductImage src={avatar.url} alt="" ratio="aspect-square" className="w-10 shrink-0 rounded-full" sizes="40px" />}
            <span>
              <span className="block text-sm font-semibold text-ink">{author}</span>
              {S.str(b.settings, "role") && <span className="block text-xs text-ink-muted">{S.str(b.settings, "role")}</span>}
            </span>
          </figcaption>
        )}
      </figure>
    );
  });
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} />
      {S.str(section.settings, "layout", "carousel") === "carousel" ? (
        <Carousel label={S.str(section.settings, "heading", "Témoignages")} itemClassName="w-[84%] sm:w-[46%] lg:w-[calc((100%-2*20px)/3)]">
          {cards}
        </Carousel>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards}</div>
      )}
    </SectionShell>
  );
}

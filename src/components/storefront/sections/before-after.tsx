import { S } from "@/lib/storefront/theme-doc";
import type { SectionProps } from "../render-context";
import { BeforeAfterSlider } from "../before-after-slider";
import { ProductImage } from "../product-image";
import { SectionHeading, SectionShell } from "../ui";

const RATIO: Record<string, string> = { square: "aspect-square", portrait: "aspect-[4/5]", landscape: "aspect-[16/10]" };

/** Avant, après (bibliothèque premium, lot 4 §4) : les deux images sont nécessaires, sinon section masquée (note en aperçu). */
export default function BeforeAfter({ section, ctx }: SectionProps) {
  const st = section.settings;
  const before = S.img(st, "before");
  const after = S.img(st, "after");
  const ratio = RATIO[S.str(st, "ratio", "landscape")] ?? RATIO.landscape;
  const caption = S.str(st, "caption").trim();
  if (!before || !after) {
    if (!ctx.preview) return null;
    return (
      <SectionShell section={section} ctx={ctx}>
        <SectionHeading section={section} ctx={ctx} />
        <p className="text-sm text-ink-muted">Ajoutez une image « avant » et une image « après » (même cadrage) pour afficher le comparateur.</p>
      </SectionShell>
    );
  }
  const beforeLabel = S.str(st, "before_label", "Avant") || "Avant";
  const afterLabel = S.str(st, "after_label", "Après") || "Après";
  const sizes = "(max-width: 1024px) 100vw, 960px";
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} />
      <figure className="mx-auto max-w-5xl">
        <div className="overflow-hidden rounded-[calc(var(--store-card-radius)+4px)]">
          <BeforeAfterSlider
            start={Math.max(5, Math.min(95, S.num(st, "start", 50)))}
            beforeLabel={beforeLabel}
            afterLabel={afterLabel}
            before={<ProductImage src={before.url} alt={before.alt || beforeLabel} ratio={ratio} sizes={sizes} priority={ctx.first} />}
            after={<ProductImage src={after.url} alt={after.alt || afterLabel} ratio={ratio} sizes={sizes} />}
          />
        </div>
        {caption && <figcaption className="mt-3 text-center text-sm text-ink-muted">{caption}</figcaption>}
      </figure>
    </SectionShell>
  );
}

import Link from "next/link";
import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import { href, type SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { RichText } from "../rich-text";
import { SectionHeading, SectionShell } from "../ui";

export default function Multicolumn({ section, ctx }: SectionProps) {
  const cols = section.blocks.filter((b) => !b.disabled);
  if (!cols.length) return null;
  const n = S.str(section.settings, "columns", "3");
  const center = S.str(section.settings, "align", "left") === "center";
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} />
      <ul className={cn("grid gap-4 sm:gap-6", n === "2" ? "sm:grid-cols-2" : n === "4" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
        {cols.map((b, i) => {
          const img = S.img(b.settings, "image");
          const link = href(ctx, S.str(b.settings, "link") || null);
          const title = S.str(b.settings, "title");
          return (
            <li key={b.id} className={cn("relative flex flex-col rounded-[var(--store-card-radius)] bg-surface p-6 ring-1 ring-line", center && "items-center text-center")}>
              {img ? (
                <ProductImage src={img.url} alt={img.alt ?? ""} ratio="aspect-[4/3]" className="mb-5 rounded-[calc(var(--store-card-radius)-6px)]" sizes="(max-width: 640px) 100vw, 33vw" />
              ) : (
                <span className="mb-5 inline-flex size-10 items-center justify-center rounded-full bg-[var(--store-primary-soft)] text-sm font-semibold tabular text-[var(--store-primary)]" aria-hidden>
                  {i + 1}
                </span>
              )}
              {title && (
                <h3 className="text-lg font-semibold tracking-[-0.015em] text-ink">
                  {link ? (
                    <Link href={link} className="after:absolute after:inset-0 hover:underline">
                      {title}
                    </Link>
                  ) : (
                    title
                  )}
                </h3>
              )}
              <RichText text={S.str(b.settings, "text")} base={ctx.base} className="mt-2 space-y-2 text-[15px] leading-relaxed text-ink-muted" />
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

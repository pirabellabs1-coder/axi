import Link from "next/link";
import { S } from "@/lib/storefront/theme-doc";
import { cn } from "@/lib/utils";
import { href, type SectionProps } from "../render-context";
import { Carousel } from "../carousel";
import { ProductImage } from "../product-image";
import { SectionHeading, SectionShell } from "../ui";

export default function ImageGallery({ section, ctx }: SectionProps) {
  const items = section.blocks.filter((b) => !b.disabled).map((b) => ({ id: b.id, img: S.img(b.settings, "image"), caption: S.str(b.settings, "caption"), link: href(ctx, S.str(b.settings, "link") || null) })).filter((x) => x.img);
  if (!items.length) return null;
  const layout = S.str(section.settings, "layout", "grid");
  const tile = (x: (typeof items)[number], ratio: string, sizes: string) => {
    const inner = (
      <figure>
        <ProductImage src={x.img!.url} alt={x.img!.alt ?? x.caption} ratio={ratio} className="rounded-[var(--store-card-radius)]" imgClassName="sf-img-main" sizes={sizes} />
        {x.caption && <figcaption className="mt-2 text-sm text-ink-muted">{x.caption}</figcaption>}
      </figure>
    );
    return x.link ? (
      <Link href={x.link} className="sf-card block">
        {inner}
      </Link>
    ) : (
      inner
    );
  };
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} />
      {layout === "carousel" ? (
        <Carousel label={S.str(section.settings, "heading", "Galerie")} itemClassName="w-[80%] sm:w-[48%] lg:w-[calc((100%-2*20px)/3)]">
          {items.map((x) => (
            <div key={x.id}>{tile(x, "aspect-[4/5]", "(max-width: 640px) 80vw, 33vw")}</div>
          ))}
        </Carousel>
      ) : layout === "masonry" ? (
        <div className="columns-2 gap-3 sm:gap-5 lg:columns-3 [&>*]:mb-3 sm:[&>*]:mb-5">
          {items.map((x, i) => (
            <div key={x.id} className="break-inside-avoid">
              {tile(x, i % 3 === 0 ? "aspect-[3/4]" : i % 3 === 1 ? "aspect-square" : "aspect-[4/5]", "(max-width: 1024px) 50vw, 33vw")}
            </div>
          ))}
        </div>
      ) : (
        <ul className={cn("grid grid-cols-2 gap-3 sm:gap-5", items.length >= 3 && "lg:grid-cols-3")}>
          {items.map((x) => (
            <li key={x.id}>{tile(x, "aspect-square", "(max-width: 1024px) 50vw, 33vw")}</li>
          ))}
        </ul>
      )}
    </SectionShell>
  );
}

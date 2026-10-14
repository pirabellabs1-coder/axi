import { S } from "@/lib/storefront/theme-doc";
import { href, type SectionProps } from "../render-context";
import { ProductImage } from "../product-image";
import { SectionHeading, SectionShell } from "../ui";

export default function LogoList({ section, ctx }: SectionProps) {
  const logos = section.blocks.filter((b) => !b.disabled).map((b) => ({ id: b.id, img: S.img(b.settings, "image"), link: href(ctx, S.str(b.settings, "link") || null) })).filter((x) => x.img);
  if (!logos.length) return null;
  return (
    <SectionShell section={section} ctx={ctx}>
      <SectionHeading section={section} ctx={ctx} align="center" />
      <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {logos.map((l) => {
          const img = <ProductImage src={l.img!.url} alt={l.img!.alt ?? ""} ratio="aspect-[3/2]" fit="contain" className="w-28 !bg-transparent opacity-80 grayscale transition-[filter,opacity] duration-300 hover:opacity-100 hover:grayscale-0 sm:w-36" sizes="144px" />;
          return (
            <li key={l.id}>
              {l.link ? (
                <a href={l.link} {...(l.link.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  {img}
                </a>
              ) : (
                img
              )}
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

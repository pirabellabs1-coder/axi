import Link from "next/link";
import { S } from "@/lib/storefront/theme-doc";
import { formatDate, cn } from "@/lib/utils";
import type { SectionProps } from "../render-context";
import { RichText } from "../rich-text";
import { headingClass, SectionShell } from "../ui";

/** Page de contenu du commerçant (texte brut ou Markdown limité, jamais de HTML). */
export default function MainPage({ section, ctx }: SectionProps) {
  const page = ctx.data.page;
  if (!page) return null;
  const wide = S.str(section.settings, "width", "narrow") === "wide";
  const others = ctx.data.pages.filter((p) => p.title !== page.title);
  return (
    <SectionShell section={section} ctx={ctx} padded={false} className="pb-14 pt-6 sm:pt-12">
      <div className={cn("grid gap-10", others.length > 0 && "lg:grid-cols-[1fr_260px]")}>
        <article className={cn("sf-rise", wide ? "max-w-none" : "max-w-[68ch]")}>
          <h1 className={headingClass("lg")}>{page.title}</h1>
          <p className="mt-3 text-sm text-ink-muted">Mis à jour le {formatDate(page.updatedAt, { timeZone: "UTC" })}</p>
          <RichText text={page.body} base={ctx.base} className="mt-8 space-y-5 text-[17px] leading-relaxed text-ink-muted [&_h3]:text-ink" />
        </article>
        {others.length > 0 && (
          <nav aria-label="Autres pages" className="h-fit rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line lg:sticky lg:top-24">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">À lire aussi</p>
            <ul className="mt-2">
              {others.map((o) => (
                <li key={o.slug}>
                  <Link href={`${ctx.base}/pages/${o.slug}`} className="flex min-h-11 items-center text-[15px] text-ink hover:text-[var(--store-primary)]">
                    {o.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </SectionShell>
  );
}

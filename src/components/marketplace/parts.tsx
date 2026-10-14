import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { MEDIA, unsplash } from "@/config/media";
import { cn } from "@/lib/utils";

/** Titre de section : une seule idée, lien « Tout voir » optionnel. */
export function SectionHeading({
  id,
  title,
  description,
  href,
  hrefLabel = "Tout voir",
  withRailControls = false,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
  /** Réserve la place des flèches du carrousel (md+). */
  withRailControls?: boolean;
}) {
  return (
    <div className={cn("mb-6 flex min-h-11 flex-wrap items-end justify-between gap-x-6 gap-y-2 md:mb-8", withRailControls && "md:pr-28")}>
      <div className="min-w-0 max-w-2xl">
        <h2 id={id} className="text-h2 font-semibold text-ink">
          {title}
        </h2>
        {description && <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {href && (
        <Link href={href} className="group inline-flex h-11 items-center gap-1.5 rounded-full text-[15px] font-medium text-ink underline-offset-4 hover:underline">
          {hrefLabel}
          <ArrowRight className="size-4 transition-transform duration-300 ease-spring group-hover:translate-x-0.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** JSON-LD (échappe « < » pour éviter toute sortie de balise). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-ink-muted">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5 text-ink-faint" aria-hidden />}
            {it.href ? (
              <Link href={it.href} className="rounded hover:text-ink hover:underline underline-offset-4">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-ink">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Pagination({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (p: number) => string }) {
  if (pageCount <= 1) return null;
  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const list = [...pages].sort((a, b) => a - b);
  const cell = "inline-flex size-11 items-center justify-center rounded-full text-sm font-medium tabular transition-colors duration-200";
  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={cn(cell, "ring-1 ring-line hover:bg-surface-2")} aria-label="Page précédente" rel="prev">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(cell, "text-ink-faint opacity-50")} aria-hidden>
          <ChevronLeft className="size-4" />
        </span>
      )}
      {list.map((p, i) => (
        <span key={p} className="flex items-center gap-1.5">
          {i > 0 && p - list[i - 1] > 1 && <span className="px-1 text-ink-faint" aria-hidden>...</span>}
          {p === page ? (
            <span aria-current="page" className={cn(cell, "bg-ink text-canvas")}>
              {p}
            </span>
          ) : (
            <Link href={hrefFor(p)} className={cn(cell, "text-ink-muted hover:bg-surface-2 hover:text-ink")} aria-label={`Page ${p}`}>
              {p}
            </Link>
          )}
        </span>
      ))}
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} className={cn(cell, "ring-1 ring-line hover:bg-surface-2")} aria-label="Page suivante" rel="next">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(cell, "text-ink-faint opacity-50")} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}

/** Bloc « Vous êtes commerçant ? » : bloc forêt, vraie photo, un seul CTA. */
export function MerchantCta() {
  const m = MEDIA.apronPhone;
  return (
    <section aria-labelledby="mk-merchant" className="container-x py-20 md:py-28">
      <div className="reveal relative isolate grid grid-cols-1 overflow-hidden rounded-[var(--radius-2xl)] bg-forest text-white md:grid-cols-[1.1fr_1fr]">
        <div className="relative z-10 flex flex-col justify-center gap-5 p-7 sm:p-10 lg:p-14">
          <span className="eyebrow w-fit !bg-white/10 !text-lime !shadow-none">Vous êtes commerçant ?</span>
          <h2 id="mk-merchant" className="text-h2 font-semibold text-white">
            Votre boutique ici, et toute la vente avec.
          </h2>
          <p className="max-w-md text-[16px] leading-relaxed text-white/75">
            Boutique personnalisable, catalogue, paiements Mobile Money et carte, livraison, WhatsApp et connecteur IA. Toute boutique publiée peut apparaître gratuitement ici, et Axi ne prend aucune commission sur vos ventes.
          </p>
          <div>
            <ButtonLink href="/inscription" variant="accent" size="lg" trailing>
              Ouvrir ma boutique
            </ButtonLink>
          </div>
        </div>
        <div className="relative min-h-64 md:min-h-[420px]">
          <Image src={unsplash(m.id, 1000, 900)} alt={m.alt} fill sizes="(max-width: 768px) 100vw, 45vw" className="object-cover" />
          <div aria-hidden className="absolute inset-0 bg-linear-to-t from-forest/60 to-transparent md:bg-linear-to-r md:from-forest md:via-forest/10 md:to-transparent" />
        </div>
      </div>
    </section>
  );
}

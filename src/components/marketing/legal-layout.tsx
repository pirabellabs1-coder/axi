import Link from "next/link";
import { Prose } from "@/components/marketing/prose";

/** Gabarit des pages légales : en-tête, avertissement, sommaire collant et colonne de lecture. */
export function LegalLayout({ title, updated, toc, children }: { title: string; updated: string; toc: [string, string][]; children: React.ReactNode }) {
  return (
    <>
      <section className="pb-12 pt-12 md:pb-16 md:pt-20">
        <div className="container-x max-w-3xl lg:max-w-[1280px]">
          <p className="eyebrow animate-fade-up">Informations légales</p>
          <h1 className="mt-6 max-w-3xl text-h1 font-semibold text-ink animate-fade-up [animation-delay:60ms]">{title}</h1>
          <p className="mt-4 text-sm text-ink-muted animate-fade-up [animation-delay:120ms]">Dernière mise à jour : {updated}</p>
          <p className="mt-5 inline-block rounded-full bg-sun-soft px-4 py-2 text-[13px] text-ink animate-fade-up [animation-delay:160ms]">Document de travail à faire valider par un conseil juridique avant la mise en production.</p>
        </div>
      </section>
      <div className="container-x grid grid-cols-1 gap-12 border-t border-line pb-24 pt-12 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-20 lg:pt-16 md:pb-32">
        <nav aria-label="Sommaire" className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-sm font-semibold text-ink">Sommaire</p>
          <ol className="mt-3 space-y-0.5 text-sm">
            {toc.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="flex min-h-10 items-center rounded-full px-3 text-ink-muted transition-colors duration-300 hover:bg-surface-2 hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-[13px] leading-relaxed text-ink-muted">
            Voir aussi :{" "}
            <Link href="/legal/cgu" className="text-primary underline underline-offset-4">
              CGU
            </Link>
            ,{" "}
            <Link href="/legal/confidentialite" className="text-primary underline underline-offset-4">
              confidentialité
            </Link>
            ,{" "}
            <Link href="/legal/cookies" className="text-primary underline underline-offset-4">
              cookies
            </Link>
            .
          </p>
        </nav>
        <Prose as="article" className="max-w-[70ch]">
          {children}
        </Prose>
      </div>
    </>
  );
}

import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";
import { SITE } from "@/config/site";
import { MEDIA, unsplash } from "@/config/media";

export const metadata = {
  title: "Page introuvable",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-3 sm:px-4">
        <div className="mx-auto mt-3 flex h-16 max-w-[1180px] items-center rounded-full bg-surface/80 pl-5 pr-2 ring-1 ring-line sm:mt-4">
          <Logo />
        </div>
      </header>

      <main className="container-x flex flex-1 items-center py-16">
        <div className="grid grid-cols-1 w-full items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div className="max-w-xl">
            <p className="font-mono text-sm text-ink-muted animate-fade-up">Erreur 404</p>
            <h1 className="mt-4 text-h1 font-semibold text-ink animate-fade-up [animation-delay:60ms]">
              Cette page n&apos;est pas sur l&apos;étal. <span className="text-ink-muted">Le marché, lui, est ouvert.</span>
            </h1>
            <p className="mt-6 max-w-[48ch] text-lg leading-relaxed text-ink-muted animate-fade-up [animation-delay:120ms]">Le lien est peut-être erroné, ou la boutique a changé d&apos;adresse. Repartez de l&apos;accueil ou explorez les boutiques.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row animate-fade-up [animation-delay:180ms]">
              <ButtonLink href="/" variant="accent" size="lg" trailing>
                Retour à l&apos;accueil
              </ButtonLink>
              <ButtonLink href="/marketplace" variant="outline" size="lg">
                Voir la marketplace
              </ButtonLink>
            </div>
            <p className="mt-8 text-sm text-ink-muted animate-fade-up [animation-delay:240ms]">
              Besoin d&apos;aide ?{" "}
              <Link href="/aide" className="font-medium text-primary underline underline-offset-4">
                Centre d&apos;aide
              </Link>{" "}
              ou{" "}
              <Link href="/contact" className="font-medium text-primary underline underline-offset-4">
                contact
              </Link>
              .
            </p>
          </div>

          <div className="bezel animate-fade-up [animation-delay:120ms]">
            <div className="bezel-core relative aspect-[4/3] overflow-hidden">
              <Image src={unsplash(MEDIA.market.id, 1100, 825)} alt={MEDIA.market.alt} fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
            </div>
          </div>
        </div>
      </main>

      <footer className="container-x py-6 text-[13px] text-ink-faint">
        © {new Date().getFullYear()} {SITE.company}
      </footer>
    </div>
  );
}

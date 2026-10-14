import Image from "next/image";
import Link from "next/link";
import { BellRing, Check } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/misc";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { MEDIA, unsplash } from "@/config/media";

const PROMISES = ["Boutique en ligne en quelques minutes", "Commandes WhatsApp au même endroit", "Mobile Money, livraison ou retrait"];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Colonne formulaire */}
      <div className="flex min-h-dvh flex-col px-5 py-5 sm:px-10 sm:py-7">
        <div className="flex items-center justify-between gap-3">
          <Logo />
          <div className="flex items-center gap-1">
            <Link href="/aide" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink">
              Besoin d&apos;aide ?
            </Link>
            <ThemeToggle />
          </div>
        </div>

        <main className="flex flex-1 items-center justify-center py-10 sm:py-14">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>

        <p className="text-center text-xs text-ink-faint">
          © {new Date().getFullYear()} Axi
          <span aria-hidden> · </span>
          <Link href="/legal/confidentialite" className="inline-flex min-h-8 items-center hover:text-ink">
            Confidentialité
          </Link>
          <span aria-hidden> · </span>
          <Link href="/legal/cgu" className="inline-flex min-h-8 items-center hover:text-ink">
            Conditions d&apos;utilisation
          </Link>
        </p>
      </div>

      {/* Visuel (lg+) : vraie photo + bloc forêt + carte UI */}
      <aside aria-label="Axi en bref" className="relative hidden p-3 lg:block">
        <div className="sticky top-3 h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[var(--radius-2xl)] bg-forest ring-1 ring-line">
          <Image
            src={unsplash(MEDIA.shopCounter.id, 1400, 1600)}
            alt={MEDIA.shopCounter.alt}
            fill
            priority
            sizes="(min-width: 1024px) 52vw, 0px"
            className="object-cover"
          />
          <div aria-hidden className="absolute inset-0 bg-linear-to-t from-forest-deep/80 via-forest-deep/10 to-transparent" />

          {/* Carte notification construite avec les composants du kit */}
          <div className="absolute right-8 top-8 w-[300px] animate-fade-up motion-reduce:animate-none xl:right-10 xl:top-10">
            <div className="rounded-[var(--radius-lg)] bg-surface p-4 shadow-[0_24px_60px_-20px_rgb(7_35_25/0.55)] ring-1 ring-line">
              <div className="flex items-center gap-3">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
                  <BellRing className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">Nouvelle commande</p>
                  <p className="font-mono text-xs text-ink-muted">AX-7K3P9Q, via WhatsApp</p>
                </div>
                <Badge tone="success">Payée</Badge>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
                <span className="text-ink-muted">2 gâteaux, 1 bissap</span>
                <Money amount={14500} currency="XOF" className="font-semibold text-ink" />
              </div>
            </div>
            <p className="mt-2 text-right text-[11px] text-white/70">Exemple de notification</p>
          </div>

          {/* Bloc forêt : promesse */}
          <div className="absolute inset-x-6 bottom-6 rounded-[var(--radius-xl)] bg-forest p-7 text-white shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)] ring-1 ring-white/10 xl:inset-x-8 xl:bottom-8 xl:p-8">
            <p className="max-w-[22ch] text-[28px] font-semibold leading-[1.08] tracking-[-0.035em] xl:text-[32px]">
              Vendez sur WhatsApp, <span className="text-lime">sans rien perdre.</span>
            </p>
            <ul className="mt-6 grid gap-2.5 text-sm text-white/80">
              {PROMISES.map((p) => (
                <li key={p} className="flex items-center gap-2.5">
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-lime/15 text-lime">
                    <Check className="size-3" aria-hidden />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}

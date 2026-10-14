import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle, WifiOff } from "lucide-react";
import { waLink } from "@/lib/whatsapp";
import { db } from "@/lib/db";
import { RecentlySeen } from "@/components/storefront/pwa/recently-seen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Hors ligne", robots: { index: false, follow: false } };

/**
 * Page de repli servie par le service worker quand le réseau est indisponible (lot 4 §14).
 * Volontairement autonome : aucune donnée propre au visiteur, aucun appel réseau au chargement, pour qu'elle
 * reste valable une fois mise en cache à l'installation. Les derniers produits vus sont relus côté client
 * dans le cache HTML du service worker (`RecentlySeen`).
 */
export default async function OfflinePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await db.store.findFirst({
    where: { slug, status: { in: ["PUBLISHED", "CLOSED_TEMPORARILY"] } },
    select: { name: true, slug: true, whatsappNumber: true, contactPhone: true, pwaConfig: true },
  });
  if (!store) notFound();
  const { readPwaConfig } = await import("@/lib/pwa/config");
  const cfg = readPwaConfig(store.pwaConfig);
  const base = `/s/${store.slug}`;
  const digits = store.contactPhone?.replace(/\D/g, "") ?? "";

  return (
    <div className="container-x py-16 sm:py-24">
      <div className="mx-auto flex max-w-md flex-col items-center rounded-[var(--store-card-radius)] bg-surface px-6 py-12 text-center ring-1 ring-line">
        <span className="mb-5 inline-flex size-14 items-center justify-center rounded-full bg-[var(--store-primary-soft)] text-[var(--store-primary)]">
          <WifiOff className="size-6" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">Vous êtes hors ligne</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{cfg.offlineText ?? `Pas de connexion pour le moment. Les pages de ${store.name} déjà visitées restent consultables, et vous pouvez nous écrire sur WhatsApp dès le retour du réseau.`}</p>
        <div className="mt-6 flex w-full flex-col gap-3">
          <Link href={base} className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--store-primary)] px-6 text-sm font-semibold text-[var(--store-primary-contrast)] active:scale-[0.98]">
            Réessayer
          </Link>
          {store.whatsappNumber && (
            <a
              href={waLink(store.whatsappNumber, `Bonjour ${store.name}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-surface-2 px-6 text-sm font-semibold text-ink ring-1 ring-inset ring-line"
            >
              <MessageCircle className="size-4" aria-hidden />
              Écrire sur WhatsApp
            </a>
          )}
          {digits && (
            <a href={`tel:+${digits}`} className="inline-flex h-11 items-center justify-center text-sm font-medium text-ink-muted hover:text-ink">
              Appeler la boutique
            </a>
          )}
        </div>
        <RecentlySeen base={base} />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gift } from "lucide-react";
import { StoreChrome } from "@/components/storefront/storefront-view";
import { getStorefront } from "@/lib/storefront/data";
import { BalanceForm } from "./balance-form";

export const metadata: Metadata = { title: "Solde de carte cadeau", robots: { index: false } };

type Props = { params: Promise<{ slug: string }> };

/** Vérification publique du solde d'une carte cadeau (débit limité, message unique en cas d'échec). */
export default async function GiftCardBalancePage({ params }: Props) {
  const { slug } = await params;
  const store = (await getStorefront(slug))?.store;
  if (!store) notFound();
  return (
    <StoreChrome slug={store.slug}>
      <div className="sf-container max-w-[560px] pb-16 pt-8 sm:pt-14">
        <header className="text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full bg-[var(--store-primary)] text-[var(--store-primary-contrast)]">
            <Gift className="size-7" strokeWidth={2} aria-hidden />
          </span>
          <h1 className="mt-5 text-[clamp(1.6rem,4.5vw,2.2rem)] font-semibold leading-tight tracking-[-0.03em] text-ink">Solde de votre carte cadeau</h1>
          <p className="mx-auto mt-2 max-w-[44ch] text-[15px] text-ink-muted">Saisissez le code à 16 caractères reçu par message. Il reste confidentiel : ne le partagez pas.</p>
        </header>
        <div className="mt-8 rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line sm:p-6">
          <BalanceForm slug={store.slug} />
        </div>
        <p className="mt-6 text-center text-sm text-ink-muted">La carte s&apos;utilise au paiement, dans le champ « Carte cadeau ».</p>
      </div>
    </StoreChrome>
  );
}

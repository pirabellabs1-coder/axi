import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, FileText, Store, X } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { listUserStores } from "@/lib/auth/permissions";
import { Logo } from "@/components/ui/logo";
import { COUNTRIES, SITE } from "@/config/site";
import { ADD_ONS, PLANS, TRIAL_DAYS, TRIAL_PLAN, ZONE_CURRENCY, ZONE_LABEL, planPrice, zoneForCurrency, type PricingZone } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { db } from "@/lib/db";
import { billingZone } from "@/lib/billing/rules";
import { getEffectiveAddOnPrice } from "@/lib/pricing/catalog";
import { enforceAccountStoreLimit, getAccountStoresQuota } from "@/lib/store/account-quota-service";
import { storesQuotaLabel, type AccountStoresQuota } from "@/lib/store/account-quota";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { StoreWizard, type WizardCountry } from "./store-wizard";
import { PayExtraStoreButton } from "./extra-store-paywall";

export const metadata: Metadata = { title: "Nouvelle boutique" };

const ZONES: PricingZone[] = ["WORLD", "AFRICA"];

function byZone(fn: (zone: PricingZone) => string): Record<PricingZone, string> {
  return Object.fromEntries(ZONES.map((z) => [z, fn(z)])) as Record<PricingZone, string>;
}

/** Écran « payer d'abord » : place supplémentaire à acheter (Business/Scale) ou montée vers Business. */
async function StoreLimitScreen({ quota }: { quota: AccountStoresQuota }) {
  const primary = quota.primaryStoreId
    ? await db.store.findUnique({ where: { id: quota.primaryStoreId }, select: { id: true, name: true, currency: true, subscription: true } })
    : null;
  if (!primary) return null;
  const label = storesQuotaLabel(quota);
  if (!quota.canBuyExtra) {
    return (
      <section className="max-w-2xl rounded-[var(--radius-lg)] bg-surface p-6 ring-1 ring-line sm:p-8" aria-labelledby="limit-title">
        <h2 id="limit-title" className="text-xl font-semibold tracking-[-0.02em] text-ink">Vous avez atteint votre limite ({label})</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          Votre plan {PLANS[quota.bestPlan].name} comprend {quota.baseLimit} boutique{quota.baseLimit === 1 ? "" : "s"}. Pour ouvrir d&apos;autres boutiques sur le même compte, passez au plan {PLANS.BUSINESS.name} : il inclut {PLANS.BUSINESS.limits.stores} boutiques et permet d&apos;en ajouter d&apos;autres en option.
        </p>
        <div className="mt-6">
          <ButtonLink href={`/app/${primary.id}/abonnement`} variant="primary" size="lg" trailing={ArrowUpRight}>
            Passer au plan {PLANS.BUSINESS.name}
          </ButtonLink>
        </div>
      </section>
    );
  }
  const zone = billingZone(primary.subscription, primary.currency);
  const price = await getEffectiveAddOnPrice("EXTRA_STORE", zone);
  const amount = price.amount ?? ADD_ONS.find((a) => a.id === "EXTRA_STORE")!.price[zone];
  const priceLabel = `${formatMoney(amount, ZONE_CURRENCY[zone])}/mois`;
  const pending = await db.addOnPurchase.findFirst({ where: { storeId: primary.id, addOnId: "EXTRA_STORE", status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { invoiceId: true } });
  const openInvoice = pending?.invoiceId ? await db.invoice.findFirst({ where: { id: pending.invoiceId, status: "OPEN" }, select: { id: true, number: true } }) : null;
  return (
    <section className="max-w-2xl rounded-[var(--radius-lg)] bg-surface p-6 ring-1 ring-line sm:p-8" aria-labelledby="limit-title">
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-deep" aria-hidden>
        <Store className="size-5" />
      </span>
      <h2 id="limit-title" className="mt-4 text-xl font-semibold tracking-[-0.02em] text-ink">Ajouter une boutique : {priceLabel}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
        Vous utilisez toutes les places de votre compte ({label}). Réglez d&apos;abord l&apos;option « Boutique en plus » : dès le paiement confirmé, vous revenez ici pour créer votre boutique. Facturée sur {primary.name}, résiliable à tout moment (effet en fin de période).
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {openInvoice ? (
          <ButtonLink href={`/app/${primary.id}/abonnement/factures/${openInvoice.id}?option=1`} variant="primary" size="lg" trailing={FileText}>
            Régler la facture {openInvoice.number}
          </ButtonLink>
        ) : (
          <PayExtraStoreButton label={`Payer ${priceLabel}`} />
        )}
      </div>
      {openInvoice && <p className="mt-3 text-sm text-ink-muted">Une facture est déjà en attente pour cette place : réglez-la pour débloquer la création.</p>}
    </section>
  );
}

export default async function NewStorePage({ searchParams }: { searchParams: Promise<{ debloquee?: string }> }) {
  const user = (await getCurrentUser())!;
  const { debloquee } = await searchParams;
  await enforceAccountStoreLimit(user.id).catch(() => undefined);
  const [stores, quota] = await Promise.all([listUserStores(user.id), getAccountStoresQuota(user.id)]);
  const first = stores.length === 0;
  const blocked = !quota.firstStore && !quota.allowed;
  const firstName = user.name.split(" ")[0];

  const countries: WizardCountry[] = COUNTRIES.map((c) => ({ code: c.code, name: c.name, currency: c.currency, zone: zoneForCurrency(c.currency) }));
  const trialPrice = byZone((z) => {
    const p = planPrice(TRIAL_PLAN, z);
    return p.amount == null ? "sur devis" : formatMoney(p.amount, p.currency);
  });
  const dfy = ADD_ONS.find((a) => a.id === "DONE_FOR_YOU")!;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="container-x flex h-16 items-center justify-between sm:h-20">
        <Logo href="/app" />
        {!first && (
          <Link href="/app" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink">
            <X className="size-4" aria-hidden /> Annuler
          </Link>
        )}
      </header>
      <main className="container-x pb-16 pt-4 sm:pt-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 max-w-2xl">
            <h1 className="text-[32px] font-semibold leading-[1.04] tracking-[-0.04em] text-ink sm:text-[44px]">
              {first ? `Bienvenue ${firstName}, créons votre boutique.` : "Nouvelle boutique"}
            </h1>
            {!quota.firstStore && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-sm font-medium text-ink-muted">
                <Store className="size-4" aria-hidden /> {storesQuotaLabel(quota)}
              </p>
            )}
            {!blocked && <p className="mt-3 text-[15px] leading-relaxed text-ink-muted sm:text-base">Cinq questions rapides. Vous pourrez tout modifier ensuite.</p>}
          </div>
          {debloquee && !blocked && (
            <Alert tone="success" title="Place débloquée" className="mb-6 max-w-2xl">
              Paiement confirmé : vous pouvez créer votre nouvelle boutique.
            </Alert>
          )}
          {blocked ? (
            <StoreLimitScreen quota={quota} />
          ) : (
          <StoreWizard
            domain={SITE.domain}
            countries={countries}
            zoneLabel={ZONE_LABEL}
            firstStore={first}
            trial={{ planName: PLANS[TRIAL_PLAN].name, days: TRIAL_DAYS, price: trialPrice }}
            doneForYou={{ name: dfy.name, description: dfy.description, price: byZone((z) => formatMoney(dfy.price[z], ZONE_CURRENCY[z])) }}
          />
          )}
        </div>
      </main>
    </div>
  );
}

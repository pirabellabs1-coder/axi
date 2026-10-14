import type { Metadata } from "next";
import Link from "next/link";
import { X } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { listUserStores } from "@/lib/auth/permissions";
import { Logo } from "@/components/ui/logo";
import { COUNTRIES, SITE } from "@/config/site";
import { ADD_ONS, PLANS, TRIAL_DAYS, TRIAL_PLAN, ZONE_CURRENCY, ZONE_LABEL, planPrice, zoneForCurrency, type PricingZone } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { StoreWizard, type WizardCountry } from "./store-wizard";

export const metadata: Metadata = { title: "Nouvelle boutique" };

const ZONES: PricingZone[] = ["WORLD", "AFRICA"];

function byZone(fn: (zone: PricingZone) => string): Record<PricingZone, string> {
  return Object.fromEntries(ZONES.map((z) => [z, fn(z)])) as Record<PricingZone, string>;
}

export default async function NewStorePage() {
  const user = (await getCurrentUser())!;
  const stores = await listUserStores(user.id);
  const first = stores.length === 0;
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
            <p className="mt-3 text-[15px] leading-relaxed text-ink-muted sm:text-base">Cinq questions rapides. Vous pourrez tout modifier ensuite.</p>
          </div>
          <StoreWizard
            domain={SITE.domain}
            countries={countries}
            zoneLabel={ZONE_LABEL}
            firstStore={first}
            trial={{ planName: PLANS[TRIAL_PLAN].name, days: TRIAL_DAYS, price: trialPrice }}
            doneForYou={{ name: dfy.name, description: dfy.description, price: byZone((z) => formatMoney(dfy.price[z], ZONE_CURRENCY[z])) }}
          />
        </div>
      </main>
    </div>
  );
}

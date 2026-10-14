import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { TAX_DISCLAIMER, taxPresetFor } from "@/config/taxes";
import { hasTaxRegistration, parseTaxRegistration } from "@/lib/tax/registration";
import { computeTaxes, formatRateBps } from "@/lib/tax/compute";
import { formatMoney } from "@/lib/money";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PlanGate } from "@/components/app/plan-gate";
import { TaxSettingsForm } from "./tax-settings-form";
import { TaxRatesManager } from "./tax-rates-manager";

export const metadata: Metadata = { title: "Taxes et factures" };

export default async function TaxSettingsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const features = PLANS[ctx.planId].features;
  const back = { href: `/app/${store.id}/parametres`, label: "Paramètres" };
  const title = "Taxes et factures";

  if (!features.taxes && !store.taxesEnabled) {
    return (
      <>
        <PageHeader back={back} title={title} />
        <PlanGate storeId={store.id} feature="taxes" />
      </>
    );
  }

  // Première configuration (aucune identité fiscale enregistrée) : émission automatique proposée COCHÉE,
  // alors que le défaut de lecture est `false` (aucune facture immuable émise sans demande explicite).
  const saved = parseTaxRegistration(store.taxRegistration);
  const registration = { ...saved, autoIssueInvoices: saved.autoIssueInvoices || !hasTaxRegistration(store.taxRegistration) };
  const rates = await db.taxRate.findMany({
    where: { storeId: store.id },
    orderBy: [{ country: "asc" }, { taxCategory: "asc" }],
    select: { id: true, name: true, country: true, taxCategory: true, rateBps: true, appliesToShipping: true, active: true },
  });
  const preset = taxPresetFor(store.country);
  const hasStandard = rates.some((r) => r.country === store.country && r.taxCategory === "standard");
  const standard = rates.find((r) => r.country === store.country && r.taxCategory === "standard" && r.active);

  // Exemple chiffré avec les réglages enregistrés (10 000 + livraison 1 000).
  const example = standard
    ? computeTaxes({ lines: [{ net: 10_000, taxable: true, taxCategory: "standard" }], delivery: { amount: 1_000 }, settings: { enabled: true, pricesIncludeTax: store.pricesIncludeTax, rates: [standard] } })
    : null;
  const m = (n: number) => formatMoney(n, store.currency);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader back={back} title={title} description="TVA par pays, prix TTC ou HT, identité fiscale et factures numérotées. Les factures émises ne changent jamais." />
      {!features.taxes && (
        <Alert tone="warning" className="mb-5">
          Votre plan n&apos;inclut plus les taxes : vous pouvez seulement les désactiver.
        </Alert>
      )}
      <Alert tone="info" className="mb-5">
        {TAX_DISCLAIMER}
      </Alert>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Réglages fiscaux" description={`Pays de taxation : ${store.country} (pays de la boutique).`} />
          <CardBody>
            <TaxSettingsForm
              storeId={store.id}
              taxesEnabled={store.taxesEnabled}
              pricesIncludeTax={store.pricesIncludeTax}
              registration={registration}
              locked={!features.taxes}
              invoicesInPlan={features.invoices}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Taux" description="Un taux par pays et par catégorie de produit. Les commandes et factures passées gardent le taux de leur date." />
          <CardBody>
            <TaxRatesManager
              storeId={store.id}
              storeCountry={store.country}
              rates={rates}
              preset={!hasStandard && preset ? { label: `${preset.name} ${formatRateBps(preset.rateBps)} (${preset.countryName}, indicatif)` } : null}
              locked={!features.taxes}
            />
          </CardBody>
        </Card>

        {example && standard && (
          <Card>
            <CardHeader title="Exemple" description="Article à 10 000 et livraison à 1 000, avec vos réglages." />
            <CardBody>
              <dl className="max-w-sm space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt>Article</dt>
                  <dd className="font-mono tabular">{m(10_000)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Livraison</dt>
                  <dd className="font-mono tabular">{m(1_000)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>
                    {store.pricesIncludeTax ? "dont " : ""}
                    {standard.name} ({formatRateBps(standard.rateBps)})
                  </dt>
                  <dd className="font-mono tabular">{m(example.taxTotal)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-line pt-2 font-semibold">
                  <dt>Total payé par le client</dt>
                  <dd className="font-mono tabular">{m(11_000 + example.addToTotal)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-ink-muted">Taxe arrondie par ligne : l&apos;écart avec un calcul global est d&apos;au plus 1 {store.currency} par ligne.</p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

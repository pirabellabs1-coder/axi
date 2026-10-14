import type { Metadata } from "next";
import { Coins, Info } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanGate } from "@/components/app/plan-gate";
import { convertPrice, formatRate, makeFx, FX_MAX_AGE_MS } from "@/lib/currency/convert";
import { isRoundingRule, ROUNDING_LABELS } from "@/lib/currency/rounding";
import { currencyAllowance, loadPlatformRates, storeRateFor } from "@/lib/currency/rates";
import { CURRENCY_NAMES, currencyName } from "@/lib/currency/pick";
import { AddCurrencyForm, CurrencyRow, FixedPriceForm, FixedPricesList } from "./devises-client";

export const metadata: Metadata = { title: "Devises" };

const fmtDateTime = (d: Date) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Porto-Novo" }).format(d);
const label = (c: string) => (c === "XOF" || c === "XAF" ? "FCFA" : c);

export default async function CurrenciesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const allowance = currencyAllowance(ctx.planId);
  const now = new Date();

  const [rows, rates, prices, products] = await Promise.all([
    db.storeCurrency.findMany({ where: { storeId: store.id, currency: { not: store.currency } }, orderBy: { createdAt: "asc" } }),
    loadPlatformRates({ fresh: true }),
    db.productPrice.findMany({ where: { storeId: store.id }, orderBy: [{ currency: "asc" }, { updatedAt: "desc" }], take: 200, include: { product: { select: { name: true, price: true } } } }),
    db.product.findMany({ where: { storeId: store.id, status: "ACTIVE", isGiftCard: false, variants: { none: {} } }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true, price: true } }),
  ]);

  const enabledCount = rows.filter((r) => r.enabled).length;
  const canAdd = allowance == null || (allowance > 0 && enabledCount < allowance);
  // Exemple de conversion : 10 000 FCFA, ou 100,00 dans une devise à centimes.
  const sample = 10_000;

  // Devises proposées à l'ajout : parités fixes et devises BCE (taux automatique), puis devises usuelles (taux manuel).
  const autoCodes = new Set<string>(["EUR", "XOF", "XAF", ...rates.filter((r) => r.base === "EUR").map((r) => r.quote)]);
  const known = new Set(rows.map((r) => r.currency));
  const suggestions = [...new Set([...autoCodes, ...Object.keys(CURRENCY_NAMES)])]
    .filter((c) => c !== store.currency && !known.has(c))
    .sort((a, b) => Number(autoCodes.has(b)) - Number(autoCodes.has(a)) || a.localeCompare(b))
    .map((code) => ({ code, label: `${code} · ${currencyName(code)}${autoCodes.has(code) ? "" : " (taux manuel)"}` }));

  const view = rows.map((r) => {
    const rate = storeRateFor(store.currency, r, rates, now);
    const rounding = isRoundingRule(r.rounding) ? r.rounding : "NONE";
    const fx = rate && !rate.stale ? makeFx({ base: store.currency, quote: r.currency, rate: rate.rate, markupBps: r.markupBps, rounding, source: rate.source }) : null;
    const status: { tone: "success" | "warning" | "neutral" | "danger"; text: string } = !r.enabled
      ? { tone: "neutral", text: "Désactivée" }
      : !rate
        ? { tone: "danger", text: "Aucun taux" }
        : rate.stale
          ? { tone: "warning", text: "Taux de plus de 72 h : non affichée" }
          : { tone: "success", text: "Affichée" };
    return {
      currency: r.currency,
      name: currencyName(r.currency),
      enabled: r.enabled,
      rateMode: r.rateMode === "manual" ? ("manual" as const) : ("auto" as const),
      manualRate: r.manualRate?.toString() ?? "",
      markupPercent: (r.markupBps / 100).toString().replace(".", ","),
      rounding,
      roundingLabel: ROUNDING_LABELS[rounding],
      status,
      rateLine: rate
        ? `1 ${label(r.currency)} = ${formatRate({ num: rate.rate.den, den: rate.rate.num }).replace(/\.?0+$/, "").replace(".", ",")} ${label(store.currency)} (${rate.source === "manual" ? "taux manuel" : rate.source.includes("ECB") ? `BCE${rate.fetchedAt ? `, ${fmtDateTime(rate.fetchedAt)}` : ""}` : "parité fixe BCEAO"})`
        : "Aucun taux automatique : passez en mode manuel.",
      example: fx ? `${formatMoney(sample, store.currency)} ≈ ${formatMoney(convertPrice(sample, fx), r.currency)}` : null,
    };
  });

  return (
    <>
      <PageHeader
        title="Devises"
        description={`Affichez vos prix dans d'autres devises pour vos clients à l'étranger. Les commandes restent calculées et encaissées en ${label(store.currency)}.`}
      />

      {allowance === 0 ? (
        <PlanGate storeId={store.id} feature="multiCurrency" description={`L'affichage en plusieurs devises est inclus à partir du plan Starter. Votre plan actuel : ${plan.name}.`} />
      ) : (
        <div className="space-y-6">
          <Alert tone="info" title="Comment ça marche">
            Le client choisit sa devise dans l&apos;en-tête de la boutique. Remises, paliers et livraison offerte restent évalués en {label(store.currency)} ; les prix sont ensuite convertis et arrondis. Le
            Mobile Money est toujours débité en {label(store.currency)}, avec la mention « Vous serez débité de … ». Les cartes cadeaux ne s&apos;utilisent qu&apos;en {label(store.currency)}.
          </Alert>

          <Card as="section" aria-labelledby="cur-title">
            <CardHeader
              className="pb-4"
              title={
                <span id="cur-title" className="inline-flex flex-wrap items-center gap-2">
                  Devises affichées
                  <Badge tone={canAdd ? "neutral" : "sun"}>
                    <span className="tabular">{allowance == null ? `${enabledCount} active${enabledCount > 1 ? "s" : ""}, sans limite` : `${enabledCount} / ${allowance}`}</span>
                  </Badge>
                </span>
              }
              description="Taux automatique (BCE, quotidien ; parité fixe FCFA/euro) ou manuel, marge de change et arrondi commercial."
            />
            <div className="border-t border-line">
              {view.length === 0 ? (
                <EmptyState compact icon={Coins} title="Aucune devise supplémentaire" description="Ajoutez par exemple l'euro pour vos clients de la diaspora." />
              ) : (
                <ul className="divide-y divide-line">
                  {view.map((v) => (
                    <CurrencyRow key={v.currency} storeId={store.id} storeCurrency={store.currency} row={v} />
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-line p-4 sm:p-5">
              {canAdd ? (
                <AddCurrencyForm storeId={store.id} options={suggestions} />
              ) : (
                <PlanGate
                  compact
                  storeId={store.id}
                  plan={ctx.planId === "STARTER" ? "BUSINESS" : ctx.planId === "BUSINESS" ? "SCALE" : "ENTERPRISE"}
                  title="Plus de devises"
                  limit={{ label: "devises", used: enabledCount, max: allowance ?? 0 }}
                />
              )}
            </div>
          </Card>

          <Card as="section" aria-labelledby="fixed-title">
            <CardHeader
              className="pb-4"
              title={<span id="fixed-title">Prix fixés par devise</span>}
              description="Pour un produit sans variantes, imposez un prix rond dans une devise (par exemple 15 €) : il remplace la conversion. Une promotion en cours reste prioritaire."
            />
            <div className="border-t border-line">
              <FixedPricesList
                storeId={store.id}
                prices={prices.map((p) => ({ id: p.id, productName: p.product.name, currency: p.currency, price: p.price, compareAtPrice: p.compareAtPrice, basePrice: p.product.price, baseCurrency: store.currency }))}
              />
            </div>
            <div className="border-t border-line p-4 sm:p-5">
              {rows.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-ink-muted">
                  <Info className="size-4 shrink-0" aria-hidden /> Ajoutez d&apos;abord une devise.
                </p>
              ) : products.length === 0 ? (
                <p className="text-sm text-ink-muted">Aucun produit actif sans variantes.</p>
              ) : (
                <FixedPriceForm storeId={store.id} currencies={rows.map((r) => r.currency)} products={products.map((p) => ({ id: p.id, name: p.name, price: formatMoney(p.price, store.currency) }))} />
              )}
            </div>
          </Card>

          <p className="text-xs text-ink-muted">
            Un taux automatique de plus de {FX_MAX_AGE_MS / 3_600_000} h n&apos;est plus utilisé : la boutique s&apos;affiche alors en {label(store.currency)}. Les taux manuels sont sous votre responsabilité et ne
            périment pas.
          </p>
        </div>
      )}
    </>
  );
}

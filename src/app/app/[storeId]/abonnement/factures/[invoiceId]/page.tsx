import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Printer, Smartphone, Landmark, CreditCard, ShieldCheck } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS, zoneForCurrency, type PlanId } from "@/config/plans";
import { SITE } from "@/config/site";
import { PROVIDER_LABEL, platformBankDetails, platformMomoNumber, platformProviderFor, providerReady } from "@/lib/billing/platform-billing";
import { invoiceLines, addOnInvoiceIds, isPlanChangeInvoice } from "@/lib/billing/service";
import { syncStoreBilling } from "@/lib/billing/lifecycle";
import { formatDate } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ManualPayBox, OnlinePayButton } from "../../plans-client";
import { INV_LABEL, INV_TONE } from "../../billing-ui";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Facture" };

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string; invoiceId: string }>;
  searchParams: Promise<{ retour?: string; option?: string }>;
}) {
  const { storeId, invoiceId } = await params;
  const { retour, option } = await searchParams;
  const ctx = await getStoreContext(storeId, "billing.manage");
  const store = ctx.store;
  await syncStoreBilling(store.id).catch(() => undefined);
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, subscription: { storeId: store.id } } });
  if (!inv) notFound();
  const [lines, addonIds, isChange] = await Promise.all([invoiceLines(inv), addOnInvoiceIds([inv.id]), isPlanChangeInvoice(inv.id)]);
  const isAddOn = addonIds.has(inv.id);
  const isDomain = !!(await db.domainCharge.findUnique({ where: { invoiceId: inv.id }, select: { id: true } }));
  const zone = zoneForCurrency(inv.currency);
  const provider = platformProviderFor(zone);
  const online = provider !== "manual" && providerReady(provider);
  const payable = inv.status === "OPEN" || inv.status === "DRAFT" || inv.status === "UNCOLLECTIBLE";
  const subtotal = lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
  const sameDay = inv.periodEnd.getTime() - inv.periodStart.getTime() < 86_400_000;
  const [bank, momoNumber] = await Promise.all([platformBankDetails(), platformMomoNumber()]);

  return (
    <>
      {/* Impression : seule la facture est imprimée (coque applicative masquée). */}
      <style>{`@media print { aside, header:not([data-invoice]), nav, [data-app-chrome] { display: none !important; } main { padding: 0 !important; margin: 0 !important; } body { background: #fff !important; } }`}</style>
      <div className="print:hidden">
        <PageHeader title={`Facture ${inv.number}`} back={{ href: `/app/${store.id}/abonnement`, label: "Abonnement" }} actions={<PrintButton />} />
        <div className="mb-6 space-y-3">
          {retour && inv.status !== "PAID" && (
            <Alert tone="info" title="Paiement en cours de confirmation">
              La confirmation du fournisseur arrive en quelques instants. Le statut se met à jour automatiquement : rechargez la page si besoin.
            </Alert>
          )}
          {option && inv.status !== "PAID" && (
            <Alert tone="info" title="Votre option est réservée">
              Elle s'active automatiquement dès que le paiement de cette facture est confirmé. Les crédits des packs sont valables 12 mois.
            </Alert>
          )}
          {isChange && payable && (
            <Alert tone="warning" title={`Plan ${PLANS[inv.planId as PlanId].name} en attente de paiement`}>
              Votre plan actuel reste en place. Le plan {PLANS[inv.planId as PlanId].name} démarre dès la confirmation du paiement de cette facture, pour une période complète à partir de cette date.
            </Alert>
          )}
          {inv.status === "PAID" && (
            <Alert tone="success" title="Facture réglée">
              Merci. Paiement reçu le {inv.paidAt ? formatDate(inv.paidAt) : ""}. {isDomain ? "L'opération sur votre nom de domaine est lancée : suivez-la depuis la page Domaine." : isAddOn ? "Votre option est active." : "Votre abonnement est actif."}
            </Alert>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] print:block">
        <article
          className="rounded-[var(--radius-lg)] bg-surface p-6 ring-1 ring-line shadow-[var(--shadow-card)] sm:p-10 print:rounded-none print:p-0 print:shadow-none print:ring-0"
          aria-labelledby="invoice-title"
        >
          <header data-invoice className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-8">
            <div>
              <p className="text-xl font-semibold tracking-[-0.03em] text-ink">{SITE.name}</p>
              <p className="mt-2 text-sm text-ink-muted">{SITE.company}</p>
              <p className="text-sm text-ink-muted">{SITE.address}</p>
              <p className="text-sm text-ink-muted">{SITE.supportEmail}</p>
            </div>
            <div className="sm:text-right">
              <h1 id="invoice-title" className="text-sm font-medium uppercase tracking-[0.08em] text-ink-muted">Facture</h1>
              <p className="mt-1 font-mono text-lg text-ink">{inv.number}</p>
              <div className="mt-2 sm:flex sm:justify-end">
                <Badge tone={INV_TONE[inv.status]} dot>{INV_LABEL[inv.status]}</Badge>
              </div>
            </div>
          </header>

          <section className="grid grid-cols-1 gap-6 py-8 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">Facturé à</p>
              <p className="mt-2 font-medium text-ink">{store.name}</p>
              {store.address && <p className="text-ink-muted">{store.address}</p>}
              {store.city && <p className="text-ink-muted">{store.city}</p>}
              {store.contactEmail && <p className="text-ink-muted">{store.contactEmail}</p>}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">Dates</p>
              <p className="mt-2 text-ink">Émise le {formatDate(inv.createdAt)}</p>
              <p className="text-ink-muted">Échéance le {formatDate(inv.dueAt)}</p>
              {inv.paidAt && <p className="text-ink-muted">Réglée le {formatDate(inv.paidAt)}</p>}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">Période</p>
              <p className="mt-2 text-ink">{sameDay ? `Achat du ${formatDate(inv.periodStart)}` : `Du ${formatDate(inv.periodStart)} au ${formatDate(inv.periodEnd)}`}</p>
              <p className="text-ink-muted">Devise : {inv.currency === "XOF" ? "franc CFA (FCFA)" : inv.currency === "EUR" ? "euro (€)" : inv.currency}</p>
            </div>
          </section>

          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <caption className="sr-only">Détail de la facture {inv.number}</caption>
              <thead className="border-y border-line text-left text-xs uppercase tracking-[0.06em] text-ink-muted">
                <tr>
                  <th scope="col" className="py-3 font-medium">Désignation</th>
                  <th scope="col" className="w-16 py-3 text-right font-medium">Qté</th>
                  <th scope="col" className="w-36 py-3 text-right font-medium">Montant</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-line align-top">
                    <td className="py-4 pr-4">
                      <p className="font-medium text-ink">{l.label}</p>
                      {l.detail && <p className="mt-0.5 text-ink-muted">{l.detail}</p>}
                    </td>
                    <td className="py-4 text-right tabular text-ink-muted">{l.amount < 0 ? "" : l.quantity}</td>
                    <td className="py-4 text-right font-mono tabular text-ink">{formatMoney(l.amount, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {lines.length > 1 && (
                  <tr>
                    <td colSpan={2} className="pt-4 text-right text-ink-muted">Sous-total</td>
                    <td className="pt-4 text-right font-mono tabular text-ink">{formatMoney(subtotal, inv.currency)}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={2} className="pt-3 text-right font-medium text-ink">{inv.status === "PAID" ? "Total payé" : "Total à payer"}</td>
                  <td className="pt-3 text-right text-xl font-semibold tracking-[-0.03em] text-ink tabular">{formatMoney(inv.amount, inv.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <footer className="mt-10 space-y-1 border-t border-line pt-5 text-xs text-ink-muted">
            <p>TVA non applicable, à adapter selon le régime fiscal de {SITE.company}. Paiement à réception, au plus tard le {formatDate(inv.dueAt)}.</p>
            <p>0 % de commission sur vos ventes : cette facture couvre uniquement votre abonnement et vos options {SITE.name}.</p>
          </footer>
        </article>

        <aside className="space-y-4 print:hidden" aria-label="Paiement">
          {payable ? (
            <div className="bezel">
              <div className="bezel-core p-5">
                <p className="text-sm text-ink-muted">Montant à payer</p>
                <p className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.04em] text-ink tabular">{formatMoney(inv.amount, inv.currency)}</p>
                <p className="mt-1.5 text-xs text-ink-muted">Échéance le {formatDate(inv.dueAt)}</p>

                <div className="mt-5 space-y-4 border-t border-line pt-5">
                  {online && (
                    <>
                      <p className="flex items-center gap-2 text-sm font-medium text-ink">
                        {zone === "AFRICA" ? <Smartphone className="size-4 text-ink-muted" aria-hidden /> : <CreditCard className="size-4 text-ink-muted" aria-hidden />}
                        {zone === "AFRICA" ? "Mobile Money" : "Carte bancaire"}
                      </p>
                      <OnlinePayButton storeId={store.id} invoiceId={inv.id} label={zone === "AFRICA" ? "Payer par Mobile Money" : "Payer par carte"} />
                      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Paiement sécurisé chez {PROVIDER_LABEL[provider]}. Aucune donnée de carte ne transite par {SITE.name}.
                      </p>
                    </>
                  )}
                  {online ? (
                    <details className="group rounded-[var(--radius-md)] bg-surface-2 px-4 py-3 ring-1 ring-inset ring-line">
                      <summary className="flex min-h-8 cursor-pointer items-center text-sm font-medium text-ink">Payer autrement</summary>
                      <div className="mt-3">
                        <ManualInstructions zone={zone} storeId={store.id} invoiceId={inv.id} amount={formatMoney(inv.amount, inv.currency)} bank={bank} momoNumber={momoNumber} />
                      </div>
                    </details>
                  ) : (
                    <ManualInstructions zone={zone} storeId={store.id} invoiceId={inv.id} amount={formatMoney(inv.amount, inv.currency)} bank={bank} momoNumber={momoNumber} />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-line">
              <p className="text-sm font-medium text-ink">{inv.status === "PAID" ? "Facture réglée" : "Facture annulée"}</p>
              <p className="mt-1 text-sm text-ink-muted">{inv.status === "PAID" ? "Conservez-la pour votre comptabilité : Imprimer, puis Enregistrer en PDF." : "Cette facture a été remplacée ou annulée. Aucun paiement n'est attendu."}</p>
            </div>
          )}

          {ctx.user.isPlatformAdmin && (
            <div className="rounded-[var(--radius-md)] bg-surface-2 p-4 text-xs text-ink-muted ring-1 ring-inset ring-line">
              <p className="font-medium text-ink">Point d'intégration (visible par l'admin)</p>
              <p className="mt-1">
                Fournisseur zone {zone === "AFRICA" ? "Afrique" : "Monde"} : <code>{provider}</code>
                {provider !== "manual" && !online ? " (clés manquantes)" : ""}. Variables <code>PLATFORM_BILLING_PROVIDER_{zone}</code>, <code>PLATFORM_MOMO_NUMBER</code>, <code>PLATFORM_BANK_DETAILS</code>. Voir <code>src/lib/billing/platform-billing.ts</code>.
              </p>
            </div>
          )}

          <p className="flex items-center gap-1.5 px-1 text-xs text-ink-muted">
            <Printer className="size-3.5" aria-hidden /> « Imprimer » permet aussi d'enregistrer la facture en PDF.
          </p>
        </aside>
      </div>
    </>
  );
}

function ManualInstructions({ zone, storeId, invoiceId, amount, bank, momoNumber }: { zone: "AFRICA" | "WORLD"; storeId: string; invoiceId: string; amount: string; bank: string | null; momoNumber: string }) {
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        {zone === "AFRICA" ? <Smartphone className="size-4 text-ink-muted" aria-hidden /> : <Landmark className="size-4 text-ink-muted" aria-hidden />}
        {zone === "AFRICA" ? "Mobile Money (manuel)" : "Virement bancaire"}
      </p>
      <ManualPayBox
        storeId={storeId}
        invoiceId={invoiceId}
        amount={amount}
        instructions={
          zone === "AFRICA" ? (
            <>
              par Mobile Money au <strong className="font-mono">+{momoNumber}</strong> ({SITE.company}).
            </>
          ) : bank ? (
            <>
              par virement : <span className="font-mono text-xs">{bank}</span>. Indiquez le numéro de facture en libellé.
            </>
          ) : (
            <>par virement : écrivez à {SITE.supportEmail} pour recevoir nos coordonnées bancaires.</>
          )
        }
      />
    </div>
  );
}

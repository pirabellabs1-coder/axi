import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { TAX_REGIME_LABELS, type TaxRegime } from "@/config/taxes";
import { formatRateBps } from "./compute";
import type { InvoiceSnapshot } from "./snapshot";

/**
 * Document imprimable d'une facture ou d'un avoir. Rendu serveur, lu UNIQUEMENT depuis l'instantané immuable.
 * Utilisé par /app/[storeId]/commandes/[orderId]/facture et /suivi/[token]/facture.
 */

/** CSS d'impression commun : masque la navigation, une page par document, noir sur blanc. */
export const INVOICE_PRINT_CSS = `
@media print {
  aside, header, nav, [data-print-hide] { display: none !important; }
  html, body { background: #fff !important; }
  main { padding: 0 !important; }
  .invoice-root { max-width: none !important; margin: 0 !important; padding: 0 !important; }
  .invoice-sheet { border: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; background: #fff !important; color: #000 !important; break-after: page; }
  .invoice-sheet:last-child { break-after: auto; }
  .invoice-sheet * { color: inherit !important; border-color: #cfcfcf !important; background: transparent !important; }
  .invoice-sheet tr { break-inside: avoid; }
  @page { margin: 12mm; }
}`;

export function InvoiceDocument({ doc }: { doc: InvoiceSnapshot }) {
  const cur = doc.currency;
  const m = (n: number) => formatMoney(n, cur);
  const isCredit = doc.kind === "CREDIT_NOTE";
  const title = isCredit ? "Avoir" : "Facture";
  const seller = doc.seller;
  const regime = TAX_REGIME_LABELS[seller.regime as TaxRegime] ?? seller.regime;
  const hasTax = doc.totals.tax > 0;
  const shipping = doc.shipping;

  return (
    <article className="invoice-sheet rounded-[var(--radius-lg)] bg-surface p-5 text-ink ring-1 ring-line shadow-[var(--shadow-card)] sm:p-10" lang="fr" aria-label={`${title} ${doc.number}`}>
      <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">{seller.legalName || seller.name}</p>
          {seller.legalName && seller.legalName !== seller.name && <p className="text-sm text-ink-muted">Nom commercial : {seller.name}</p>}
          {seller.address && <p className="text-sm text-ink-muted [overflow-wrap:anywhere]">{seller.address}</p>}
          {seller.taxId && <p className="text-sm">N° fiscal (IFU / NIF) : {seller.taxId}</p>}
          {seller.rccm && <p className="text-sm">RCCM : {seller.rccm}</p>}
          <p className="text-sm text-ink-muted">{regime}</p>
          {(seller.phone || seller.email) && <p className="text-sm text-ink-muted">{[seller.phone, seller.email].filter(Boolean).join(" · ")}</p>}
        </div>
        <div className="sm:text-right">
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h2>
          <p className="font-mono text-lg font-semibold">{doc.number}</p>
          <p className="text-sm text-ink-muted">Émis le {formatDate(doc.issuedAt, { day: "numeric", month: "long", year: "numeric" })}</p>
          <p className="text-sm text-ink-muted">
            Commande {doc.order.reference} du {formatDate(doc.order.createdAt)}
          </p>
          {isCredit && doc.creditNote && <p className="text-sm font-medium">Sur facture {doc.creditNote.invoiceNumber}</p>}
        </div>
      </div>

      <section className="mt-5 text-sm" aria-labelledby={`buyer-${doc.number}`}>
        <h3 id={`buyer-${doc.number}`} className="text-xs font-medium text-ink-muted">
          {isCredit ? "Bénéficiaire" : "Facturé à"}
        </h3>
        {doc.buyer.company && <p className="mt-1 font-semibold [overflow-wrap:anywhere]">{doc.buyer.company}</p>}
        {doc.buyer.company && doc.buyer.taxId && <p>N° fiscal : {doc.buyer.taxId}</p>}
        <p className={doc.buyer.company ? "" : "mt-1 font-medium"}>{doc.buyer.name}</p>
        {doc.buyer.address && <p className="[overflow-wrap:anywhere]">{doc.buyer.address}</p>}
        <p className="text-ink-muted">{[doc.buyer.phone ? `+${doc.buyer.phone.replace(/^\+/, "")}` : null, doc.buyer.email].filter(Boolean).join(" · ")}</p>
      </section>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">Détail {isCredit ? "de l'avoir" : "de la facture"}</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-ink-muted">
              <th scope="col" className="py-2 pr-2">Désignation</th>
              <th scope="col" className="px-2 py-2 text-center">Qté</th>
              <th scope="col" className="px-2 py-2 text-right">PU {doc.pricesIncludeTax ? "TTC" : "HT"}</th>
              <th scope="col" className="px-2 py-2 text-right">Total HT</th>
              <th scope="col" className="px-2 py-2 text-right">Taxe</th>
              <th scope="col" className="py-2 pl-2 text-right">Total TTC</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i} className="border-b border-line align-top">
                <td className="py-2.5 pr-2">
                  <span className="font-medium [overflow-wrap:anywhere]">{l.name}</span>
                  {l.variantName && <span className="block text-ink-muted [overflow-wrap:anywhere]">{l.variantName}</span>}
                  {l.discount > 0 && <span className="block text-ink-muted">Remise : -{m(l.discount)}</span>}
                </td>
                <td className="px-2 py-2.5 text-center font-mono tabular">{l.quantity}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular">{m(l.unitPrice)}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular">{m(l.totalExclTax)}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular">
                  {l.taxAmount > 0 ? (
                    <>
                      {m(l.taxAmount)}
                      {l.taxRateBps != null && <span className="block text-xs text-ink-muted">{formatRateBps(l.taxRateBps)}</span>}
                    </>
                  ) : (
                    <span className="text-ink-muted">0</span>
                  )}
                </td>
                <td className="py-2.5 pl-2 text-right font-mono font-medium tabular">{m(l.totalInclTax)}</td>
              </tr>
            ))}
            {shipping && (
              <tr className="border-b border-line align-top">
                <td className="py-2.5 pr-2 font-medium">{shipping.label}</td>
                <td className="px-2 py-2.5 text-center font-mono tabular">1</td>
                <td className="px-2 py-2.5 text-right font-mono tabular">{m(shipping.amount)}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular">{m(shipping.totalExclTax)}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular">{shipping.taxAmount > 0 ? m(shipping.taxAmount) : <span className="text-ink-muted">0</span>}</td>
                <td className="py-2.5 pl-2 text-right font-mono font-medium tabular">{m(shipping.totalInclTax)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto mt-5 w-full max-w-sm space-y-1.5 text-sm">
        {doc.totals.discount > 0 && !isCredit && (
          <div className="flex justify-between gap-4 text-ink-muted">
            <dt>Remises incluses</dt>
            <dd className="font-mono tabular">-{m(doc.totals.discount)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt>Total HT</dt>
          <dd className="font-mono tabular">{m(doc.totals.exclTax)}</dd>
        </div>
        {doc.taxLines.map((t) => (
          <div key={`${t.name}-${t.rateBps}`} className="flex justify-between gap-4">
            <dt>
              {doc.pricesIncludeTax ? "dont " : ""}
              {t.name} {formatRateBps(t.rateBps)} <span className="text-ink-muted">(base {m(t.base)})</span>
            </dt>
            <dd className="font-mono tabular">{m(t.amount)}</dd>
          </div>
        ))}
        {!hasTax && (
          <div className="flex justify-between gap-4 text-ink-muted">
            <dt>Taxes</dt>
            <dd className="font-mono tabular">{m(0)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 border-t border-ink pt-2 text-base font-semibold">
          <dt>{isCredit ? "Montant de l'avoir TTC" : "Total TTC"}</dt>
          <dd className="font-mono tabular">{m(doc.totals.inclTax)}</dd>
        </div>
        {!isCredit && (
          <div className="flex justify-between gap-4 text-ink-muted">
            <dt>Règlement</dt>
            <dd className="text-right">
              {doc.payment.methodLabel ?? "—"}
              {doc.payment.giftCardAmount > 0 && <span className="block">dont carte cadeau {m(doc.payment.giftCardAmount)}</span>}
              {doc.payment.storeCreditAmount > 0 && <span className="block">dont avoir client {m(doc.payment.storeCreditAmount)}</span>}
            </dd>
          </div>
        )}
      </dl>

      <footer className="mt-8 space-y-1 border-t border-line pt-3 text-xs text-ink-muted">
        {doc.mentions.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
        <p>Montants en {cur}. Document émis avec Axi.</p>
      </footer>
    </article>
  );
}

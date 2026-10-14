import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatPhone, formatDateTime } from "@/lib/utils";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/commerce/order-state";
import { FULFILLMENT_LABEL } from "../../fulfillment";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Bon de préparation" };

type ItemOption = { name: string; priceDelta: number };

/** Page d'impression : bon de préparation + reçu (non fiscal). La sidebar et l'en-tête sont masqués à l'impression. */
export default async function PrintOrderPage({ params }: { params: Promise<{ storeId: string; orderId: string }> }) {
  const { storeId, orderId } = await params;
  const ctx = await getStoreContext(storeId, "orders.view");
  const order = await db.order.findFirst({ where: { id: orderId, storeId: ctx.store.id }, include: { items: true } });
  if (!order) notFound();
  const s = ctx.store;

  return (
    <div className="print-root mx-auto max-w-2xl">
      <style>{`
        @media print {
          aside, header, nav, [data-print-hide] { display: none !important; }
          body { background: #fff !important; }
          main { padding: 0 !important; }
          .print-root { max-width: none !important; }
          .print-sheet { border: none !important; box-shadow: none !important; padding: 0 !important; background: #fff !important; color: #000 !important; }
          .print-sheet * { color: inherit !important; border-color: #d4d4d4 !important; }
          @page { margin: 12mm; }
        }
      `}</style>

      <div data-print-hide className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Bon de préparation</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Aperçu avant impression : bon de préparation et reçu client.</p>
        </div>
        <PrintButton backHref={`/app/${s.id}/commandes/${order.id}`} />
      </div>

      <article className="print-sheet rounded-[var(--radius-lg)] bg-surface p-6 text-ink ring-1 ring-line shadow-[var(--shadow-card)] sm:p-10" lang="fr">
        <header className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{s.name}</h2>
            {s.address && <p className="text-sm text-ink-muted">{s.address}</p>}
            {s.whatsappNumber && <p className="text-sm text-ink-muted">WhatsApp : {formatPhone(s.whatsappNumber)}</p>}
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-semibold">{order.reference}</p>
            <p className="text-sm text-ink-muted">{formatDateTime(order.createdAt)}</p>
            <p className="mt-1 inline-block rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium">{ORDER_STATUS_LABELS[order.status]}</p>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium text-ink-muted">Client</h3>
            <p className="mt-1 font-medium">{order.customerName}</p>
            <p>{formatPhone(order.customerPhone)}</p>
            {order.customerEmail && <p>{order.customerEmail}</p>}
          </div>
          <div>
            <h3 className="text-xs font-medium text-ink-muted">{FULFILLMENT_LABEL[order.fulfillmentType]}</h3>
            {order.fulfillmentType === "DELIVERY" ? (
              <>
                {order.deliveryZoneName && <p className="mt-1 font-medium">{order.deliveryZoneName}</p>}
                <p>{order.deliveryAddress}</p>
              </>
            ) : (
              <p className="mt-1">{order.fulfillmentType === "PICKUP" ? "Retrait en boutique" : "À convenir sur WhatsApp"}</p>
            )}
            {order.scheduledFor && <p>Créneau : {formatDateTime(order.scheduledFor)}</p>}
            {order.courierName && <p>Livreur : {order.courierName}</p>}
          </div>
        </section>

        {order.customerNote && (
          <p className="mt-5 rounded-[var(--radius-md)] bg-surface-2 px-3.5 py-2.5 text-sm">
            <span className="font-semibold">Note du client :</span> {order.customerNote}
          </p>
        )}

        <table className="mt-6 w-full text-sm">
          <caption className="sr-only">Articles de la commande</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-ink-muted">
              <th scope="col" className="py-2 pr-2">Article</th>
              <th scope="col" className="py-2 px-2 text-center">Qté</th>
              <th scope="col" className="py-2 px-2 text-right">PU</th>
              <th scope="col" className="py-2 pl-2 text-right">Total</th>
              <th scope="col" className="py-2 pl-3 text-center" aria-label="Préparé">
                <span aria-hidden>Prêt</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it) => {
              const opts = (Array.isArray(it.options) ? (it.options as unknown as ItemOption[]) : []).filter((o) => o && typeof o.name === "string");
              return (
                <tr key={it.id} className="border-b border-line align-top">
                  <td className="py-2.5 pr-2">
                    <span className="font-medium">{it.name}</span>
                    {it.variantName && <span className="block text-ink-muted">{it.variantName}</span>}
                    {opts.length > 0 && <span className="block text-ink-muted">{opts.map((o) => o.name).join(", ")}</span>}
                  </td>
                  <td className="py-2.5 px-2 text-center font-mono tabular">{it.quantity}</td>
                  <td className="py-2.5 px-2 text-right font-mono tabular">{formatMoney(it.unitPrice, order.currency)}</td>
                  <td className="py-2.5 pl-2 text-right font-mono tabular font-medium">{formatMoney(it.lineTotal, order.currency)}</td>
                  <td className="py-2 pl-3 text-center">
                    <span className="inline-block size-4 rounded-[4px] border border-ink" aria-hidden />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Sous-total</dt>
            <dd className="font-mono tabular">{formatMoney(order.subtotal, order.currency)}</dd>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between">
              <dt>Remise{order.couponCode ? ` (${order.couponCode})` : ""}</dt>
              <dd className="font-mono tabular">-{formatMoney(order.discount, order.currency)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>Livraison</dt>
            <dd className="font-mono tabular">{formatMoney(order.deliveryFee, order.currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-ink pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="font-mono tabular">{formatMoney(order.total, order.currency)}</dd>
          </div>
          <div className="flex justify-between text-ink-muted">
            <dt>Paiement</dt>
            <dd>
              {PAYMENT_STATUS_LABELS[order.paymentStatus]}
              {order.paymentMethodLabel ? ` · ${order.paymentMethodLabel}` : ""}
            </dd>
          </div>
        </dl>

        <footer className="mt-8 border-t border-line pt-3 text-xs text-ink-muted">
          <p>Reçu non fiscal : document de préparation et de remise. Merci pour votre commande.</p>
          <p className="mt-1 [overflow-wrap:anywhere]">Suivi : {process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/suivi/{order.trackingToken}</p>
        </footer>
      </article>
    </div>
  );
}

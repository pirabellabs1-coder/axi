import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CreditCard, ExternalLink, MapPin, Undo2 } from "lucide-react";
import { db } from "@/lib/db";
import { getAccountPage } from "@/lib/buyer/account";
import { getBuyerReturnView } from "@/lib/returns/buyer";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/commerce/order-state";
import { storefrontPreset } from "@/lib/storefront/theme";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/utils";
import { AccountCard, AccountShell } from "@/components/storefront/account/account-shell";
import { AccountDisabled } from "@/components/storefront/account/account-disabled";
import { OrderStatusPill } from "@/components/storefront/account/order-status-pill";
import { ReorderButton } from "@/components/storefront/account/reorder-button";
import { OrderSummary } from "@/components/storefront/order-summary";
import { OrderTimeline } from "@/components/storefront/order-timeline";

export const metadata: Metadata = { title: "Détail de la commande", robots: { index: false, follow: false } };

/** Lien de suivi encore valable. */
function isFuture(d: Date): boolean {
  return d.getTime() > Date.now();
}

type Props = { params: Promise<{ slug: string; reference: string }> };

export default async function AccountOrderDetail({ params }: Props) {
  const { slug, reference } = await params;
  if (!/^[A-Za-z0-9-]{3,40}$/.test(reference)) notFound();
  const ctx = await getAccountPage(slug, `/s/${slug}/compte/commandes/${reference}`);
  if (ctx.state === "disabled") return <AccountDisabled slug={ctx.store.slug} />;
  const { store, buyer, readOnly } = ctx;

  // Isolation : boutique ET client de la session (une référence d'un autre client renvoie 404).
  const order = await db.order.findFirst({
    where: { storeId: store.id, customerId: buyer.customerId, reference },
    include: {
      items: { orderBy: { id: "asc" } },
      events: { where: { type: { in: ["status_changed", "payment_changed"] } }, orderBy: { createdAt: "asc" }, select: { type: true, toValue: true, createdAt: true } },
    },
  });
  if (!order) notFound();
  const preset = storefrontPreset(store.sector, store.themeId);
  const trackingValid = isFuture(order.trackingExpiresAt);
  const base = `/s/${store.slug}/compte`;
  // Retours (équipe D) : bouton si une nouvelle demande est possible, lien si des retours existent déjà.
  const returnView = await getBuyerReturnView(store.id, order.id).catch(() => null);
  const canReturn = !!returnView?.canRequest && !readOnly;
  const hasReturns = (returnView?.returns.length ?? 0) > 0;

  return (
    <AccountShell
      slug={store.slug}
      active="orders"
      back={{ href: `${base}/commandes`, label: "Mes commandes" }}
      title={<span className="font-mono">{order.reference}</span>}
      description={`Passée le ${formatDateTime(order.createdAt)} · ${formatMoney(order.total, order.currency)}`}
      readOnlyNotice={readOnly}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-5">
          <AccountCard aria-labelledby="timeline-title">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
              <h2 id="timeline-title" className="text-base font-semibold text-ink">
                Où en est votre commande ?
              </h2>
              <OrderStatusPill status={order.status} label={ORDER_STATUS_LABELS[order.status]} />
            </div>
            <OrderTimeline status={order.status} fulfillmentType={order.fulfillmentType} createdAt={order.createdAt} events={order.events} booking={preset.booking} />
          </AccountCard>

          <AccountCard aria-labelledby="recap-title">
            <h2 id="recap-title" className="text-base font-semibold text-ink">
              Articles
            </h2>
            <div className="mt-3">
              <OrderSummary order={order} />
            </div>
          </AccountCard>
        </div>

        <aside className="space-y-5" aria-label="Actions et informations">
          <AccountCard>
            <h2 className="text-base font-semibold text-ink">Envie de recommencer ?</h2>
            <p className="mb-4 mt-1 text-sm text-ink-muted">Les articles disponibles sont ajoutés au panier, aux prix actuels.</p>
            <ReorderButton slug={store.slug} reference={order.reference} />
          </AccountCard>

          {(canReturn || hasReturns) && (
            <AccountCard>
              <h2 className="text-base font-semibold text-ink">Un article ne convient pas ?</h2>
              <p className="mb-4 mt-1 text-sm text-ink-muted">
                {canReturn && returnView?.deadline ? `Demande de retour possible jusqu'au ${formatDate(returnView.deadline)}.` : "Suivez vos demandes de retour pour cette commande."}
              </p>
              {canReturn && (
                <Link href={`${base}/retours?commande=${encodeURIComponent(order.reference)}`} className="sf-btn sf-btn-outline h-12 w-full text-sm">
                  <Undo2 className="size-4" aria-hidden /> Retourner des articles
                </Link>
              )}
              {hasReturns && (
                <Link href={`${base}/retours`} className="sf-link mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
                  Voir mes retours
                </Link>
              )}
            </AccountCard>
          )}

          <AccountCard>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="flex items-center gap-2 text-[13px] text-ink-muted">
                  <MapPin className="size-4" aria-hidden /> Réception
                </dt>
                <dd className="mt-1 text-ink">
                  {order.fulfillmentType === "DELIVERY"
                    ? `Livraison${order.deliveryZoneName ? `, ${order.deliveryZoneName}` : ""}${order.deliveryAddress ? ` · ${order.deliveryAddress}` : ""}`
                    : order.fulfillmentType === "PICKUP"
                      ? preset.copy.pickupTitle
                      : order.fulfillmentType === "DIGITAL"
                        ? "Envoi numérique"
                        : "Commande via WhatsApp"}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 text-[13px] text-ink-muted">
                  <CreditCard className="size-4" aria-hidden /> Paiement
                </dt>
                <dd className="mt-1 text-ink">
                  {PAYMENT_STATUS_LABELS[order.paymentStatus]}
                  {order.paymentMethodLabel ? ` · ${order.paymentMethodLabel}` : ""}
                </dd>
              </div>
            </dl>
            {trackingValid && (
              <Link href={`/suivi/${order.trackingToken}`} className="sf-link mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline">
                Page de suivi partageable <ExternalLink className="size-4" aria-hidden />
              </Link>
            )}
          </AccountCard>
        </aside>
      </div>
    </AccountShell>
  );
}

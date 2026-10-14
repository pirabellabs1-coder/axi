import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoreChrome } from "@/components/storefront/storefront-view";
import { Check, Clock, ArrowRight, Banknote, Gift, Send } from "lucide-react";
import { db } from "@/lib/db";
import { listOrderGiftCardsForBuyer } from "@/lib/giftcards/service";
import { getStorefront } from "@/lib/storefront/data";
import { getPublicOrderByToken } from "@/lib/storefront/tracking";
import { storefrontPreset } from "@/lib/storefront/theme";
import { PAYMENT_STATUS_LABELS } from "@/lib/commerce/order-state";
import { waLink, buildOrderMessage } from "@/lib/whatsapp";
import { SITE } from "@/config/site";
import { Alert } from "@/components/ui/misc";
import { formatMoney } from "@/lib/money";
import { OrderSummary } from "@/components/storefront/order-summary";
import { OrderTimeline } from "@/components/storefront/order-timeline";
import { ClearCart } from "@/components/storefront/clear-cart";
import { ExperimentOrderAttribution } from "@/components/experiments/order-attribution"; // Lot 4 §13 (équipe EXP)
import { WhatsappOrderButton } from "@/components/storefront/whatsapp-order-button";
import { storePath } from "@/components/storefront/format";
import { presentmentTotalText } from "@/lib/commerce/order-display";

export const metadata: Metadata = { title: "Merci pour votre commande", robots: { index: false } };

type Props = { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ paiement?: string }> };

const card = "rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line sm:p-6";

export default async function ThanksPage({ params, searchParams }: Props) {
  const [{ slug, token }, sp] = await Promise.all([params, searchParams]);
  const store = (await getStorefront(slug))?.store;
  if (!store) notFound();
  const found = await getPublicOrderByToken(token);
  if (!found || found.order.storeId !== store.id || found.expired) notFound();
  const { order, paymentMethod } = found;
  const preset = storefrontPreset(store.sector, store.themeId);
  // Lot 1 : remises détaillées, cartes cadeaux achetées (émises après paiement confirmé), reste à payer.
  const hasGiftItems = order.items.some((i) => i.isGiftCard);
  const [discounts, giftCards, invoiceCount] = await Promise.all([
    db.orderDiscount.findMany({ where: { orderId: order.id, storeId: store.id }, orderBy: { createdAt: "asc" }, select: { label: true, amount: true } }),
    hasGiftItems ? listOrderGiftCardsForBuyer(store.id, order.id).catch(() => []) : Promise.resolve([]),
    // Lot 2 : facture émise (souvent quelques instants après le paiement).
    db.orderInvoice.count({ where: { storeId: store.id, orderId: order.id, kind: "INVOICE" } }),
  ]);
  const presented = presentmentTotalText(order);
  const due = order.amountDue ?? order.total;
  const tendered = order.giftCardAmount + order.storeCreditAmount;

  const trackingUrl = `${SITE.url.replace(/\/$/, "")}/suivi/${order.trackingToken}`;
  const isWhatsapp = order.fulfillmentType === "WHATSAPP";
  const manual = paymentMethod && (paymentMethod.kind === "MOBILE_MONEY_MANUAL" || paymentMethod.kind === "BANK_TRANSFER_MANUAL");
  const cancelled = sp.paiement === "annule";
  const firstName = order.customerName.trim().split(/\s+/)[0];

  const waHref = store.whatsappNumber
    ? waLink(
        store.whatsappNumber,
        buildOrderMessage({
          storeName: store.name,
          reference: order.reference,
          customerName: order.customerName,
          items: order.items.map((i) => ({ name: i.name, variantName: i.variantName, quantity: i.quantity, lineTotal: i.lineTotal })),
          currency: order.currency,
          subtotal: order.subtotal,
          discount: order.discount,
          deliveryFee: order.deliveryFee,
          total: order.total,
          fulfillment: order.fulfillmentType,
          address: order.deliveryAddress,
          trackingUrl,
          note: order.customerNote,
        }),
      )
    : null;

  const modeText =
    order.fulfillmentType === "DELIVERY"
      ? `Livraison${order.deliveryZoneName ? `, ${order.deliveryZoneName}` : ""}`
      : order.fulfillmentType === "PICKUP"
        ? preset.copy.pickupTitle
        : order.fulfillmentType === "DIGITAL"
          ? "Envoi numérique"
          : "Finalisation sur WhatsApp";

  return (
    <StoreChrome slug={store.slug}>
    <div className="sf-container max-w-[760px] pb-16 pt-8 sm:pt-14">
      <ClearCart slug={store.slug} token={order.trackingToken} />
      <ExperimentOrderAttribution store={{ id: store.id, timezone: store.timezone }} orderId={order.id} />

      <header className="sf-rise text-center">
        <span className="inline-flex size-16 items-center justify-center rounded-full bg-[var(--store-primary)] text-[var(--store-primary-contrast)] shadow-[0_16px_40px_-16px_var(--store-primary)]">
          <Check className="size-8" strokeWidth={2.2} aria-hidden />
        </span>
        <h1 className="mx-auto mt-6 max-w-[22ch] text-[clamp(1.8rem,5vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-ink">
          {isWhatsapp ? `Plus qu'une étape, ${firstName}` : `Merci ${firstName}, c'est enregistré`}
        </h1>
        <p className="mt-3 text-[16px] text-ink-muted">
          Commande <span className="font-mono font-semibold text-ink">{order.reference}</span> · {formatMoney(order.total, order.currency)}
          {presented && <span className="tabular"> ({presented})</span>}
        </p>
        {presented && <p className="mt-1 text-xs text-ink-muted">Montant indicatif dans votre devise d&apos;affichage ; la commande est due en {order.currency}.</p>}
        {tendered > 0 && (
          <p className="mt-1 text-sm text-ink-muted">
            {due === 0 ? "Entièrement réglée par carte cadeau ou avoir." : `Dont ${formatMoney(tendered, order.currency)} réglés par carte cadeau ou avoir : reste ${formatMoney(due, order.currency)}.`}
          </p>
        )}
      </header>

      {cancelled && order.paymentStatus !== "PAID" && (
        <Alert tone="warning" className="mt-8" title="Paiement en ligne non finalisé">
          Votre commande est conservée. Prévenez le commerçant sur WhatsApp pour convenir d'un autre moyen de paiement.
        </Alert>
      )}

      {isWhatsapp && waHref && (
        <section className="mt-8 overflow-hidden rounded-[calc(var(--store-card-radius)+6px)] bg-[#0b3d2e] p-6 text-center text-white sm:p-8" aria-labelledby="wa-title">
          <h2 id="wa-title" className="text-xl font-semibold tracking-[-0.02em]">
            Envoyez votre commande sur WhatsApp
          </h2>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm leading-relaxed text-white/80">Le message est prérempli avec votre récapitulatif. Il ne part que lorsque vous appuyez sur « Envoyer » dans WhatsApp.</p>
          <div className="mx-auto mt-5 max-w-sm">
            <WhatsappOrderButton href={waHref} orderId={order.id} trackingToken={order.trackingToken} className="!bg-[#25d366] !text-[#0b1a10]">
              Ouvrir WhatsApp
            </WhatsappOrderButton>
          </div>
        </section>
      )}

      {hasGiftItems && (
        <section className={`${card} mt-6`} aria-labelledby="gift-title">
          <h2 id="gift-title" className="flex items-center gap-2 text-base font-semibold text-ink">
            <Gift className="size-5 text-[var(--store-primary)]" aria-hidden /> {giftCards.length > 1 ? "Vos cartes cadeaux" : "Votre carte cadeau"}
          </h2>
          {giftCards.length === 0 ? (
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {order.paymentStatus === "PAID" ? "Émission en cours : rechargez la page dans quelques instants." : "La carte est émise et envoyée au destinataire dès que le paiement est confirmé par la boutique."}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {giftCards.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block font-mono text-sm text-ink">•••• {g.last4}</span>
                    <span className="block text-xs text-ink-muted">
                      {formatMoney(g.value, g.currency)}
                      {g.recipientName ? ` · pour ${g.recipientName}` : ""}
                      {g.delivered ? " · envoyée" : ""}
                    </span>
                  </span>
                  {g.shareLink && (
                    <a href={g.shareLink} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-[#25d366] px-4 text-sm font-semibold text-[#0b1a10] transition-transform active:scale-[0.98]">
                      <Send className="size-4" aria-hidden /> Envoyer sur WhatsApp
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-muted">Par sécurité, seuls les 4 derniers caractères sont affichés ici. Le code complet est envoyé au destinataire.</p>
        </section>
      )}

      {manual && order.paymentStatus !== "PAID" && (
        <section className={`${card} mt-6`} aria-labelledby="pay-title">
          <h2 id="pay-title" className="flex items-center gap-2 text-base font-semibold text-ink">
            <Clock className="size-5 text-[var(--store-primary)]" aria-hidden /> Réglez par {paymentMethod.label}
          </h2>
          {paymentMethod.instructions && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{paymentMethod.instructions}</p>}
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-[14px] bg-surface-2 px-4 py-3.5 text-sm">
            {paymentMethod.accountNumber && (
              <>
                <dt className="text-ink-muted">Numéro</dt>
                <dd className="font-mono font-semibold text-ink">{paymentMethod.accountNumber}</dd>
              </>
            )}
            {paymentMethod.accountName && (
              <>
                <dt className="text-ink-muted">Nom</dt>
                <dd className="font-semibold text-ink">{paymentMethod.accountName}</dd>
              </>
            )}
            <dt className="text-ink-muted">Montant</dt>
            <dd className="font-semibold tabular text-ink">{formatMoney(due, order.currency)}</dd>
            <dt className="text-ink-muted">Motif</dt>
            <dd className="font-mono text-ink">{order.reference}</dd>
          </dl>
          {order.paymentReference && <p className="mt-3 text-xs text-ink-muted">Référence transmise : {order.paymentReference}</p>}
          <p className="mt-3 text-xs text-ink-muted">Le commerçant vérifie le paiement avant de confirmer.</p>
        </section>
      )}

      {paymentMethod?.kind === "CASH_ON_DELIVERY" && (
        <p className="mt-6 flex items-center gap-3 rounded-[14px] bg-surface px-4 py-3.5 text-sm text-ink ring-1 ring-line">
          <Banknote className="size-5 shrink-0 text-[var(--store-primary)]" aria-hidden />
          Vous réglerez {formatMoney(due, order.currency)} en espèces à la remise.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[1fr_1.15fr]">
        <section className={card} aria-labelledby="status-title">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 id="status-title" className="text-base font-semibold text-ink">
              Suivi
            </h2>
            {!isWhatsapp && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">{PAYMENT_STATUS_LABELS[order.paymentStatus]}</span>}
          </div>
          <OrderTimeline status={order.status} fulfillmentType={order.fulfillmentType} createdAt={order.createdAt} events={order.events} booking={preset.booking} />
        </section>

        <section className={card} aria-labelledby="recap-title">
          <h2 id="recap-title" className="text-base font-semibold text-ink">
            Récapitulatif
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">Mode</dt>
              <dd className="text-ink">{modeText}</dd>
            </div>
            {order.paymentMethodLabel && (
              <div>
                <dt className="text-ink-muted">Paiement</dt>
                <dd className="text-ink">{order.paymentMethodLabel}</dd>
              </div>
            )}
            {order.deliveryAddress && (
              <div className="sm:col-span-2">
                <dt className="text-ink-muted">Adresse ou repère</dt>
                <dd className="text-ink">{order.deliveryAddress}</dd>
              </div>
            )}
          </dl>
          <div className="mt-4 border-t border-line pt-2">
            <OrderSummary order={order} discounts={discounts} />
          </div>
        </section>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link href={`/suivi/${order.trackingToken}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[var(--store-primary)] px-6 text-sm font-semibold text-[var(--store-primary-contrast)] transition-transform active:scale-[0.98]">
          Suivre ma commande <ArrowRight className="size-4" aria-hidden />
        </Link>
        {!isWhatsapp && waHref ? (
          <WhatsappOrderButton href={waHref} orderId={order.id} trackingToken={order.trackingToken} size="md" className="!h-12 !rounded-full">
            Prévenir sur WhatsApp
          </WhatsappOrderButton>
        ) : (
          <Link href={storePath(store.slug)} className="inline-flex h-12 items-center justify-center rounded-full bg-surface px-6 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2">
            Retour à la boutique
          </Link>
        )}
      </div>
      {invoiceCount > 0 && (
        <p className="mt-3 text-center">
          <Link href={`/suivi/${order.trackingToken}/facture`} className="inline-flex min-h-11 items-center text-sm font-semibold text-ink underline underline-offset-4 hover:text-[var(--store-primary)]">
            Voir ma facture
          </Link>
        </p>
      )}
      <p className="mt-4 text-center text-xs text-ink-muted">Conservez le lien de suivi : il fonctionne sans compte pendant 90 jours.</p>
      {!isWhatsapp && waHref && (
        <p className="mt-2 text-center">
          <Link href={storePath(store.slug)} className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink">
            Retour à la boutique
          </Link>
        </p>
      )}
    </div>
    </StoreChrome>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, FileText, MessageCircle, LinkIcon, PackageSearch, Store as StoreIcon, Star, Undo2 } from "lucide-react";
import type { PaymentStatus } from "@prisma/client";
import { getPublicOrderByToken, getReviewedProductIds } from "@/lib/storefront/tracking";
import { trackingReturnLink } from "@/lib/returns/buyer";
import { PAYMENT_STATUS_LABELS } from "@/lib/commerce/order-state";
import { resolveTheme, storefrontPreset, themeCssVars, STORE_LIGHT_TOKENS } from "@/lib/storefront/theme";
import { waLink } from "@/lib/whatsapp";
import { formatDateTime } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { db } from "@/lib/db";
import { presentmentTotalText } from "@/lib/commerce/order-display";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/misc";
import { OrderSummary } from "@/components/storefront/order-summary";
import { OrderTimeline } from "@/components/storefront/order-timeline";
import { ReviewForm } from "@/components/storefront/review-form";
import { StoreStyles } from "@/components/storefront/store-styles";
import { storePath, themeFontFamily } from "@/components/storefront/format";
import { DownloadsSection } from "./downloads-section";
import { listOrderDownloads } from "@/lib/digital/service";
import { downloadsLabel, grantProblemMessage } from "@/lib/digital/rules";

export const metadata: Metadata = { title: "Suivi de commande", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const card = "rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line sm:p-6";

const PAY_TONE: Record<PaymentStatus, string> = {
  UNPAID: "bg-surface-2 text-ink-muted",
  PENDING: "bg-sun-soft text-[#8a5a00]",
  PAID: "bg-[#e8f6ef] text-[#0b5a3f]",
  PARTIALLY_REFUNDED: "bg-warning-soft text-warning",
  REFUNDED: "bg-warning-soft text-warning",
  FAILED: "bg-danger-soft text-danger",
};

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getPublicOrderByToken(token);

  if (!found || found.expired) {
    return (
      <Shell vars={STORE_LIGHT_TOKENS as React.CSSProperties}>
        <div className="flex flex-col items-center rounded-[var(--radius-xl)] bg-surface px-6 py-14 text-center ring-1 ring-line">
          <span className="mb-5 inline-flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink">
            {found ? <LinkIcon className="size-6" aria-hidden /> : <PackageSearch className="size-6" aria-hidden />}
          </span>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">{found ? "Lien de suivi expiré" : "Commande introuvable"}</h1>
          <p className="mt-2 max-w-[42ch] text-sm text-ink-muted">
            {found ? "Ce lien n'est plus valable. Contactez la boutique pour toute question sur votre commande." : "Vérifiez le lien reçu : il doit être copié en entier, sans espace."}
          </p>
          <Link href="/" className="mt-6 inline-flex h-12 items-center rounded-full bg-primary px-6 text-sm font-semibold text-on-primary">
            Aller sur Axi
          </Link>
        </div>
      </Shell>
    );
  }

  const { order, paymentMethod } = found;
  const store = order.store;
  const theme = resolveTheme(store.themeId, store.themeConfig);
  const preset = storefrontPreset(store.sector, store.themeId);
  const fonts = themeFontFamily(theme.font);
  const vars = { ...STORE_LIGHT_TOKENS, ...themeCssVars(theme), "--store-font": fonts.body, "--store-font-heading": fonts.heading } as React.CSSProperties;
  const storeVisible = store.status === "PUBLISHED" || store.status === "CLOSED_TEMPORARILY";
  const waHref = storeVisible && store.whatsappNumber ? waLink(store.whatsappNumber, `Bonjour ${store.name}, j'ai une question sur ma commande ${order.reference}.`) : null;

  // Avis : uniquement sur une commande livrée, un avis par produit (encore en catalogue).
  const delivered = order.status === "DELIVERED";
  const reviewed = delivered ? await getReviewedProductIds(order.id) : new Set<string>();
  // Retours (lot 1) : lien si le libre-service est ouvert pour cette commande ou si une demande existe.
  // Lot 2 : lien « Ma facture » dès qu'une facture est émise ; montant indicatif en devise d'affichage.
  const [returnsLink, invoiceCount] = await Promise.all([trackingReturnLink(store.id, order.id), db.orderInvoice.count({ where: { storeId: store.id, orderId: order.id, kind: "INVOICE" } })]);
  // Vague 2 : fichiers numériques de la commande (accès émis après paiement confirmé).
  const now = new Date();
  const downloads = order.items.some((i) => i.kind === "DIGITAL")
    ? (await listOrderDownloads(store.id, order.id, now)).map((d) => ({
        grantId: d.grantId,
        itemName: d.itemName,
        files: d.files,
        label: downloadsLabel({ downloadCount: d.downloadCount, downloadLimit: d.downloadLimit, expiresAt: d.expiresAt }, now),
        usable: d.state.usable,
        problem: grantProblemMessage(d.state),
      }))
    : [];
  const presented = presentmentTotalText(order);
  const reviewable = delivered
    ? order.items.filter((i, idx, arr) => i.productId && arr.findIndex((x) => x.productId === i.productId) === idx).map((i) => ({ productId: i.productId!, name: i.name, done: reviewed.has(i.productId!) }))
    : [];

  return (
    <Shell vars={vars} store={{ name: store.name, logoUrl: store.logoUrl, slug: storeVisible ? store.slug : "" }}>
      <header className="sf-rise">
        <p className="text-sm text-ink-muted">Commande passée le {formatDateTime(order.createdAt)}</p>
        <h1 className="mt-1 font-mono text-[clamp(1.6rem,5vw,2.2rem)] font-semibold tracking-[-0.02em] text-ink">{order.reference}</h1>
        <p className="mt-1 text-[15px] text-ink-muted">
          {order.items.reduce((s, i) => s + i.quantity, 0)} article{order.items.reduce((s, i) => s + i.quantity, 0) > 1 ? "s" : ""} · <span className="font-medium text-ink">{formatMoney(order.total, order.currency)}</span>
          {presented && <span className="tabular"> ({presented}, indicatif)</span>}
        </p>
      </header>

      <section className={`${card} mt-6`} aria-labelledby="timeline-title">
        <h2 id="timeline-title" className="mb-5 text-base font-semibold text-ink">
          Où en est votre commande ?
        </h2>
        <OrderTimeline status={order.status} fulfillmentType={order.fulfillmentType} createdAt={order.createdAt} events={order.events} booking={preset.booking} />
      </section>

      <section className={`${card} mt-4`} aria-labelledby="pay-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="pay-title" className="flex items-center gap-2 text-base font-semibold text-ink">
            <CreditCard className="size-5 text-[var(--store-primary)]" aria-hidden /> Paiement
          </h2>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${PAY_TONE[order.paymentStatus]}`}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</span>
        </div>
        <p className="mt-2 text-sm text-ink-muted">{order.paymentMethodLabel ?? "À convenir avec le commerçant"}</p>
        {paymentMethod && (paymentMethod.kind === "MOBILE_MONEY_MANUAL" || paymentMethod.kind === "BANK_TRANSFER_MANUAL") && order.paymentStatus !== "PAID" && paymentMethod.accountNumber && (
          <p className="mt-3 rounded-[12px] bg-surface-2 px-4 py-3 text-sm text-ink">
            Envoyez {formatMoney(order.amountDue ?? order.total, order.currency)} au <span className="font-mono font-semibold">{paymentMethod.accountNumber}</span>
            {paymentMethod.accountName ? ` (${paymentMethod.accountName})` : ""}, motif <span className="font-mono">{order.reference}</span>.
          </p>
        )}
      </section>

      {reviewable.length > 0 && (
        <section className={`${card} mt-4`} aria-labelledby="review-title">
          <h2 id="review-title" className="flex items-center gap-2 text-base font-semibold text-ink">
            <Star className="size-5 text-[#E8A317]" fill="currentColor" strokeWidth={0} aria-hidden /> Laisser un avis
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Votre retour aide {store.name} et les prochains clients. Cela prend 30 secondes.</p>
          <div className="mt-5 divide-y divide-line">
            {reviewable.map((r) => (
              <div key={r.productId} className="py-5 first:pt-0 last:pb-0">
                {r.done ? (
                  <p className="text-sm text-ink-muted">
                    <span className="font-medium text-ink">{r.name}</span> : merci, votre avis a bien été reçu.
                  </p>
                ) : (
                  <ReviewForm token={order.trackingToken} productId={r.productId} productName={r.name} />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <DownloadsSection trackingToken={order.trackingToken} rows={downloads} />

      <section className={`${card} mt-4`} aria-labelledby="recap-title">
        <h2 id="recap-title" className="text-base font-semibold text-ink">
          Détail
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {order.fulfillmentType === "DELIVERY"
            ? `Livraison${order.deliveryZoneName ? `, ${order.deliveryZoneName}` : ""}${order.deliveryAddress ? ` · ${order.deliveryAddress}` : ""}`
            : order.fulfillmentType === "PICKUP"
              ? preset.copy.pickupTitle
              : "Commande via WhatsApp"}
        </p>
        <div className="mt-3">
          <OrderSummary order={order} />
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {returnsLink.show && (
          <Link href={`/suivi/${order.trackingToken}/retour`} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-surface px-6 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2 sm:col-span-2">
            <Undo2 className="size-4" aria-hidden /> {returnsLink.hasReturns ? "Suivre mes retours" : "Retourner des articles"}
          </Link>
        )}
        {invoiceCount > 0 && (
          <Link href={`/suivi/${order.trackingToken}/facture`} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-surface px-6 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2 sm:col-span-2">
            <FileText className="size-4" aria-hidden /> Ma facture
          </Link>
        )}
        {waHref && (
          <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-whatsapp-deep px-6 text-sm font-semibold text-white transition-transform active:scale-[0.98]">
            <MessageCircle className="size-5" aria-hidden /> Écrire à {store.name}
          </a>
        )}
        {storeVisible && (
          <Link href={storePath(store.slug)} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-surface px-6 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2">
            <StoreIcon className="size-4" aria-hidden /> Voir la boutique
          </Link>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children, store, vars }: { children: React.ReactNode; store?: { name: string; logoUrl: string | null; slug: string }; vars: React.CSSProperties }) {
  return (
    <div data-store="suivi" data-theme="light" style={vars} className="flex min-h-dvh flex-col bg-canvas text-ink">
      <StoreStyles />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-surface/85 backdrop-blur-xl">
        <div className="container-x flex h-16 max-w-[720px] items-center justify-between gap-4">
          {store ? (
            store.slug ? (
              <Link href={storePath(store.slug)} className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold text-ink">
                <Avatar name={store.name} src={store.logoUrl} size={34} className="rounded-[10px] bg-[var(--store-primary-soft)] text-[var(--store-primary)]" />
                <span className="truncate">{store.name}</span>
              </Link>
            ) : (
              <span className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold text-ink">
                <Avatar name={store.name} src={store.logoUrl} size={34} className="rounded-[10px]" />
                <span className="truncate">{store.name}</span>
              </span>
            )
          ) : (
            <Logo size={26} />
          )}
          <span className="shrink-0 text-xs text-ink-muted">Suivi de commande</span>
        </div>
      </header>
      <main className="container-x w-full max-w-[720px] flex-1 pb-12 pt-8">{children}</main>
      <footer className="container-x flex max-w-[720px] flex-wrap items-center justify-between gap-3 border-t border-line py-5 text-xs text-ink-muted">
        <span>Suivi sécurisé par lien, sans compte. Ne partagez pas ce lien.</span>
        <Link href="/" className="inline-flex min-h-10 items-center gap-1.5 hover:text-ink">
          Propulsé par Axi
        </Link>
      </footer>
    </div>
  );
}

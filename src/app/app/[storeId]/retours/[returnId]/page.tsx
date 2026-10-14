import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightLeft, Camera, Package, StickyNote } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { quoteReturn } from "@/lib/returns/service";
import { RETURN_STATUS_LABELS, RETURN_STATUS_TONE } from "@/lib/returns/state";
import { ITEM_CONDITIONS, parseReturnPolicy, RESOLUTION_LABELS, RETURN_REASONS, type ItemCondition, type ResolutionKind, type ReturnReason } from "@/lib/returns/policy";
import { storeCreditWithBonus } from "@/lib/returns/amounts";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/commerce/order-state";
import { isDisplayableImageUrl } from "@/lib/storage/public-url";
import { thumbUrl } from "@/lib/image-loader";
import { PageHeader, Money, KeyValue } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { formatDateTime, relativeTime, formatPhone } from "@/lib/utils";
import { ReturnActions, type PanelItem } from "./return-panels";

export const metadata: Metadata = { title: "Retour" };

export default async function ReturnDetailPage({ params }: { params: Promise<{ storeId: string; returnId: string }> }) {
  const { storeId, returnId } = await params;
  const ctx = await getStoreContext(storeId, "orders.view");
  const store = ctx.store;
  const ret = await db.returnRequest.findFirst({
    where: { id: returnId, storeId: store.id },
    include: {
      items: { include: { orderItem: { select: { id: true, name: true, variantName: true, unitPrice: true, quantity: true, lineTotal: true, discountAllocated: true, productId: true, variantId: true } } } },
      events: { orderBy: { createdAt: "desc" } },
      order: { select: { id: true, reference: true, status: true, paymentStatus: true, customerName: true, customerPhone: true, currency: true, deliveredAt: true, deliveryFee: true, total: true } },
      customer: { select: { id: true, name: true, storeCreditBalance: true } },
    },
  });
  if (!ret) notFound();

  const base = `/app/${store.id}`;
  const currency = ret.order.currency;
  const policy = parseReturnPolicy(store.returnPolicy);
  const quote = await quoteReturn(db, store.id, ret.id, { refundShipping: false, restockingFeePercent: policy.restockingFeePercent });
  const exchangeOrder = ret.exchangeOrderId ? await db.order.findFirst({ where: { id: ret.exchangeOrderId, storeId: store.id }, select: { id: true, reference: true } }) : null;

  const productIds = [...new Set(ret.items.map((i) => i.orderItem.productId).filter((x): x is string => !!x))];
  const products = productIds.length
    ? await db.product.findMany({ where: { id: { in: productIds }, storeId: store.id }, select: { id: true, images: true, variants: { where: { available: true }, orderBy: { position: "asc" }, select: { id: true, name: true } } } })
    : [];
  const productOf = new Map(products.map((p) => [p.id, p]));
  const variantNames = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, v.name] as const)));

  const panelItems: PanelItem[] = ret.items.map((i) => ({
    id: i.id,
    name: i.orderItem.name,
    variantName: i.orderItem.variantName,
    quantity: i.quantity,
    exchangeVariantId: i.exchangeVariantId,
    variants: (i.orderItem.productId ? productOf.get(i.orderItem.productId)?.variants ?? [] : []).filter((v) => v.id !== i.orderItem.variantId),
  }));
  const photos = (Array.isArray(ret.photos) ? (ret.photos as { url?: unknown }[]) : []).map((p) => (typeof p?.url === "string" ? p.url : null)).filter((u): u is string => isDisplayableImageUrl(u));
  const resolution = ret.resolution as ResolutionKind;

  return (
    <div>
      <PageHeader
        back={{ href: `${base}/retours`, label: "Retours" }}
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono tracking-[-0.02em]">{ret.reference}</span>
            <Badge tone={RETURN_STATUS_TONE[ret.status]} dot>
              {RETURN_STATUS_LABELS[ret.status]}
            </Badge>
          </span>
        }
        description={
          <>
            {ret.requestedBy === "customer" ? "Demandé en ligne" : "Créé par la boutique"} le {formatDateTime(ret.createdAt)} ({relativeTime(ret.createdAt)}) · commande{" "}
            <Link href={`${base}/commandes/${ret.order.id}`} className="font-mono font-medium text-ink hover:text-primary hover:underline">
              {ret.order.reference}
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Articles retournés" description={`Motif : ${RETURN_REASONS[ret.reason as ReturnReason] ?? ret.reason}`} />
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {ret.items.map((i) => {
                const img = firstImage(i.orderItem.productId ? productOf.get(i.orderItem.productId)?.images : null);
                return (
                  <li key={i.id} className="flex items-start gap-3.5 px-5 py-3.5 sm:px-6">
                    <span className="relative size-12 shrink-0 overflow-hidden rounded-[12px] bg-surface-2 ring-1 ring-inset ring-line">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbUrl(img)} alt="" loading="lazy" className="size-full object-cover" />
                      ) : (
                        <Package className="absolute inset-0 m-auto size-5 text-ink-faint" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium text-ink">{i.orderItem.name}</p>
                      {i.orderItem.variantName && <p className="text-ink-muted">{i.orderItem.variantName}</p>}
                      <p className="mt-1 text-xs text-ink-muted tabular">
                        {i.quantity} sur {i.orderItem.quantity} commandé{i.orderItem.quantity > 1 ? "s" : ""}
                        {i.condition ? ` · état : ${ITEM_CONDITIONS[i.condition as ItemCondition] ?? i.condition}` : ""}
                        {ret.receivedAt ? ` · ${i.restockedQty > 0 ? `${i.restockedQty} remis en stock` : "non remis en stock"}` : ""}
                      </p>
                      {i.exchangeVariantId && (
                        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink">
                          <ArrowRightLeft className="size-3.5 text-ink-faint" aria-hidden /> Échange souhaité : {variantNames.get(i.exchangeVariantId) ?? "variante indisponible"}
                        </p>
                      )}
                    </div>
                    <Money amount={i.orderItem.unitPrice} currency={currency} className="shrink-0 font-mono text-[13px] text-ink-muted" />
                  </li>
                );
              })}
            </ul>
          </Card>

          {(ret.customerNote || photos.length > 0) && (
            <Card>
              <CardHeader title="Message du client" />
              <CardBody className="space-y-4 pt-3 text-sm">
                {ret.customerNote && <p className="whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{ret.customerNote}</p>}
                {photos.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                      <Camera className="size-3.5" aria-hidden /> Photos
                    </p>
                    <ul className="flex flex-wrap gap-2">
                      {photos.map((u, idx) => (
                        <li key={u}>
                          <a href={u} target="_blank" rel="noopener noreferrer" className="block size-24 overflow-hidden rounded-[12px] ring-1 ring-line">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={thumbUrl(u)} alt={`Photo ${idx + 1} du client`} className="size-full object-cover" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Journal" description={`${ret.events.length} événement${ret.events.length > 1 ? "s" : ""}`} />
            <CardBody className="pt-3">
              <ol className="space-y-3">
                {ret.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium text-ink">{e.toStatus ? RETURN_STATUS_LABELS[e.toStatus] : "Note"}</span>
                      <time dateTime={e.createdAt.toISOString()} className="text-xs text-ink-faint" title={formatDateTime(e.createdAt)}>
                        {relativeTime(e.createdAt)}
                      </time>
                    </p>
                    <p className="text-[13px] text-ink-muted [overflow-wrap:anywhere]">
                      <span className="text-ink">{e.actorLabel}</span>
                      {e.message ? `, ${e.message}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={ret.status === "RESOLVED" ? "Résolution" : "Actions"} />
            <CardBody className="pt-3">
              {ret.status === "RESOLVED" ? (
                <KeyValue
                  items={[
                    { label: "Résolution", value: RESOLUTION_LABELS[resolution] },
                    ...(ret.refundAmount > 0 ? [{ label: "Valeur retenue", value: <Money amount={ret.refundAmount} currency={currency} className="font-mono" /> }] : []),
                    ...(ret.storeCreditAmount > 0 ? [{ label: "Avoir accordé", value: <Money amount={ret.storeCreditAmount} currency={currency} className="font-mono" /> }] : []),
                    ...(ret.restockingFee > 0 ? [{ label: "Frais de remise en stock", value: <Money amount={ret.restockingFee} currency={currency} className="font-mono" /> }] : []),
                    ...(exchangeOrder
                      ? [{ label: "Commande d'échange", value: <Link href={`${base}/commandes/${exchangeOrder.id}`} className="font-mono font-medium text-primary hover:underline">{exchangeOrder.reference}</Link> }]
                      : []),
                    ...(ret.resolvedAt ? [{ label: "Le", value: formatDateTime(ret.resolvedAt) }] : []),
                  ]}
                />
              ) : (
                <ReturnActions
                  storeId={store.id}
                  returnId={ret.id}
                  status={ret.status}
                  canManage={ctx.can("returns.manage")}
                  canReceive={ctx.can("returns.receive")}
                  canRefund={ctx.can("payments.confirm")}
                  items={panelItems}
                  currency={currency}
                  desired={resolution}
                  policy={policy}
                  deliveryFee={ret.order.deliveryFee}
                  initialQuote={{ merchandise: quote.merchandise, restockingFee: quote.restockingFee, shipping: quote.shipping, cap: quote.cap, amount: quote.amount, capped: quote.capped, fullReturn: quote.fullReturn, paid: quote.paid, storeCredit: storeCreditWithBonus(quote.amount, policy.storeCreditBonusPercent) }}
                />
              )}
              {ret.status === "REJECTED" && ret.rejectionReason && <p className="mt-3 text-sm text-ink-muted [overflow-wrap:anywhere]">Motif : {ret.rejectionReason}</p>}
            </CardBody>
          </Card>

          {ret.status !== "RESOLVED" && ret.status !== "REJECTED" && ret.status !== "CANCELLED" && (
            <Card>
              <CardHeader title="Calcul suggéré" description="Avant options de livraison et de frais." />
              <CardBody className="pt-3 text-sm">
                <KeyValue
                  items={[
                    { label: "Valeur des articles", value: <Money amount={quote.merchandise} currency={currency} className="font-mono" /> },
                    ...(quote.restockingFee > 0 ? [{ label: `Frais (${policy.restockingFeePercent} %)`, value: <Money amount={-quote.restockingFee} currency={currency} className="font-mono" /> }] : []),
                    { label: "Remboursable", value: <Money amount={quote.amount} currency={currency} className="font-mono font-semibold" /> },
                    ...(policy.storeCreditBonusPercent > 0 ? [{ label: `En avoir (+${policy.storeCreditBonusPercent} %)`, value: <Money amount={storeCreditWithBonus(quote.amount, policy.storeCreditBonusPercent)} currency={currency} className="font-mono" /> }] : []),
                    ...(quote.alreadyRefunded > 0 ? [{ label: "Déjà rendu sur la commande", value: <Money amount={quote.alreadyRefunded} currency={currency} className="font-mono" /> }] : []),
                  ]}
                />
                {resolution !== "NONE" && <p className="mt-3 text-ink-muted">Souhait du client : {RESOLUTION_LABELS[resolution].toLowerCase()}.</p>}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Commande" />
            <CardBody className="space-y-3 pt-3 text-sm">
              <KeyValue
                items={[
                  { label: "Client", value: ret.customer ? <Link href={`${base}/clients/${ret.customer.id}`} className="hover:text-primary hover:underline">{ret.order.customerName}</Link> : ret.order.customerName },
                  { label: "Téléphone", value: <span className="tabular">{formatPhone(ret.order.customerPhone)}</span> },
                  { label: "Statut", value: ORDER_STATUS_LABELS[ret.order.status] },
                  { label: "Paiement", value: PAYMENT_STATUS_LABELS[ret.order.paymentStatus] },
                  { label: "Total", value: <Money amount={ret.order.total} currency={currency} className="font-mono" /> },
                  ...(ret.order.deliveredAt ? [{ label: "Livrée le", value: formatDateTime(ret.order.deliveredAt) }] : []),
                ]}
              />
              {ret.merchantNote && (
                <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2 text-ink">
                  <StickyNote className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden /> <span className="[overflow-wrap:anywhere]">{ret.merchantNote}</span>
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const img = (images as { url?: unknown }[]).find((i) => i && typeof i.url === "string" && i.url.length > 0);
  return img ? (img.url as string) : null;
}

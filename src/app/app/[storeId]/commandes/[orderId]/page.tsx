import type { Metadata } from "next";
import { refundableRemaining } from "@/lib/commerce/refunds";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Phone,
  Mail,
  MessageCircle,
  Printer,
  MapPin,
  Clock,
  ExternalLink,
  Package,
  ArrowRightLeft,
  Wallet,
  StickyNote,
  Bell,
  Circle,
  CreditCard,
  Undo2,
  FileText,
  Truck,
} from "lucide-react";
import type { OrderStatus } from "@prisma/client";
import { getStoreContext, planFeature } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatPhone, formatDateTime, formatDate, relativeTime, cn } from "@/lib/utils";
import { waLink } from "@/lib/whatsapp";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONE } from "@/lib/commerce/order-state";
import { PageHeader, Money, Alert, Avatar, KeyValue } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { StepProgress } from "@/components/ui/progress";
import { PlanGate } from "@/components/app/plan-gate";
import { FULFILLMENT_ICON, FULFILLMENT_LABEL, CHANNEL_LABEL } from "../fulfillment";
import { StatusActions, StatusMenu, PaymentActions, RefundAction, InternalNoteForm, CourierForm } from "./order-panels";
import { DownloadsCard } from "./downloads-card";
import { listOrderDownloads } from "@/lib/digital/service";
import { summarizeCartKinds } from "@/lib/digital/kinds";
import { thumbUrl } from "@/lib/image-loader";

export const metadata: Metadata = { title: "Commande" };

const ATTEMPT_LABELS: Record<string, string> = { CREATED: "Créée", PENDING: "En attente", INITIATED: "Initiée", CONFIRMED: "Confirmée", FAILED: "Échouée", EXPIRED: "Expirée" };
const REFUND_LABELS: Record<string, string> = { REQUESTED: "Demandé", PROCESSING: "En cours", DONE: "Effectué", REJECTED: "Refusé" };
const EVENT_META: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  status_changed: { label: "Statut", icon: ArrowRightLeft, tone: "bg-primary-soft text-primary" },
  payment_changed: { label: "Paiement", icon: Wallet, tone: "bg-info-soft text-info" },
  note: { label: "Note", icon: StickyNote, tone: "bg-surface-2 text-ink-muted" },
  notification: { label: "Notification", icon: Bell, tone: "bg-sun-soft text-ink" },
  whatsapp_click: { label: "WhatsApp", icon: MessageCircle, tone: "bg-primary-soft text-primary" },
};

type ItemOption = { name: string; priceDelta: number };
type ProductImage = { url?: unknown; alt?: unknown };

/** Les messages d'événements générés côté serveur peuvent contenir des tirets longs : on les neutralise à l'affichage. */
const clean = (s: string) => s.replace(/\s*[–—]\s*/g, ", ");

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const img = (images as ProductImage[]).find((i) => i && typeof i.url === "string" && i.url.length > 0);
  return img ? (img.url as string) : null;
}

export default async function OrderDetailPage({ params }: { params: Promise<{ storeId: string; orderId: string }> }) {
  const { storeId, orderId } = await params;
  const ctx = await getStoreContext(storeId, "orders.view");
  const order = await db.order.findFirst({
    where: { id: orderId, storeId: ctx.store.id },
    include: {
      items: { include: { product: { select: { images: true } } } },
      events: { orderBy: { createdAt: "desc" } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, include: { paymentMethod: { select: { label: true, kind: true } } } },
      refunds: { orderBy: { createdAt: "desc" } },
      customer: { select: { id: true, ordersCount: true } },
    },
  });
  if (!order) notFound();

  const base = `/app/${ctx.store.id}`;
  const FulfillIcon = FULFILLMENT_ICON[order.fulfillmentType];
  const canManage = ctx.can("orders.manage");
  const canPay = ctx.can("payments.confirm");
  const canAssign = ctx.can("orders.assign");
  const refundsEnabled = planFeature(ctx.planId, "refunds");
  const refunded = order.refunds.filter((r) => r.status !== "REJECTED").reduce((s, r) => s + r.amount, 0);
  // Remboursable : helper unique (remboursements, recrédits d'annulation, retours en avoir/échange, cartes achetées dépensées).
  const refundable = await refundableRemaining(db, { id: order.id, storeId: order.storeId, total: order.total });
  const itemCount = order.items.reduce((s, i) => s + i.quantity, 0);
  const waText = `Bonjour ${order.customerName}, concernant votre commande ${order.reference} chez ${ctx.store.name} :`;

  // Vague 2 : commande sans article à expédier (numérique, service, carte cadeau) — cycle de vie raccourci.
  const intangible = summarizeCartKinds(order.items).digitalOnly;
  const downloads = order.items.some((i) => i.kind === "DIGITAL") ? await listOrderDownloads(ctx.store.id, order.id) : [];

  // Progression du cycle de vie (hors annulation / remboursement).
  const lifecycle: OrderStatus[] = intangible
    ? ["NEW", "DELIVERED"]
    : ["NEW", "CONFIRMED", "PREPARING", "READY", ...(order.fulfillmentType === "DELIVERY" ? (["OUT_FOR_DELIVERY"] as OrderStatus[]) : []), "DELIVERED"];
  const stepIndex = lifecycle.indexOf(order.status);
  const closed = order.status === "CANCELLED" || order.status === "REFUNDED";

  return (
    <div>
      <PageHeader
        back={{ href: `${base}/commandes`, label: "Commandes" }}
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono tracking-[-0.02em]">{order.reference}</span>
            <span className="inline-flex flex-wrap items-center gap-1.5 text-sm font-normal tracking-normal">
              <Badge tone={ORDER_STATUS_TONE[order.status]} dot>
                {ORDER_STATUS_LABELS[order.status]}
              </Badge>
              <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</Badge>
              {order.outOfQuota && <Badge tone="danger">Hors quota</Badge>}
            </span>
          </span>
        }
        description={
          <>
            <time dateTime={order.createdAt.toISOString()}>Reçue le {formatDateTime(order.createdAt)}</time> ({relativeTime(order.createdAt)}) <span aria-hidden>·</span> {CHANNEL_LABEL[order.channel]}
            {order.confirmedAt && (
              <>
                {" "}
                <span aria-hidden>·</span> confirmée le {formatDateTime(order.confirmedAt)}
              </>
            )}
          </>
        }
        actions={
          <>
            <ButtonLink href={waLink(order.customerPhone, waText)} target="_blank" rel="noopener noreferrer" variant="whatsapp" size="sm" className="h-11 sm:h-9">
              <MessageCircle className="size-4" aria-hidden /> WhatsApp
            </ButtonLink>
            <ButtonLink href={`${base}/commandes/${order.id}/imprimer`} variant="outline" size="sm" className="h-11 sm:h-9" target="_blank" rel="noopener">
              <Printer className="size-4" aria-hidden /> Imprimer
            </ButtonLink>
            {(order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED" || order.paymentStatus === "REFUNDED") && (
              <ButtonLink href={`${base}/commandes/${order.id}/facture`} variant="outline" size="sm" className="h-11 sm:h-9">
                <FileText className="size-4" aria-hidden /> Facture
              </ButtonLink>
            )}
            {order.status === "DELIVERED" && ctx.can("returns.manage") && (
              <ButtonLink href={`${base}/retours/nouveau?commande=${order.id}`} variant="outline" size="sm" className="h-11 sm:h-9">
                <Undo2 className="size-4" aria-hidden /> Créer un retour
              </ButtonLink>
            )}
            {/* Lot 3 (OPS) : expéditions, étiquette interne et suivi transporteur. */}
            {canManage && !intangible && (
              <ButtonLink href={`${base}/commandes/${order.id}/expeditions`} variant="outline" size="sm" className="h-11 sm:h-9">
                <Truck className="size-4" aria-hidden /> Expéditions
              </ButtonLink>
            )}
            {canManage && <StatusMenu storeId={ctx.store.id} orderId={order.id} status={order.status} fulfillmentType={order.fulfillmentType} intangible={intangible} />}
          </>
        }
      />

      {order.outOfQuota && (
        <Alert tone="danger" className="mb-6">
          Cette commande dépasse le quota mensuel de votre plan. Elle reste visible 7 jours.{" "}
          <Link href={`${base}/abonnement#plans`} className="font-semibold underline underline-offset-4">
            Voir les plans
          </Link>
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ───────── Colonne principale ───────── */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Articles" description={`${itemCount} article${itemCount > 1 ? "s" : ""}`} />
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {order.items.map((it) => {
                const opts = (Array.isArray(it.options) ? (it.options as unknown as ItemOption[]) : []).filter((o) => o && typeof o.name === "string");
                const img = firstImage(it.product?.images);
                return (
                  <li key={it.id} className="flex items-start gap-3.5 px-5 py-3.5 sm:px-6">
                    <span className="relative size-12 shrink-0 overflow-hidden rounded-[12px] bg-surface-2 ring-1 ring-inset ring-line">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbUrl(img)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                      ) : (
                        <Package className="absolute inset-0 m-auto size-5 text-ink-faint" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">
                        {it.productId ? (
                          <Link href={`${base}/produits/${it.productId}`} className="rounded-sm hover:text-primary hover:underline hover:underline-offset-4">
                            {it.name}
                          </Link>
                        ) : (
                          it.name
                        )}
                      </p>
                      {it.variantName && <p className="text-sm text-ink-muted">{it.variantName}</p>}
                      {opts.length > 0 && (
                        <ul className="mt-1 flex flex-wrap gap-1" aria-label="Options">
                          {opts.map((o, i) => (
                            <li key={i} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">
                              {o.name}
                              {o.priceDelta ? (
                                <span className="tabular">
                                  {" "}
                                  +<Money amount={o.priceDelta} currency={order.currency} />
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-xs text-ink-muted tabular">
                        {it.quantity} <span aria-label="fois">×</span> <Money amount={it.unitPrice} currency={order.currency} />
                      </p>
                    </div>
                    <Money amount={it.lineTotal} currency={order.currency} className="shrink-0 font-mono text-[13px] font-semibold text-ink" />
                  </li>
                );
              })}
            </ul>
            <div className="rounded-b-[var(--radius-lg)] border-t border-line bg-surface-2/40 px-5 py-4 text-sm sm:px-6">
              <dl className="ml-auto max-w-sm space-y-1.5">
                <SummaryRow label="Sous-total" value={<Money amount={order.subtotal} currency={order.currency} />} />
                {order.discount > 0 && (
                  <SummaryRow
                    label={
                      <>
                        Remise
                        {order.couponCode && <span className="ml-1.5 rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs text-ink ring-1 ring-line">{order.couponCode}</span>}
                      </>
                    }
                    value={
                      <span className="text-primary">
                        -<Money amount={order.discount} currency={order.currency} />
                      </span>
                    }
                  />
                )}
                <SummaryRow label="Livraison" value={order.deliveryFee > 0 ? <Money amount={order.deliveryFee} currency={order.currency} /> : <span className="text-ink-muted">Offerte ou sans objet</span>} />
                <div className="flex items-baseline justify-between border-t border-line pt-2.5 text-base font-semibold text-ink">
                  <dt>Total</dt>
                  <dd className="font-mono">
                    <Money amount={order.total} currency={order.currency} />
                  </dd>
                </div>
                {refunded > 0 && (
                  <SummaryRow
                    label="Remboursé"
                    value={
                      <span className="text-warning">
                        -<Money amount={refunded} currency={order.currency} />
                      </span>
                    }
                  />
                )}
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Paiement"
              description={order.paymentMethodLabel ?? "Moyen de paiement non précisé"}
              action={<Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</Badge>}
            />
            <CardBody className="space-y-5 pt-3 text-sm">
              <KeyValue
                items={[
                  { label: "Montant de la commande", value: <Money amount={order.total} currency={order.currency} className="font-mono font-semibold" /> },
                  ...(order.paymentReference ? [{ label: "Référence du client", value: <span className="font-mono font-semibold">{order.paymentReference}</span> }] : []),
                  ...(refunded > 0 ? [{ label: "Net encaissé", value: <Money amount={order.total - refunded} currency={order.currency} className="font-mono" /> }] : []),
                ]}
              />
              {order.paymentAttempts.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-medium text-ink-muted">Tentatives de paiement</h4>
                  <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-md)] ring-1 ring-line">
                    {order.paymentAttempts.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <CreditCard className="size-4 shrink-0 text-ink-faint" aria-hidden />
                          <span className="min-w-0">
                            <span className="block font-medium text-ink">{a.paymentMethod?.label ?? a.provider}</span>
                            <span className="block text-xs text-ink-muted [overflow-wrap:anywhere]">
                              {formatDateTime(a.createdAt)}
                              {a.customerRef ? `, réf. ${a.customerRef}` : ""}
                              {a.providerRef ? `, ${a.providerRef}` : ""}
                              {a.failureReason ? `, ${clean(a.failureReason)}` : ""}
                            </span>
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <Money amount={a.amount} currency={a.currency} className="font-mono text-xs" />
                          <Badge tone={a.status === "CONFIRMED" ? "success" : a.status === "FAILED" || a.status === "EXPIRED" ? "danger" : "sun"}>{ATTEMPT_LABELS[a.status] ?? a.status}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {canPay && <PaymentActions storeId={ctx.store.id} orderId={order.id} paymentStatus={order.paymentStatus} total={order.total} currency={order.currency} />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Historique" description={`${order.events.length} événement${order.events.length > 1 ? "s" : ""}`} />
            <CardBody className="pt-4">
              {order.events.length === 0 ? (
                <p className="text-sm text-ink-muted">Aucun événement enregistré.</p>
              ) : (
                <ol className="relative">
                  {order.events.map((e, i) => {
                    const meta = EVENT_META[e.type] ?? { label: e.type, icon: Circle, tone: "bg-surface-2 text-ink-muted" };
                    const Icon = meta.icon;
                    const last = i === order.events.length - 1;
                    const target =
                      e.toValue && e.type === "status_changed"
                        ? (ORDER_STATUS_LABELS[e.toValue as keyof typeof ORDER_STATUS_LABELS] ?? e.toValue)
                        : e.toValue && e.type === "payment_changed"
                          ? (PAYMENT_STATUS_LABELS[e.toValue as keyof typeof PAYMENT_STATUS_LABELS] ?? e.toValue)
                          : null;
                    return (
                      <li key={e.id} className="relative flex gap-3.5 pb-5 last:pb-0">
                        {!last && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-line" aria-hidden />}
                        <span className={cn("relative z-[1] inline-flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface", meta.tone)}>
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1 pt-1">
                          <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                            <span className="text-ink">
                              <span className="font-medium">{meta.label}</span>
                              {target && (
                                <>
                                  <span className="text-ink-faint" aria-label="vers">
                                    {" "}
                                    →{" "}
                                  </span>
                                  <span className="font-medium">{target}</span>
                                </>
                              )}
                            </span>
                            <time dateTime={e.createdAt.toISOString()} title={formatDateTime(e.createdAt)} className="shrink-0 text-xs text-ink-faint">
                              {relativeTime(e.createdAt)}
                            </time>
                          </p>
                          <p className="mt-0.5 text-[13px] text-ink-muted [overflow-wrap:anywhere]">
                            <span className="text-ink">{e.actorLabel}</span>
                            {e.message ? <>, {clean(e.message)}</> : null}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ───────── Colonne latérale ───────── */}
        <div className="min-w-0 space-y-6">
          {/* Vague 2 : suivi des téléchargements (produits numériques). */}
          <DownloadsCard
            storeId={ctx.store.id}
            canManage={canManage}
            rows={downloads.map((d) => ({
              grantId: d.grantId,
              itemName: d.itemName,
              files: d.files,
              downloadCount: d.downloadCount,
              downloadLimit: d.downloadLimit,
              expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
              lastDownloadAt: d.lastDownloadAt ? d.lastDownloadAt.toISOString() : null,
              notifiedAt: d.notifiedAt ? d.notifiedAt.toISOString() : null,
              expired: d.state.expired,
              exhausted: d.state.exhausted,
            }))}
          />
          {canManage && (
            <Card>
              <CardHeader title="Prochaine étape" />
              <CardBody className="space-y-4 pt-3">
                {closed ? (
                  <p className="text-sm text-ink-muted">
                    Commande {order.status === "CANCELLED" ? "annulée" : "remboursée"}
                    {order.cancelledAt ? ` le ${formatDateTime(order.cancelledAt)}` : ""}.
                  </p>
                ) : stepIndex >= 0 ? (
                  <StepProgress current={stepIndex + 1} total={lifecycle.length} label={`Étape ${stepIndex + 1} sur ${lifecycle.length} : ${ORDER_STATUS_LABELS[order.status]}`} />
                ) : null}
                <StatusActions storeId={ctx.store.id} orderId={order.id} status={order.status} fulfillmentType={order.fulfillmentType} intangible={intangible} />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Client" />
            <CardBody className="space-y-3.5 pt-3 text-sm">
              <div className="flex items-center gap-3">
                <Avatar name={order.customerName} size={40} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {order.customer ? (
                      <Link href={`${base}/clients/${order.customer.id}`} className="hover:text-primary hover:underline hover:underline-offset-4">
                        {order.customerName}
                      </Link>
                    ) : (
                      order.customerName
                    )}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {order.customer
                      ? order.customer.ordersCount > 1
                        ? `${order.customer.ordersCount} commandes au total`
                        : "Première commande"
                      : "Client non enregistré"}
                  </p>
                </div>
              </div>
              <ul className="space-y-1">
                <li>
                  <a href={`tel:+${order.customerPhone}`} className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-[10px] px-2 text-ink transition-colors hover:bg-surface-2">
                    <Phone className="size-4 text-ink-faint" aria-hidden /> <span className="tabular">{formatPhone(order.customerPhone)}</span>
                  </a>
                </li>
                {order.customerEmail && (
                  <li>
                    <a href={`mailto:${order.customerEmail}`} className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-[10px] px-2 text-ink transition-colors hover:bg-surface-2">
                      <Mail className="size-4 text-ink-faint" aria-hidden /> <span className="truncate">{order.customerEmail}</span>
                    </a>
                  </li>
                )}
              </ul>
              {order.customerNote && (
                <div className="rounded-[var(--radius-md)] bg-sun-soft px-3.5 py-2.5 text-ink">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <StickyNote className="size-3.5" aria-hidden /> Note du client
                  </p>
                  <p className="mt-1 [overflow-wrap:anywhere]">{order.customerNote}</p>
                </div>
              )}
              {order.customer && (
                <ButtonLink href={`${base}/clients/${order.customer.id}`} variant="outline" size="sm" className="h-11 w-full sm:h-9">
                  Voir la fiche client
                </ButtonLink>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={FULFILLMENT_LABEL[order.fulfillmentType]} action={<FulfillIcon className="size-4 text-ink-faint" aria-hidden />} />
            <CardBody className="space-y-3 pt-3 text-sm">
              {order.fulfillmentType === "DELIVERY" && (
                <>
                  <p className="flex items-start gap-2.5">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
                    <span className="min-w-0">
                      {order.deliveryZoneName && <span className="block font-medium text-ink">{order.deliveryZoneName}</span>}
                      <span className="text-ink-muted [overflow-wrap:anywhere]">{order.deliveryAddress ?? "Adresse non renseignée"}</span>
                    </span>
                  </p>
                  {order.deliveryAddress && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.deliveryAddress)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline hover:underline-offset-4 sm:min-h-0"
                    >
                      Ouvrir dans Maps <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </>
              )}
              {order.fulfillmentType === "PICKUP" && (
                <p className="flex items-start gap-2.5 text-ink-muted">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
                  <span>Retrait en boutique{ctx.store.address ? ` : ${ctx.store.address}` : "."}</span>
                </p>
              )}
              {order.fulfillmentType === "WHATSAPP" && <p className="text-ink-muted">Modalités à convenir avec le client sur WhatsApp.</p>}
              {order.scheduledFor && (
                <p className="flex items-center gap-2.5 text-ink">
                  <Clock className="size-4 text-ink-faint" aria-hidden /> Créneau : {formatDateTime(order.scheduledFor)}
                </p>
              )}
              {canAssign ? (
                <div className="border-t border-line pt-3">
                  <CourierForm storeId={ctx.store.id} orderId={order.id} courierName={order.courierName} />
                </div>
              ) : (
                order.courierName && <p className="text-ink-muted">Livreur : {order.courierName}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Note interne" description="Visible uniquement par votre équipe." />
            <CardBody className="pt-3">
              {canManage ? (
                <InternalNoteForm storeId={ctx.store.id} orderId={order.id} note={order.internalNote} />
              ) : (
                <p className="text-sm text-ink-muted [overflow-wrap:anywhere]">{order.internalNote ?? "Aucune note."}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Remboursements" action={<Undo2 className="size-4 text-ink-faint" aria-hidden />} />
            <CardBody className="space-y-3 pt-3 text-sm">
              {order.refunds.length > 0 ? (
                <ul className="divide-y divide-line">
                  {order.refunds.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-3 py-2 first:pt-0">
                      <span className="min-w-0">
                        <span className="block text-ink">{formatDate(r.createdAt)}</span>
                        <span className="block text-xs text-ink-muted [overflow-wrap:anywhere]">
                          {REFUND_LABELS[r.status] ?? r.status}
                          {r.reason ? `, ${clean(r.reason)}` : ""}
                        </span>
                      </span>
                      <Money amount={r.amount} currency={order.currency} className={cn("shrink-0 font-mono text-[13px]", r.status === "REJECTED" && "text-ink-faint line-through")} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-muted">Aucun remboursement.</p>
              )}
              {canPay &&
                (refundsEnabled ? (
                  <RefundAction storeId={ctx.store.id} orderId={order.id} paymentStatus={order.paymentStatus} total={order.total} refunded={order.total - refundable.remaining} currency={order.currency} hasCustomer={!!order.customerId} canUseStoreCredit={ctx.can("customers.manage")} />
                ) : (
                  <PlanGate storeId={ctx.store.id} feature="refunds" compact className="px-4 ring-0 bg-surface-2/60" />
                ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular text-ink">{value}</dd>
    </div>
  );
}

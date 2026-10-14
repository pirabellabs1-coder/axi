import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStoreContext } from "@/lib/auth/permissions";
import { getGiftCardDetail } from "@/lib/giftcards/queries";
import { displayGiftCardStatus, GIFT_CARD_STATUS_LABELS, localDayString, DEFAULT_GIFT_CARD_VALIDITY_DAYS } from "@/lib/giftcards/state";
import { maskGiftCardLast4 } from "@/lib/giftcards/code";
import { formatDate, formatDateTime, formatPhone } from "@/lib/utils";
import { PageHeader, Money, KeyValue, EmptyState, Kpi } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Gift, Wallet, CalendarClock, History } from "lucide-react";
import { GiftCardActions } from "../gift-card-ui";
import { STATUS_TONE, SOURCE_LABELS, TX_LABELS } from "../labels";

export const metadata: Metadata = { title: "Carte cadeau" };

export default async function GiftCardPage({ params }: { params: Promise<{ storeId: string; id: string }> }) {
  const { storeId, id } = await params;
  const ctx = await getStoreContext(storeId, "giftcards.manage");
  const sid = ctx.store.id;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) notFound();
  const detail = await getGiftCardDetail(sid, id);
  if (!detail) notFound();
  const { card, transactions, sourceOrder } = detail;
  const now = new Date();
  const ds = displayGiftCardStatus(card, now);
  const expired = !!card.expiresAt && card.expiresAt.getTime() <= now.getTime();
  const tz = ctx.store.timezone;
  const unit = card.currency === "XOF" || card.currency === "XAF" ? "FCFA" : card.currency;
  const base = `/app/${sid}`;
  const extendFrom = card.expiresAt && card.expiresAt.getTime() > now.getTime() ? card.expiresAt : now;

  return (
    <div>
      <PageHeader
        back={{ href: `${base}/cartes-cadeaux`, label: "Cartes cadeaux" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono tabular">{maskGiftCardLast4(card.last4)}</span>
            <Badge tone={STATUS_TONE[ds]} dot>
              {GIFT_CARD_STATUS_LABELS[ds]}
            </Badge>
          </span>
        }
        description={`${SOURCE_LABELS[card.source]} le ${formatDate(card.createdAt)}`}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <Kpi label="Solde" icon={Wallet} value={<Money amount={card.balance} currency={card.currency} />} hint={card.balance === 0 ? "Épuisée" : "Disponible"} />
            <Kpi label="Valeur initiale" icon={Gift} value={<Money amount={card.initialValue} currency={card.currency} />} hint={SOURCE_LABELS[card.source]} />
            <Kpi
              label="Expiration"
              icon={CalendarClock}
              value={card.expiresAt ? formatDate(card.expiresAt) : "Aucune"}
              hint={card.expiresAt ? (expired ? "Date dépassée" : "Fin de journée") : "Sans date limite"}
              className="col-span-2 xl:col-span-1"
            />
          </div>

          <Card>
            <CardHeader title="Actions" description="Le code complet n'est jamais affiché sans action de votre part." />
            <CardBody className="pt-2">
              {card.status === "DISABLED" && card.disabledReason && <p className="mb-3 text-sm text-ink-muted">Motif de désactivation : {card.disabledReason}</p>}
              <GiftCardActions
                storeId={sid}
                id={card.id}
                status={card.status}
                expired={expired}
                unit={unit}
                minDate={localDayString(new Date(now.getTime() + 86_400_000), tz)}
                defaultExtendDate={localDayString(new Date(extendFrom.getTime() + DEFAULT_GIFT_CARD_VALIDITY_DAYS * 86_400_000), tz)}
                canResend={!!(card.recipientEmail || card.recipientPhone)}
              />
            </CardBody>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Journal" description="Chaque mouvement de solde et changement d'état." className="pb-3" />
            {transactions.length === 0 ? (
              <EmptyState compact icon={History} title="Aucun mouvement" />
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {transactions.map((t) => (
                  <li key={t.id} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{TX_LABELS[t.kind]}</span>
                      {t.order && (
                        <Link href={`${base}/commandes/${t.order.id}`} className="ml-2 font-mono text-xs text-primary hover:underline">
                          {t.order.reference}
                        </Link>
                      )}
                      <span className="block text-xs text-ink-muted [overflow-wrap:anywhere]">
                        {formatDateTime(t.createdAt)}
                        {t.actorName ? ` · ${t.actorName}` : ""}
                        {t.note ? ` · ${t.note}` : ""}
                      </span>
                    </span>
                    <span className="text-right">
                      {t.amount !== 0 && (
                        <span className={`tabular block font-semibold ${t.amount < 0 ? "text-danger" : "text-primary"}`}>
                          {t.amount > 0 ? "+" : "−"}
                          <Money amount={Math.abs(t.amount)} currency={card.currency} />
                        </span>
                      )}
                      <span className="tabular block text-xs text-ink-muted">
                        Solde <Money amount={t.balanceAfter} currency={card.currency} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-5" aria-label="Destinataire et origine">
          <Card>
            <CardHeader title="Destinataire" />
            <CardBody className="pt-2">
              <KeyValue
                items={[
                  { label: "Nom", value: card.recipientName ?? <span className="text-ink-faint">Non renseigné</span> },
                  { label: "Téléphone", value: card.recipientPhone ? <span className="tabular">{formatPhone(card.recipientPhone)}</span> : <span className="text-ink-faint">Non renseigné</span> },
                  { label: "E-mail", value: card.recipientEmail ?? <span className="text-ink-faint">Non renseigné</span> },
                  { label: "Envoi", value: card.deliveredAt ? `Envoyée le ${formatDate(card.deliveredAt)}` : card.sendAt ? `Programmée le ${formatDate(card.sendAt)}` : <span className="text-ink-faint">Non envoyée par e-mail</span> },
                ]}
              />
              {card.message && <p className="mt-3 whitespace-pre-line rounded-[var(--radius-md)] bg-surface-2 px-3 py-2 text-sm text-ink [overflow-wrap:anywhere]">« {card.message} »</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Origine" />
            <CardBody className="pt-2">
              <KeyValue
                items={[
                  { label: "Source", value: SOURCE_LABELS[card.source] },
                  {
                    label: "Commande",
                    value: sourceOrder ? (
                      <Link href={`${base}/commandes/${sourceOrder.id}`} className="font-mono text-primary hover:underline">
                        {sourceOrder.reference}
                      </Link>
                    ) : (
                      <span className="text-ink-faint">Aucune</span>
                    ),
                  },
                  {
                    label: "Client",
                    value: card.customer ? (
                      <Link href={`${base}/clients/${card.customer.id}`} className="text-primary hover:underline">
                        {card.customer.name}
                      </Link>
                    ) : (
                      <span className="text-ink-faint">Non rattachée</span>
                    ),
                  },
                  { label: "Devise", value: card.currency },
                ]}
              />
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

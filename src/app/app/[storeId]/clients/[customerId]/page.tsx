import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle, Plus, ShoppingBag, Wallet, ShoppingBasket, Award, Receipt, Phone, Mail } from "lucide-react";
import { getStoreContext, planFeature } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatPhone, formatDate, formatDateTime, relativeTime } from "@/lib/utils";
import { waLink } from "@/lib/whatsapp";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/commerce/order-state";
import { PlanGate } from "@/components/app/plan-gate";
import { PageHeader, Avatar, Money, Kpi, KeyValue, EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Table, THead, TH, TBody, TR, TD, RowLink, rowLink } from "@/components/ui/table";
import { CustomerForm, ConsentPanel, DeleteCustomerButton } from "./customer-panels";
import { BuyerAccountPanel } from "./buyer-account-panel";
import { StoreCreditPanel } from "./store-credit-panel";
import { MetafieldsEditor } from "@/components/app/metafields-editor";

export const metadata: Metadata = { title: "Fiche client" };

const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
const PURPOSES = ["TRANSACTIONAL", "MARKETING"] as const;
const CHANNEL_LABEL = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "E-mail", PUSH: "Notifications push" } as const;
const LOYALTY_REASON: Record<string, string> = { order: "Commande", reward: "Récompense", adjustment: "Ajustement", refund: "Remboursement", expiration: "Expiration", redeem: "Points utilisés", redeem_reversal: "Points restitués", return: "Retour d'articles" };

export default async function CustomerPage({ params }: { params: Promise<{ storeId: string; customerId: string }> }) {
  const { storeId, customerId } = await params;
  const ctx = await getStoreContext(storeId, "customers.view");
  const sid = ctx.store.id;
  const crm = planFeature(ctx.planId, "crm");
  const loyalty = crm && planFeature(ctx.planId, "loyalty");
  const customer = await db.customer.findFirst({
    where: { id: customerId, storeId: sid },
    include: {
      orders: { where: { storeId: sid }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, reference: true, createdAt: true, total: true, currency: true, status: true } },
      consents: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!customer) notFound();
  const base = `/app/${sid}`;
  const canManage = ctx.can("customers.manage");
  const currency = ctx.store.currency;
  const avgBasket = customer.ordersCount > 0 ? Math.round(customer.totalSpent / customer.ordersCount) : null;
  const ledger = loyalty ? await db.loyaltyLedger.findMany({ where: { storeId: sid, customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, delta: true, reason: true, createdAt: true } }) : [];

  // Dernier consentement connu par (canal, finalité)
  const latest = CHANNELS.flatMap((channel) =>
    PURPOSES.map((purpose) => {
      const c = customer.consents.find((x) => x.channel === channel && x.purpose === purpose);
      return { channel, purpose, granted: c?.granted ?? null, at: c?.createdAt ?? null, source: c?.source ?? null };
    }),
  );

  return (
    <div>
      <PageHeader
        back={{ href: `${base}/clients`, label: "Clients" }}
        title={
          <span className="flex items-center gap-4">
            <Avatar name={customer.name} size={56} />
            <span className="min-w-0">
              <span className="block [overflow-wrap:anywhere]">{customer.name}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm font-normal tracking-normal text-ink-muted">
                <a href={`tel:+${customer.phone}`} className="tabular inline-flex min-h-8 items-center gap-1.5 hover:text-ink">
                  <Phone className="size-3.5" aria-hidden /> {formatPhone(customer.phone)}
                </a>
                {crm &&
                  customer.tags.map((t) => (
                    <Badge key={t} tone="neutral">
                      {t}
                    </Badge>
                  ))}
              </span>
            </span>
          </span>
        }
        actions={
          <>
            {ctx.can("orders.manage") && (
              <ButtonLink href={`${base}/commandes/nouvelle?client=${customer.id}`} variant="outline">
                <Plus className="size-4" aria-hidden /> Nouvelle commande
              </ButtonLink>
            )}
            <ButtonLink href={waLink(customer.phone, `Bonjour ${customer.name}, c'est ${ctx.store.name}.`)} target="_blank" rel="noopener noreferrer" variant="whatsapp">
              <MessageCircle className="size-4" aria-hidden /> WhatsApp
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <div className={`grid grid-cols-2 gap-3 ${loyalty ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
            <Kpi label="Commandes" icon={ShoppingBag} value={customer.ordersCount.toLocaleString("fr-FR")} hint={customer.lastOrderAt ? `Dernière ${relativeTime(customer.lastOrderAt)}` : "Aucune commande"} />
            <Kpi label="Total dépensé" icon={Wallet} value={<Money amount={customer.totalSpent} currency={currency} />} hint="Cumul des commandes" />
            <Kpi label="Panier moyen" icon={ShoppingBasket} value={avgBasket != null ? <Money amount={avgBasket} currency={currency} /> : "Aucun"} hint="Par commande" />
            {loyalty && <Kpi label="Points fidélité" icon={Award} value={customer.loyaltyPoints.toLocaleString("fr-FR")} hint="Solde actuel" />}
          </div>

          <Card className="overflow-hidden">
            <CardHeader
              title="Historique des commandes"
              description={customer.orders.length ? `${customer.orders.length} plus récente${customer.orders.length > 1 ? "s" : ""}` : undefined}
              className="pb-4"
            />
            {customer.orders.length === 0 ? (
              <EmptyState compact icon={Receipt} title="Aucune commande" description="Les commandes de ce client apparaîtront ici." />
            ) : (
              <>
                <ul className="divide-y divide-line border-t border-line md:hidden" aria-label="Commandes">
                  {customer.orders.map((o) => (
                    <li key={o.id} className="relative flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <Link href={`${base}/commandes/${o.id}`} className="font-mono text-sm font-semibold text-ink after:absolute after:inset-0 after:content-['']">
                          {o.reference}
                        </Link>
                        <p className="text-xs text-ink-muted">{formatDateTime(o.createdAt)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Money amount={o.total} currency={o.currency} className="text-sm font-semibold" />
                        <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden border-t border-line md:block">
                  <Table bare minWidth={520}>
                    <THead>
                      <tr>
                        <TH>Référence</TH>
                        <TH>Date</TH>
                        <TH>Statut</TH>
                        <TH align="right">Total</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {customer.orders.map((o) => (
                        <TR key={o.id} className={rowLink}>
                          <TD>
                            <RowLink href={`${base}/commandes/${o.id}`} className="font-mono text-[13px]">
                              {o.reference}
                            </RowLink>
                          </TD>
                          <TD className="whitespace-nowrap text-ink-muted">{formatDateTime(o.createdAt)}</TD>
                          <TD>
                            <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                          </TD>
                          <TD align="right">
                            <Money amount={o.total} currency={o.currency} className="font-medium" />
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </>
            )}
          </Card>

          {loyalty && ledger.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Mouvements de points" className="pb-3" />
              <ul className="divide-y divide-line border-t border-line">
                {ledger.map((l) => (
                  <li key={l.id} className="flex min-h-11 items-center justify-between gap-3 px-5 py-2 text-sm">
                    <span className="text-ink">
                      {LOYALTY_REASON[l.reason] ?? l.reason}
                      <span className="ml-2 text-xs text-ink-faint">{formatDate(l.createdAt)}</span>
                    </span>
                    <span className={`tabular font-semibold ${l.delta < 0 ? "text-danger" : "text-primary"}`}>
                      {l.delta > 0 ? "+" : ""}
                      {l.delta.toLocaleString("fr-FR")}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <aside className="space-y-5" aria-label="Informations client">
          <Card>
            <CardHeader title="Coordonnées" />
            <CardBody className="pt-2">
              <KeyValue
                items={[
                  { label: "Téléphone", value: <a href={`tel:+${customer.phone}`} className="tabular hover:text-primary">{formatPhone(customer.phone)}</a> },
                  {
                    label: "E-mail",
                    value: customer.email ? (
                      <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 hover:text-primary">
                        <Mail className="size-3.5 text-ink-faint" aria-hidden /> {customer.email}
                      </a>
                    ) : (
                      <span className="text-ink-faint">Non renseigné</span>
                    ),
                  },
                  { label: "Adresse", value: customer.address || <span className="text-ink-faint">Non renseignée</span> },
                  { label: "Client depuis", value: formatDate(customer.createdAt) },
                  { label: "Dernière commande", value: customer.lastOrderAt ? formatDate(customer.lastOrderAt) : <span className="text-ink-faint">Jamais</span> },
                ]}
              />
            </CardBody>
          </Card>

          <StoreCreditPanel storeId={sid} customerId={customer.id} planId={ctx.planId} canManage={canManage} currency={currency} />

          {crm ? (
            <Card>
              <CardHeader title={canManage ? "Notes et tags" : "Notes internes"} description="Jamais visibles par le client." />
              <CardBody>
                {canManage ? (
                  <CustomerForm storeId={sid} customer={{ id: customer.id, name: customer.name, email: customer.email, address: customer.address, notes: customer.notes, tags: customer.tags }} />
                ) : customer.notes ? (
                  <p className="whitespace-pre-line text-sm text-ink">{customer.notes}</p>
                ) : (
                  <p className="text-sm text-ink-faint">Aucune note.</p>
                )}
              </CardBody>
            </Card>
          ) : (
            <PlanGate storeId={sid} feature="crm" compact description="Notes, tags et consentements sont inclus dans le CRM. Les coordonnées restent consultables." />
          )}

          {crm && (
            <Card>
              <CardHeader title="Consentements" description="Preuve par canal et finalité, horodatée." />
              <CardBody className="pt-2">
                <ConsentPanel storeId={sid} customerId={customer.id} latest={latest.map((l) => ({ ...l, at: l.at?.toISOString() ?? null }))} canManage={canManage} />
                {customer.consents.length > 0 && (
                  <details className="group mt-3 text-sm">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-ink-muted hover:text-ink">Historique complet ({customer.consents.length})</summary>
                    <ul className="mt-1 space-y-1.5 text-xs text-ink-muted">
                      {customer.consents.map((c) => (
                        <li key={c.id}>
                          {formatDateTime(c.createdAt)} · {CHANNEL_LABEL[c.channel]}, {c.purpose === "MARKETING" ? "marketing" : "transactionnel"} : {c.granted ? "accordé" : "retiré"} (source : {c.source})
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardBody>
            </Card>
          )}

          {/* Lot 1 (équipe A) : compte acheteur, sessions et demande de suppression */}
          <BuyerAccountPanel storeId={sid} customerId={customer.id} canManage={canManage} />

          {canManage && (
            <Card>
              <CardHeader title="Données personnelles" />
              <CardBody>
                <p className="text-sm text-ink-muted">À la demande du client, supprimez sa fiche : ses commandes sont conservées mais anonymisées.</p>
                <div className="mt-3">
                  <DeleteCustomerButton storeId={sid} customerId={customer.id} name={customer.name} />
                </div>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
      <MetafieldsEditor storeId={sid} ownerType="CUSTOMER" ownerId={customer.id} />
    </div>
  );
}

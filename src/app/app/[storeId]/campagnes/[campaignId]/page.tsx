import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Users, Send, AlertTriangle, MousePointerClick, ShoppingBag, Coins } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { isWhatsappApiActive } from "@/lib/inbox/service";
import { refreshAttribution } from "@/lib/campaigns/service";
import { ATTRIBUTION_DAYS, describeSegment, firstName, parseSegment, renderCampaignMessage } from "@/lib/campaigns/segments";
import { PageHeader, Stat, Alert, Money } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { PlanGate } from "@/components/app/plan-gate";
import { formatDateTime, formatPhone } from "@/lib/utils";
import { CampaignActions } from "../campaign-actions";
import { STATUS } from "../status";

export const metadata: Metadata = { title: "Campagne" };

export default async function CampaignPage({ params }: { params: Promise<{ storeId: string; campaignId: string }> }) {
  const { storeId, campaignId } = await params;
  const ctx = await getStoreContext(storeId, "customers.manage");
  const store = ctx.store;
  const back = { href: `/app/${store.id}/campagnes`, label: "Campagnes" };
  if (!PLANS[ctx.planId].features.campaigns) {
    return (
      <>
        <PageHeader title="Campagne" back={back} />
        <PlanGate storeId={store.id} feature="campaigns" />
      </>
    );
  }

  const campaign = await db.campaign.findFirst({ where: { id: campaignId, storeId: store.id } });
  if (!campaign) notFound();
  const segment = parseSegment(campaign.segment);
  const [attribution, apiActive] = await Promise.all([campaign.status === "SENT" ? refreshAttribution(store.id, campaign.id) : Promise.resolve(null), isWhatsappApiActive(store.id)]);
  const linkOnly = campaign.status === "SENT" && campaign.creditsUsed === 0 && campaign.sentCount === 0;

  const phones = segment.snapshot ?? [];
  const recipients = linkOnly && phones.length
    ? await db.customer.findMany({ where: { storeId: store.id, phone: { in: phones.slice(0, 300) } }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } })
    : [];
  const conversations = recipients.length
    ? await db.conversation.findMany({ where: { storeId: store.id, channel: "whatsapp", phone: { in: recipients.map((r) => r.phone) } }, select: { id: true, phone: true } })
    : [];
  const convByPhone = new Map(conversations.map((c) => [c.phone, c.id]));
  const s = STATUS[campaign.status];

  return (
    <>
      <PageHeader
        title={campaign.name}
        back={back}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={s.tone}>{s.label}</Badge>
            <span>{describeSegment(segment)}</span>
            <span aria-hidden>·</span>
            <span>
              {campaign.sentAt ? `Envoyée le ${formatDateTime(campaign.sentAt)}` : campaign.scheduledAt && campaign.status === "SCHEDULED" ? `Prévue le ${formatDateTime(campaign.scheduledAt)}` : `Créée le ${formatDateTime(campaign.createdAt)}`}
            </span>
          </span>
        }
        actions={<CampaignActions storeId={store.id} id={campaign.id} status={campaign.status} apiActive={apiActive} />}
      />

      {campaign.status === "SENT" && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="Destinataires" value={campaign.recipients} icon={Users} />
          <Stat label="Envoyés" value={linkOnly ? "-" : campaign.sentCount} icon={Send} hint={linkOnly ? "Envoi manuel" : "Confirmés par WhatsApp"} />
          <Stat label="Échecs" value={linkOnly ? "-" : campaign.failedCount} icon={AlertTriangle} hint={linkOnly ? undefined : "Recrédités"} />
          <Stat label="Clics" value={campaign.clicks > 0 ? campaign.clicks : "-"} icon={MousePointerClick} hint="Lien de suivi à venir" />
          <Stat label="Commandes" value={attribution?.orders ?? campaign.ordersAttributed} icon={ShoppingBag} hint={`Sous ${ATTRIBUTION_DAYS} jours`} />
          <Stat label="Crédits utilisés" value={campaign.creditsUsed} icon={Coins} hint={attribution && attribution.revenue > 0 ? <Money amount={attribution.revenue} currency={store.currency} /> : undefined} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card>
          <CardHeader title="Message" description="Variables remplacées pour chaque client." />
          <CardBody>
            <div className="rounded-[var(--radius-md)] bg-canvas-deep/70 p-4">
              <p className="max-w-[92%] whitespace-pre-wrap break-words rounded-[16px] rounded-tl-md bg-surface px-3.5 py-2.5 text-[14px] leading-relaxed text-ink shadow-[var(--shadow-sm)] [overflow-wrap:anywhere]">{campaign.message}</p>
            </div>
          </CardBody>
        </Card>

        {linkOnly ? (
          <Card>
            <CardHeader title="Messages à envoyer" description="L'API WhatsApp n'étant pas connectée, envoyez chaque message depuis WhatsApp. Rien n'a été envoyé automatiquement." />
            <CardBody className="pt-3">
              {recipients.length === 0 ? (
                <p className="text-sm text-ink-muted">Aucun destinataire retrouvé.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {recipients.map((r) => {
                    const text = renderCampaignMessage(campaign.message, { prenom: firstName(r.name), boutique: store.name });
                    const convId = convByPhone.get(r.phone);
                    return (
                      <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          {convId ? (
                            <Link href={`/app/${store.id}/conversations?c=${convId}`} className="font-medium text-ink hover:text-primary hover:underline">
                              {r.name}
                            </Link>
                          ) : (
                            <span className="font-medium text-ink">{r.name}</span>
                          )}
                          <p className="text-xs text-ink-muted tabular">{formatPhone(r.phone)}</p>
                        </div>
                        <a
                          href={`https://wa.me/${r.phone}?text=${encodeURIComponent(text)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-whatsapp-deep px-4 text-sm font-medium text-white hover:brightness-110"
                        >
                          Ouvrir dans WhatsApp <ExternalLink className="size-3.5" aria-hidden />
                          <span className="sr-only"> pour {r.name}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
              {phones.length > 300 && <p className="mt-3 text-xs text-ink-muted">300 premiers destinataires affichés sur {phones.length}.</p>}
            </CardBody>
          </Card>
        ) : campaign.status === "SENT" ? (
          <Card>
            <CardHeader title="Suivi" />
            <CardBody className="space-y-3 text-sm text-ink-muted">
              <p>Les statuts d&apos;envoi (envoyé, distribué, lu, échec) sont mis à jour par WhatsApp. Chaque message apparaît dans la conversation du client.</p>
              <p>
                Commandes attribuées : commandes passées par un destinataire dans les {ATTRIBUTION_DAYS} jours suivant l&apos;envoi.
              </p>
            </CardBody>
          </Card>
        ) : (
          <Alert tone="info" title={campaign.status === "SCHEDULED" ? "Envoi planifié" : campaign.status === "CANCELLED" ? "Campagne annulée" : "Brouillon"}>
            {campaign.status === "SCHEDULED"
              ? "La campagne partira automatiquement à la date prévue. L'audience et le coût sont recalculés au moment de l'envoi, selon les consentements à jour."
              : campaign.status === "CANCELLED"
                ? "Cette campagne ne sera pas envoyée."
                : "Envoyez-la quand vous êtes prêt : l'audience et le coût sont calculés au moment de l'envoi."}
          </Alert>
        )}
      </div>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone, Plus, Wallet, Send, ShoppingBag } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { getBalances } from "@/lib/credits";
import { isWhatsappApiActive } from "@/lib/inbox/service";
import { runDueCampaigns } from "@/lib/campaigns/service";
import { describeSegment, parseSegment } from "@/lib/campaigns/segments";
import { PageHeader, EmptyState, Stat, Money } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { formatDateTime } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { CampaignActions } from "./campaign-actions";
import { STATUS } from "./status";

export const metadata: Metadata = { title: "Campagnes" };


export default async function CampaignsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "customers.manage");
  const store = ctx.store;
  const base = `/app/${store.id}/campagnes`;

  if (!PLANS[ctx.planId].features.campaigns) {
    return (
      <>
        <PageHeader title="Campagnes" description="Envoyez promotions et nouveautés à vos clients sur WhatsApp." />
        <PlanGate storeId={store.id} feature="campaigns" description="Ciblez vos clients fidèles, inactifs ou nouveaux, personnalisez le message avec leur prénom et mesurez les commandes générées. Seuls les clients qui ont accepté vos messages marketing sont contactés." />
      </>
    );
  }

  // Les campagnes planifiées arrivées à échéance partent à l'ouverture de la page (en plus du cron).
  await runDueCampaigns(store.id);

  const [campaigns, balances, apiActive] = await Promise.all([
    db.campaign.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    getBalances(store.id),
    isWhatsappApiActive(store.id),
  ]);
  const sent = campaigns.filter((c) => c.status === "SENT");
  const revenue = sent.reduce((s, c) => s + c.revenueAttributed, 0);
  const reached = sent.reduce((s, c) => s + c.recipients, 0);

  return (
    <>
      <PageHeader
        title="Campagnes"
        description="Promotions et nouveautés envoyées sur WhatsApp, uniquement aux clients qui l'ont accepté."
        actions={
          <ButtonLink href={`${base}/nouvelle`} trailing={Plus}>
            Nouvelle campagne
          </ButtonLink>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Crédits marketing" value={balances.WA_MARKETING} icon={Wallet} hint={apiActive ? "1 crédit par message envoyé" : "Non utilisés sans l'API WhatsApp"} />
        <Stat label="Clients touchés" value={reached} icon={Send} hint={`${sent.length} campagne${sent.length > 1 ? "s" : ""} envoyée${sent.length > 1 ? "s" : ""}`} />
        <Stat label="Ventes attribuées" value={formatMoney(revenue, store.currency)} icon={ShoppingBag} hint="Commandes des destinataires sous 7 jours" />
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Aucune campagne pour l'instant"
          description="Annoncez une nouveauté, relancez vos clients inactifs ou remerciez vos fidèles. Le coût en crédits s'affiche avant chaque envoi."
          action={
            <ButtonLink href={`${base}/nouvelle`} trailing={Plus}>
              Créer ma première campagne
            </ButtonLink>
          }
        />
      ) : (
        <Table className="relative">
          <THead>
            <tr>
              <TH>Campagne</TH>
              <TH>Statut</TH>
              <TH align="right">Destinataires</TH>
              <TH align="right">Envoyés</TH>
              <TH align="right">Échecs</TH>
              <TH align="right">Commandes</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {campaigns.map((c) => {
              const s = STATUS[c.status];
              const linkOnly = c.status === "SENT" && c.creditsUsed === 0 && c.sentCount === 0;
              return (
                <TR key={c.id}>
                  <TD>
                    <Link href={`${base}/${c.id}`} className="font-medium text-ink hover:text-primary hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      {describeSegment(parseSegment(c.segment))}
                      {" · "}
                      {c.status === "SCHEDULED" && c.scheduledAt ? `prévue le ${formatDateTime(c.scheduledAt)}` : c.sentAt ? `envoyée le ${formatDateTime(c.sentAt)}` : `créée le ${formatDateTime(c.createdAt)}`}
                    </p>
                  </TD>
                  <TD>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {linkOnly && <p className="mt-1 text-[11px] text-ink-faint">Envoi manuel</p>}
                  </TD>
                  <TD align="right">{c.status === "SENT" ? c.recipients : "-"}</TD>
                  <TD align="right">{c.status === "SENT" ? (linkOnly ? "-" : c.sentCount) : "-"}</TD>
                  <TD align="right">{c.status === "SENT" && c.failedCount > 0 ? <span className="text-danger">{c.failedCount}</span> : "-"}</TD>
                  <TD align="right">
                    {c.status === "SENT" ? (
                      <span>
                        {c.ordersAttributed}
                        {c.revenueAttributed > 0 && (
                          <span className="block text-xs text-ink-muted">
                            <Money amount={c.revenueAttributed} currency={store.currency} />
                          </span>
                        )}
                      </span>
                    ) : (
                      "-"
                    )}
                  </TD>
                  <TD align="right">
                    <CampaignActions storeId={store.id} id={c.id} status={c.status} apiActive={apiActive} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}

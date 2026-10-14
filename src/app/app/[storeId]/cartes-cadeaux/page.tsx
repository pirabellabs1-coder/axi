import type { Metadata } from "next";
import { Gift, Wallet, SearchX, ChevronLeft, ChevronRight, Ticket } from "lucide-react";
import { getStoreContext, planFeature } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { listGiftCards, giftCardStats, type GiftCardListFilter } from "@/lib/giftcards/queries";
import { displayGiftCardStatus, GIFT_CARD_STATUS_LABELS, giftCardLimits, localDayString, DEFAULT_GIFT_CARD_VALIDITY_DAYS } from "@/lib/giftcards/state";
import { PlanGate } from "@/components/app/plan-gate";
import { PageHeader, EmptyState, Money, Kpi } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Table, THead, TH, TBody, TR, TD, RowLink, rowLink, TableToolbar, TableFooter } from "@/components/ui/table";
import { CreateGiftCardButton, GiftCardSearch } from "./gift-card-ui";
import { STATUS_TONE, SOURCE_LABELS } from "./labels";

export const metadata: Metadata = { title: "Cartes cadeaux" };

const PAGE_SIZE = 25;
const FILTERS: { key: GiftCardListFilter; label: string }[] = [
  { key: "", label: "Toutes" },
  { key: "active", label: "Actives" },
  { key: "exhausted", label: "Épuisées" },
  { key: "disabled", label: "Désactivées" },
  { key: "expired", label: "Expirées" },
];

export default async function GiftCardsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ storeId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getStoreContext(storeId, "giftcards.manage");
  const sid = ctx.store.id;
  const base = `/app/${sid}/cartes-cadeaux`;
  const currency = ctx.store.currency;
  const enabled = planFeature(ctx.planId, "giftCards");
  const status: GiftCardListFilter = FILTERS.find((f) => f.key === (sp.statut ?? ""))?.key ?? "";
  const q = (sp.q ?? "").trim().slice(0, 20);
  const clientId = sp.client && /^[A-Za-z0-9_-]{8,64}$/.test(sp.client) ? sp.client : null;
  const client = clientId ? await db.customer.findFirst({ where: { id: clientId, storeId: sid }, select: { id: true, name: true } }) : null;
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, total }, stats] = await Promise.all([
    listGiftCards(sid, { status, q, customerId: client?.id ?? null, page, pageSize: PAGE_SIZE }),
    giftCardStats(sid),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const now = new Date();
  const limits = giftCardLimits(currency);

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ statut: status || undefined, q: q || undefined, client: client?.id, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Cartes cadeaux"
        description="Vendez des cartes cadeaux, offrez-en à vos clients et suivez les soldes. Les codes ne sont jamais affichés en clair sans action de votre part."
        actions={
          enabled ? (
            <CreateGiftCardButton
              storeId={sid}
              currency={currency}
              minValue={limits.minValue}
              maxValue={limits.maxValue}
              defaultExpiresOn={localDayString(new Date(now.getTime() + DEFAULT_GIFT_CARD_VALIDITY_DAYS * 86_400_000), ctx.store.timezone)}
              minExpiresOn={localDayString(new Date(now.getTime() + 86_400_000), ctx.store.timezone)}
            />
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Cartes émises" icon={Gift} value={stats.count.toLocaleString("fr-FR")} hint={stats.count ? "Depuis l'ouverture" : "Aucune carte"} />
        <Kpi label="Cartes utilisables" icon={Ticket} value={stats.activeCount.toLocaleString("fr-FR")} hint="Actives et non expirées" />
        <Kpi label="Soldes en circulation" icon={Wallet} value={<Money amount={stats.outstanding} currency={currency} />} hint="Montant dû aux porteurs" className="col-span-2 lg:col-span-1" />
      </div>

      {!enabled && (
        <PlanGate
          storeId={sid}
          feature="giftCards"
          compact
          className="mb-5"
          description="Création et vente de cartes cadeaux incluses à partir du plan Business. Les cartes déjà émises restent utilisables et gérables."
        />
      )}

      {stats.count === 0 ? (
        <EmptyState
          icon={Gift}
          title="Aucune carte cadeau pour l'instant"
          description="Créez une carte pour un client fidèle, ou ajoutez un produit « carte cadeau » à votre catalogue : la carte est émise et envoyée automatiquement après paiement."
        />
      ) : (
        <Card className="overflow-hidden">
          <TableToolbar className="gap-y-3">
            <Segmented label="Statut des cartes" size="sm" value={status || "all"} options={FILTERS.map((f) => ({ value: f.key || "all", label: f.label, href: qs({ statut: f.key || undefined, page: undefined }) }))} />
            <GiftCardSearch action={base} q={q} status={status || undefined} client={client?.id} />
          </TableToolbar>
          {client && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm text-ink-muted">
              Cartes rattachées à <span className="font-medium text-ink">{client.name}</span>
              <ButtonLink href={qs({ client: undefined, page: undefined })} variant="ghost" size="sm">
                Retirer le filtre
              </ButtonLink>
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState
              compact
              icon={SearchX}
              title="Aucune carte ne correspond"
              description="Modifiez la recherche (4 derniers caractères du code) ou le statut."
              action={
                <ButtonLink href={base} variant="outline" size="sm">
                  Effacer les filtres
                </ButtonLink>
              }
            />
          ) : (
            <Table bare minWidth={760}>
              <THead>
                <tr>
                  <TH>Carte</TH>
                  <TH>Statut</TH>
                  <TH align="right">Solde</TH>
                  <TH align="right">Valeur</TH>
                  <TH>Destinataire</TH>
                  <TH>Expiration</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((c) => {
                  const ds = displayGiftCardStatus(c, now);
                  return (
                    <TR key={c.id} className={rowLink}>
                      <TD className="py-2">
                        <RowLink href={`${base}/${c.id}`} className="font-mono tabular">
                          •••• {c.last4}
                        </RowLink>
                        <span className="block text-xs text-ink-muted">
                          {SOURCE_LABELS[c.source]} · {formatDate(c.createdAt)}
                        </span>
                      </TD>
                      <TD>
                        <Badge tone={STATUS_TONE[ds]} dot>
                          {GIFT_CARD_STATUS_LABELS[ds]}
                        </Badge>
                      </TD>
                      <TD align="right">
                        <Money amount={c.balance} currency={c.currency} className="font-medium" />
                      </TD>
                      <TD align="right" className="text-ink-muted">
                        <Money amount={c.initialValue} currency={c.currency} />
                      </TD>
                      <TD className="max-w-[220px] truncate">{c.customer?.name ?? c.recipientName ?? <span className="text-ink-faint">Non renseigné</span>}</TD>
                      <TD className="whitespace-nowrap text-ink-muted">{c.expiresAt ? formatDate(c.expiresAt) : <span className="text-ink-faint">Sans expiration</span>}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}

          {total > 0 && (
            <TableFooter>
              <span className="tabular">{pages > 1 ? `${(page - 1) * PAGE_SIZE + 1} à ${Math.min(page * PAGE_SIZE, total)} sur ${total}` : `${total} carte${total > 1 ? "s" : ""}`}</span>
              {pages > 1 && (
                <nav className="flex items-center gap-2" aria-label="Pagination">
                  {page > 1 ? (
                    <ButtonLink href={qs({ page: String(page - 1) })} variant="outline" size="sm" aria-label="Page précédente">
                      <ChevronLeft className="size-4" aria-hidden /> Précédent
                    </ButtonLink>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <ChevronLeft className="size-4" aria-hidden /> Précédent
                    </Button>
                  )}
                  <span className="tabular px-1 text-xs">
                    {page} / {pages}
                  </span>
                  {page < pages ? (
                    <ButtonLink href={qs({ page: String(page + 1) })} variant="outline" size="sm" aria-label="Page suivante">
                      Suivant <ChevronRight className="size-4" aria-hidden />
                    </ButtonLink>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      Suivant <ChevronRight className="size-4" aria-hidden />
                    </Button>
                  )}
                </nav>
              )}
            </TableFooter>
          )}
        </Card>
      )}
    </div>
  );
}

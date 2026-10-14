import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Search, MessagesSquare, PlugZap } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { getBalances } from "@/lib/credits";
import { isWhatsappApiActive } from "@/lib/inbox/service";
import { listConversations, countInbox, getConversation, listLabels, listMembers } from "@/lib/inbox/queries";
import { INBOX_FILTERS, STATUS_LABELS, type InboxFilter } from "@/lib/inbox/constants";
import { PageHeader, Avatar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { PlanGate } from "@/components/app/plan-gate";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageList } from "@/components/inbox/message-list";
import { ThreadScroller } from "@/components/inbox/thread-scroller";
import { Composer } from "@/components/inbox/composer";
import { CustomerPanel, type PanelData } from "@/components/inbox/customer-panel";
import { CustomerSheet, StatusActions } from "@/components/inbox/panel-controls";
import { NewConversationButton, QuickRepliesButton } from "@/components/inbox/inbox-dialogs";
import { AutoRefresh } from "@/components/inbox/auto-refresh";
import { formatPhone, cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conversations" };

export default async function ConversationsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "orders.view");
  const store = ctx.store;
  const base = `/app/${store.id}/conversations`;
  const features = PLANS[ctx.planId].features;

  if (!features.inbox) {
    return (
      <>
        <PageHeader title="Conversations" description="Une boîte WhatsApp partagée pour toute l'équipe." />
        <PlanGate
          storeId={store.id}
          feature="inbox"
          description="Répondez à vos clients à plusieurs depuis un seul numéro WhatsApp : attribution, notes internes, réponses rapides et fiche client à côté de chaque conversation."
        />
      </>
    );
  }

  const filter = (INBOX_FILTERS.find((f) => f.key === sp.f)?.key ?? "") as InboxFilter;
  const q = (sp.q ?? "").slice(0, 60);
  const label = (sp.l ?? "").slice(0, 24);
  const selectedId = sp.c ?? null;

  const [items, counts, labels, detail, quickReplies, members, apiActive, balances] = await Promise.all([
    listConversations(store.id, { filter, q, label, userId: ctx.user.id }),
    countInbox(store.id, ctx.user.id),
    listLabels(store.id),
    selectedId ? getConversation(store.id, selectedId) : Promise.resolve(null),
    db.quickReply.findMany({ where: { storeId: store.id }, orderBy: { shortcut: "asc" }, select: { id: true, shortcut: true, body: true } }),
    listMembers(store.id),
    isWhatsappApiActive(store.id),
    getBalances(store.id),
  ]);

  const qs = (over: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = { f: filter || null, q: q || null, l: label || null, c: selectedId, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  const countFor = (key: string) => (key === "non-lues" ? counts.unread : key === "a-moi" ? counts.mine : key === "non-attribuees" ? counts.unassigned : undefined);

  const conv = detail?.conversation ?? null;
  const panel: PanelData | null = conv
    ? {
        storeId: store.id,
        currency: store.currency,
        conversation: { id: conv.id, name: conv.name, phone: conv.phone, stage: conv.stage, status: conv.status, labels: conv.labels, estimatedValue: conv.estimatedValue, assignedToId: conv.assignedToId, createdAt: conv.createdAt },
        customer: conv.customer,
        orders: detail!.orders,
        members,
        labelSuggestions: labels,
        currentUserId: ctx.user.id,
        canAssign: ctx.can("orders.assign"),
        canEdit: ctx.can("orders.manage"),
        canViewCustomer: ctx.can("customers.view"),
        pipeline: features.pipeline,
      }
    : null;

  return (
    <>
      <PageHeader
        title="Conversations"
        description="La boîte WhatsApp partagée de votre équipe."
        actions={
          <>
            <QuickRepliesButton storeId={store.id} replies={quickReplies} canManage={ctx.can("store.settings")} />
            {ctx.can("orders.manage") && <NewConversationButton storeId={store.id} />}
          </>
        }
      />

      {!apiActive && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] bg-surface px-4 py-3 text-sm ring-1 ring-line">
          <PlugZap className="size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 flex-1 text-ink-muted">
            <span className="font-medium text-ink">API WhatsApp non connectée.</span> Vos réponses sont préparées ici puis envoyées depuis WhatsApp en un clic. Les messages entrants s&apos;afficheront ici dès la connexion.
          </p>
          {ctx.can("integrations.manage") && (
            <Link href={`/app/${store.id}/whatsapp`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Connecter l&apos;API
            </Link>
          )}
        </div>
      )}

      <div
        className={cn(
          "grid h-[calc(100dvh-9.5rem)] min-h-[520px] overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-card)] ring-1 ring-line",
          "-mt-1 lg:-mx-4 xl:-mx-6",
          "grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]",
        )}
      >
        {/* Liste */}
        <section aria-label="Liste des conversations" className={cn("min-h-0 flex-col border-line lg:flex lg:border-r", conv ? "hidden" : "flex")}>
          <div className="space-y-2.5 border-b border-line p-3">
            <form action={base} method="get" role="search">
              {filter && <input type="hidden" name="f" value={filter} />}
              {label && <input type="hidden" name="l" value={label} />}
              <label htmlFor="inbox-q" className="sr-only">
                Rechercher une conversation
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
                <input
                  id="inbox-q"
                  name="q"
                  type="search"
                  defaultValue={q}
                  placeholder="Nom, numéro, message"
                  className="h-11 w-full rounded-full bg-surface-2 pl-10 pr-4 text-sm text-ink placeholder:text-ink-faint focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </form>
            <nav aria-label="Filtres" className="relative scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1">
              {INBOX_FILTERS.map((f) => {
                const active = filter === f.key;
                const n = countFor(f.key);
                return (
                  <Link
                    key={f.key}
                    href={qs({ f: f.key || null, c: null })}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-150",
                      active ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {f.label}
                    {n !== undefined && n > 0 && <span className={cn("text-xs tabular", active ? "text-canvas/70" : "text-ink-faint")}>{n}</span>}
                  </Link>
                );
              })}
            </nav>
            {labels.length > 0 && (
              <nav aria-label="Étiquettes" className="relative scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1">
                {labels.map((l) => {
                  const active = label === l;
                  return (
                    <Link
                      key={l}
                      href={qs({ l: active ? null : l, c: null })}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex h-8 shrink-0 items-center rounded-full px-2.5 text-xs font-medium ring-1 ring-inset transition-colors duration-150",
                        active ? "bg-primary-soft text-primary-deep ring-primary/30" : "text-ink-muted ring-line hover:text-ink",
                      )}
                    >
                      #{l}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>
          <ConversationList
            items={items}
            activeId={conv?.id ?? null}
            hrefFor={(id) => qs({ c: id })}
            emptyHint={
              q || label || filter
                ? "Aucun résultat pour ces filtres."
                : apiActive
                  ? "Les messages reçus sur votre numéro WhatsApp apparaîtront ici."
                  : "Ouvrez une conversation avec un client, ou connectez l'API WhatsApp pour recevoir vos messages ici."
            }
          />
        </section>

        {/* Fil */}
        <section aria-label="Conversation" className={cn("min-h-0 min-w-0 flex-col lg:flex", conv ? "flex" : "hidden")}>
          {conv && detail ? (
            <>
              <header className="flex items-center gap-2 border-b border-line px-2 py-2 sm:px-4">
                <Link href={qs({ c: null })} className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink lg:hidden" aria-label="Retour à la liste">
                  <ArrowLeft className="size-5" aria-hidden />
                </Link>
                <Avatar name={conv.name} size={36} className="hidden sm:inline-flex" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-semibold text-ink">{conv.name}</h2>
                  <p className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="tabular">{formatPhone(conv.phone)}</span>
                    {conv.status !== "OPEN" && <Badge tone={conv.status === "CLOSED" ? "neutral" : "warning"} className="px-2 py-0 text-[11px] leading-[18px]">{STATUS_LABELS[conv.status]}</Badge>}
                  </p>
                </div>
                {ctx.can("orders.manage") && <StatusActions storeId={store.id} conversationId={conv.id} status={conv.status} />}
                {panel && (
                  <CustomerSheet title={conv.name}>
                    <CustomerPanel {...panel} />
                  </CustomerSheet>
                )}
              </header>
              <ThreadScroller storeId={store.id} conversationId={conv.id} messageCount={detail.messages.length} lastMessageId={detail.messages.at(-1)?.id ?? null} unread={conv.unreadCount}>
                {detail.messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <p className="font-medium text-ink">Aucun message pour l&apos;instant</p>
                    <p className="mt-1 max-w-[36ch] text-sm text-ink-muted">Écrivez le premier message ci-dessous, ou ajoutez une note interne pour l&apos;équipe.</p>
                  </div>
                ) : (
                  <MessageList messages={detail.messages} storeId={store.id} phone={conv.phone} />
                )}
              </ThreadScroller>
              <Composer
                key={conv.id}
                storeId={store.id}
                conversationId={conv.id}
                phone={conv.phone}
                apiActive={apiActive}
                canReply={ctx.can("orders.manage")}
                quickReplies={quickReplies}
                firstName={(conv.customer?.name ?? conv.name).split(" ")[0] ?? ""}
                storeName={store.name}
              />
              {apiActive && (
                <p className="border-t border-line px-4 py-1.5 text-[11px] text-ink-faint">
                  Solde : <span className="tabular">{balances.WA_UTILITY}</span> message{balances.WA_UTILITY > 1 ? "s" : ""} utilitaire{balances.WA_UTILITY > 1 ? "s" : ""}
                </p>
              )}
            </>
          ) : selectedId ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <p className="font-medium text-ink">Conversation introuvable</p>
              <Link href={qs({ c: null })} className="mt-2 text-sm font-medium text-primary hover:underline">
                Revenir à la liste
              </Link>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center bg-canvas/60 px-6 text-center">
              <span className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-surface text-primary ring-1 ring-line">
                <MessagesSquare className="size-6" aria-hidden />
              </span>
              <p className="font-semibold text-ink">Sélectionnez une conversation</p>
              <p className="mt-1 max-w-[38ch] text-sm text-ink-muted">Le fil, la fiche client et ses commandes s&apos;affichent ici. Tapez / dans le message pour vos réponses rapides.</p>
            </div>
          )}
        </section>

        {/* Fiche client */}
        <aside aria-label="Fiche client" className="hidden min-h-0 overflow-y-auto border-l border-line xl:block">
          {panel ? (
            <CustomerPanel {...panel} />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">La fiche du client s&apos;affiche ici.</div>
          )}
        </aside>
      </div>

      <AutoRefresh />
    </>
  );
}

import type { Metadata } from "next";
import { KanbanSquare, TrendingUp, Trophy, Target } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { PageHeader, EmptyState, Stat } from "@/components/ui/misc";
import { PlanGate } from "@/components/app/plan-gate";
import { PipelineBoard, type PipelineCard } from "@/components/inbox/pipeline-board";
import { NewConversationButton } from "@/components/inbox/inbox-dialogs";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Entonnoir de vente" };

export default async function PipelinePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "orders.view");
  const store = ctx.store;

  if (!PLANS[ctx.planId].features.pipeline) {
    return (
      <>
        <PageHeader title="Entonnoir de vente" description="Suivez chaque discussion, du premier message au paiement." />
        <PlanGate storeId={store.id} feature="pipeline" description="Visualisez vos conversations en colonnes (nouveau, intéressé, commande, payé, perdu), estimez la valeur de chaque discussion et ne laissez plus filer une vente." />
      </>
    );
  }

  const conversations = await db.conversation.findMany({
    where: { storeId: store.id, OR: [{ status: { not: "CLOSED" } }, { stage: { in: ["PAID", "LOST"] } }] },
    orderBy: { lastMessageAt: "desc" },
    take: 400,
    select: { id: true, name: true, stage: true, estimatedValue: true, lastMessageAt: true, lastPreview: true, labels: true, unreadCount: true, assignedTo: { select: { name: true } } },
  });

  const cards: PipelineCard[] = conversations.map((c) => ({
    id: c.id,
    name: c.name,
    stage: c.stage,
    estimatedValue: c.estimatedValue,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastPreview: c.lastPreview,
    labels: c.labels,
    unreadCount: c.unreadCount,
    assignee: c.assignedTo?.name.split(" ")[0] ?? null,
  }));

  const open = cards.filter((c) => c.stage !== "PAID" && c.stage !== "LOST");
  const openValue = open.reduce((s, c) => s + (c.estimatedValue ?? 0), 0);
  const won = cards.filter((c) => c.stage === "PAID").length;
  const lost = cards.filter((c) => c.stage === "LOST").length;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  return (
    <>
      <PageHeader
        title="Entonnoir de vente"
        description="Glissez les cartes d'une colonne à l'autre, ou utilisez les flèches de chaque carte."
        actions={ctx.can("orders.manage") ? <NewConversationButton storeId={store.id} variant="outline" /> : undefined}
      />

      {cards.length === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title="Votre entonnoir est vide"
          description="Chaque conversation WhatsApp devient une carte. Ouvrez une conversation avec un client ou connectez l'API WhatsApp pour que les nouveaux messages arrivent ici automatiquement."
          action={ctx.can("orders.manage") ? <NewConversationButton storeId={store.id} label="Ouvrir une conversation" /> : undefined}
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Discussions en cours" value={open.length} icon={Target} hint="Nouveau, intéressé, commande" />
            <Stat label="Valeur en jeu" value={formatMoney(openValue, store.currency, { compact: openValue >= 1_000_000 })} icon={TrendingUp} hint="Somme des valeurs estimées" />
            <Stat label="Taux de conversion" value={winRate == null ? "-" : `${winRate} %`} icon={Trophy} hint={`${won} payée${won > 1 ? "s" : ""}, ${lost} perdue${lost > 1 ? "s" : ""}`} />
          </div>
          <PipelineBoard storeId={store.id} currency={store.currency} cards={cards} canEdit={ctx.can("orders.manage")} />
        </>
      )}
    </>
  );
}

import type { Metadata } from "next";
import { Radio } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatDateTime } from "@/lib/utils";
import { listLiveEvents } from "@/lib/live/service";
import { liveStatus, STREAM_PLATFORMS } from "@/lib/live/stream";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PlanGate } from "@/components/app/plan-gate";
import { LiveEventForm, LiveEventRow } from "./live-forms";

export const metadata: Metadata = { title: "Direct (live shopping)" };

const TONE: Record<string, BadgeTone> = { scheduled: "info", live: "success", ended: "neutral" };
const LABEL: Record<string, string> = { scheduled: "Programmé", live: "En direct", ended: "Terminé" };

/**
 * Écran marchand du live shopping (lot 4 §18) : programmer un direct, choisir les produits présentés,
 * épingler celui dont on parle, démarrer et terminer. La boutique reprend le produit épinglé en 15 s.
 */
export default async function LivePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "theme.manage");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];

  if (!plan.features.liveShopping) {
    return (
      <>
        <PageHeader title="Direct (live shopping)" description="Vendez en direct depuis WhatsApp, YouTube, Facebook ou TikTok, avec vos produits à côté de la vidéo." />
        <PlanGate storeId={store.id} feature="liveShopping" unlocks={["Compte à rebours sur la boutique", "Produits présentés mis à jour en direct", "Rappel WhatsApp aux clients inscrits", "Section « Direct » dans l'éditeur"]} />
      </>
    );
  }

  const [events, products] = await Promise.all([
    listLiveEvents(store.id),
    db.product.findMany({ where: { storeId: store.id, status: "ACTIVE" }, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take: 100, select: { id: true, name: true } }),
  ]);
  const now = new Date();
  const upcoming = events.filter((e) => liveStatus(e, now) !== "ended");
  const past = events.filter((e) => liveStatus(e, now) === "ended");

  return (
    <>
      <PageHeader
        title="Direct (live shopping)"
        description="Programmez un direct, listez les produits que vous présenterez, puis épinglez celui dont vous parlez : la boutique suit en quinze secondes."
      />

      {products.length === 0 && (
        <Alert tone="info" className="mb-6" title="Aucun produit actif">
          Ajoutez d&apos;abord des produits : ils seront proposés à côté de la vidéo pendant le direct.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <Card>
          <CardHeader title="Programmer un direct" description={`Lien de diffusion accepté : ${STREAM_PLATFORMS.join(", ")}.`} />
          <CardBody>
            <LiveEventForm storeId={store.id} products={products} />
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="À venir et en cours" />
            <CardBody>
              {upcoming.length === 0 ? (
                <EmptyState icon={Radio} title="Aucun direct programmé" description="Le premier direct apparaîtra ici, et sur votre boutique si la section « Direct » est ajoutée à l'accueil." />
              ) : (
                <ul className="space-y-4">
                  {upcoming.map((e) => (
                    <li key={e.id}>
                      <LiveEventRow
                        storeId={store.id}
                        event={{ id: e.id, title: e.title, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null, streamUrl: e.streamUrl, productIds: e.productIds, pinnedId: e.pinnedId, status: e.status }}
                        statusLabel={LABEL[liveStatus(e, now)]}
                        statusTone={TONE[liveStatus(e, now)]}
                        when={formatDateTime(e.startsAt)}
                        products={products}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {past.length > 0 && (
            <Card>
              <CardHeader title="Terminés" description="Conservés pour mémoire ; ils ne s'affichent plus sur la boutique." />
              <CardBody>
                <ul className="divide-y divide-line text-sm">
                  {past.slice(0, 10).map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <span className="font-medium text-ink">{e.title}</span>
                      <span className="flex items-center gap-3 text-ink-muted">
                        {formatDateTime(e.startsAt)}
                        <Badge tone="neutral">{LABEL.ended}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { claimTotals, expiryAlert, listLiveClaims, sweepLiveClaims } from "@/lib/live/claims";
import { liveStatus } from "@/lib/live/stream";
import { DEFAULT_CLAIM_MESSAGE, DEFAULT_PUBLIC_REPLY } from "@/lib/live/claim-message";
import { PageHeader, Alert, Stat } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PlanGate } from "@/components/app/plan-gate";
import { ClaimsBoard } from "./claims-board";
import { ClaimSettingsForm, KeywordsEditor, SocialLink } from "./claim-settings";

export const metadata: Metadata = { title: "Réservations du direct" };

/**
 * Tableau de bord « commenter pour acheter » d'un direct : réservations en temps réel (rafraîchies toutes les
 * 5 secondes pendant le direct), totaux, relance / annulation / export, réglages, mots-clés et liaison à la vidéo
 * en direct Facebook / Instagram.
 */
export default async function LiveClaimsPage({ params }: { params: Promise<{ storeId: string; eventId: string }> }) {
  const { storeId, eventId } = await params;
  const ctx = await getStoreContext(storeId, "theme.manage");
  const store = ctx.store;
  if (!PLANS[ctx.planId].features.liveShopping) {
    return (
      <>
        <PageHeader title="Réservations du direct" back={{ href: `/app/${store.id}/live`, label: "Direct" }} />
        <PlanGate storeId={store.id} feature="liveShopping" unlocks={["Réservation par commentaire Facebook et Instagram", "Lien de paiement en message privé", "Tableau des réservations en direct"]} />
      </>
    );
  }
  const event = await db.liveEvent.findFirst({ where: { id: eventId, storeId: store.id } });
  if (!event) notFound();

  // Expirations et paiements à jour avant affichage (borné, idempotent).
  await sweepLiveClaims({ storeId: store.id, limit: 200 });

  const [claims, keywords, products, accounts] = await Promise.all([
    listLiveClaims(store.id, event.id),
    db.liveKeyword.findMany({ where: { storeId: store.id, liveEventId: event.id }, orderBy: { code: "asc" }, select: { code: true, productId: true, variantId: true } }),
    db.product.findMany({
      where: { storeId: store.id, status: "ACTIVE", isGiftCard: false },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: { id: true, name: true, variants: { where: { available: true }, orderBy: { position: "asc" }, select: { id: true, name: true } } },
    }),
    db.socialAccount.count({ where: { storeId: store.id, status: "active" } }),
  ]);
  const totals = claimTotals(claims);
  const abnormalExpiry = expiryAlert({
    expired: claims.filter((c) => c.status === "EXPIRED").length,
    paid: claims.filter((c) => c.status === "PAID").length,
    ordered: claims.filter((c) => c.ordered && c.status !== "PAID").length,
  });
  const status = liveStatus(event, new Date());
  const isLive = status === "live";

  return (
    <>
      <PageHeader
        title={`Réservations : ${event.title}`}
        description={`${formatDateTime(event.startsAt)} · ${isLive ? "en direct" : status === "scheduled" ? "programmé" : "terminé"}`}
        back={{ href: `/app/${store.id}/live`, label: "Direct" }}
      />

      {!event.claimsEnabled && (
        <Alert tone="info" className="mb-6" title="Réservations par commentaire désactivées">
          Activez-les dans les réglages ci-dessous, ajoutez vos mots-clés, puis lancez le direct.
        </Alert>
      )}
      {event.claimsEnabled && accounts === 0 && (
        <Alert tone="warning" className="mb-6" title="Aucune Page connectée">
          Connectez votre Page Facebook / Instagram depuis l&apos;écran Direct pour recevoir les commentaires.
        </Alert>
      )}

      {abnormalExpiry && (
        <Alert tone="warning" className="mb-6" title="Beaucoup de réservations expirent sans paiement">
          Plus de la moitié des réservations closes ont expiré : des comptes bloquent peut-être votre stock. Réduisez le délai de paiement, le plafond par
          client ou le plafond de réservations en attente, et annulez les réservations suspectes.
        </Alert>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="En attente de paiement" value={totals.reserved} hint={formatMoney(totals.pendingAmount, store.currency)} />
        <Stat label="Payées" value={totals.paid} hint={formatMoney(totals.paidAmount, store.currency)} />
        <Stat label="Expirées ou annulées" value={totals.closed} />
        <Stat label="Mots-clés" value={keywords.length} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr] xl:items-start">
        <Card>
          <CardHeader title="Réservations" description={isLive ? "Mise à jour automatique toutes les 5 secondes." : undefined} />
          <CardBody>
            <ClaimsBoard
              storeId={store.id}
              eventId={event.id}
              live={isLive}
              rows={claims.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), expiresAt: c.expiresAt.toISOString() }))}
            />
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Mots-clés" description="Le spectateur commente le code (« JP 12 », « 12 x2 ») pour réserver le produit associé." />
            <CardBody>
              <KeywordsEditor storeId={store.id} eventId={event.id} initial={keywords} products={products} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Vidéo en direct" description="Facultatif : limitez les réservations aux commentaires de votre direct Facebook / Instagram." />
            <CardBody>
              <SocialLink storeId={store.id} eventId={event.id} linked={event.socialObjectIds.length} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Réglages" />
            <CardBody>
              <ClaimSettingsForm
                storeId={store.id}
                event={{
                  id: event.id,
                  claimsEnabled: event.claimsEnabled,
                  claimHoldMinutes: event.claimHoldMinutes,
                  claimMaxPerAuthor: event.claimMaxPerAuthor,
                  claimActiveCapUnits: event.claimActiveCapUnits,
                  claimActiveCapPercent: event.claimActiveCapPercent,
                  claimMessage: event.claimMessage ?? "",
                  claimPublicReply: event.claimPublicReply,
                  claimPublicText: event.claimPublicText ?? "",
                }}
                defaults={{ message: DEFAULT_CLAIM_MESSAGE, publicText: DEFAULT_PUBLIC_REPLY }}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

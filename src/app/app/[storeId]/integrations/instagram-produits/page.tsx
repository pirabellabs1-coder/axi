import type { Metadata } from "next";
import Link from "next/link";
import { Camera } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatDateTime } from "@/lib/utils";
import { GRAPH_VERSION } from "@/lib/social/graph-client";
import { INSTAGRAM_KIND, InstagramApiError, MAX_TAGS_PER_POST, instagramApi, instagramTaggingEnabled, isTaggableMedia, type IgMedia } from "@/lib/social/instagram-tagging";
import { whatsappGraph } from "@/lib/social/sync";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanGate } from "@/components/app/plan-gate";
import { InstagramAccountForm, TagMediaForm } from "./instagram-forms";

export const metadata: Metadata = { title: "Produits sur Instagram" };

const KIND_LABEL: Record<string, string> = { IMAGE: "Photo", VIDEO: "Vidéo", CAROUSEL_ALBUM: "Carrousel", REELS: "Reel" };

export default async function InstagramProductsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const canManage = ctx.can("integrations.manage");
  const enabled = instagramTaggingEnabled();

  const header = (
    <PageHeader
      title="Produits sur Instagram"
      description="Identifiez les produits de votre catalogue sur vos publications et Reels Instagram : vos clients touchent le produit et arrivent sur votre boutique."
    />
  );
  const prerequisites = (
    <Card className="mb-8">
      <CardHeader title="Prérequis Meta" description="Imposés par Meta, ils ne dépendent pas d'Axi." />
      <CardBody>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink">
          <li>Un compte Instagram <strong>professionnel</strong> (pas Créateur) relié à votre Page Facebook.</li>
          <li>
            Votre catalogue Meta alimenté par Axi (flux Meta ou{" "}
            <Link href={`/app/${store.id}/integrations/whatsapp-catalogue`} className="font-medium text-primary underline-offset-4 hover:underline">
              synchronisation
            </Link>
            ).
          </li>
          <li>
            Une <strong>Boutique Instagram approuvée</strong> dans Commerce Manager. Depuis août 2023, Meta réserve l&apos;identification de produits aux boutiques
            avec paiement intégré dans la plupart des pays : hors de ces pays, le compte reste « non éligible ».
          </li>
          <li>Le jeton de votre connexion WhatsApp officielle doit aussi avoir les permissions instagram_basic, instagram_shopping_tag_products et catalog_management.</li>
        </ol>
        <p className="mt-3 text-xs text-ink-muted">Limites Meta : Stories et directs non identifiables ; 25 publications identifiées par 24 h.</p>
      </CardBody>
    </Card>
  );

  if (!enabled) {
    return (
      <>
        {header}
        <Alert tone="info" className="mb-6" title="Fonction pas encore ouverte">
          L&apos;identification de produits Instagram n&apos;est pas encore activée sur la plateforme. Vos produits peuvent déjà apparaître sur Instagram via le
          catalogue Meta.
        </Alert>
        {prerequisites}
      </>
    );
  }
  if (!plan.features.catalogSync) {
    return (
      <>
        {header}
        <PlanGate storeId={store.id} feature="catalogSync" description="Identifiez vos produits sur vos publications Instagram, à partir du catalogue Meta tenu à jour par Axi." unlocks={["Catalogue Meta synchronisé", "Produits identifiés sur Instagram"]} />
      </>
    );
  }

  const [integration, graph, products] = await Promise.all([
    db.integration.findUnique({ where: { storeId_kind: { storeId: store.id, kind: INSTAGRAM_KIND } }, select: { status: true, config: true, lastError: true, updatedAt: true } }),
    whatsappGraph(store.id),
    db.product.findMany({ where: { storeId: store.id, status: "ACTIVE", isGiftCard: false }, select: { id: true, name: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 200 }),
  ]);
  const config = (integration?.config ?? {}) as { igUserId?: string; catalogId?: string | null; checkedAt?: string };
  const active = integration?.status === "active" && !!config.igUserId && !!config.catalogId;

  let media: IgMedia[] = [];
  let mediaError: string | null = null;
  if (active && !("error" in graph)) {
    try {
      media = (await instagramApi(graph.token, GRAPH_VERSION).recentMedia(config.igUserId!, 24)).filter(isTaggableMedia);
    } catch (e) {
      mediaError = e instanceof InstagramApiError ? e.message : "Publications Instagram indisponibles pour le moment.";
    }
  }

  return (
    <>
      {header}
      {!canManage && (
        <Alert tone="info" className="mb-6">
          Seul le propriétaire de la boutique peut modifier ces réglages.
        </Alert>
      )}
      {"error" in graph && (
        <Alert tone="warning" className="mb-6" title="Connexion Meta requise">
          {graph.error}
        </Alert>
      )}

      <div className="mb-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Compte Instagram" description="Axi vérifie auprès de Meta que le compte peut identifier des produits." />
          <CardBody>
            <InstagramAccountForm storeId={store.id} igUserId={config.igUserId ?? ""} disabled={!canManage || "error" in graph} />
          </CardBody>
        </Card>
        <Card as="section" aria-label="État">
          <CardBody className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-ink">
              <Camera className="size-4" aria-hidden /> État{" "}
              {integration ? <Badge tone={active ? "success" : "danger"} dot>{active ? "Éligible" : "Non éligible"}</Badge> : <Badge tone="neutral">Non configuré</Badge>}
            </p>
            {integration?.lastError && <p className="text-ink-muted">{integration.lastError}</p>}
            {config.checkedAt && <p className="text-ink-muted">Vérifié le {formatDateTime(new Date(config.checkedAt))}</p>}
            {config.catalogId && <p className="font-mono text-xs text-ink-muted">Catalogue {config.catalogId}</p>}
          </CardBody>
        </Card>
      </div>

      {active && (
        <section className="mb-10" aria-labelledby="tag-title">
          <h2 id="tag-title" className="mb-4 text-lg font-semibold tracking-[-0.02em] text-ink">Identifier des produits</h2>
          {mediaError ? (
            <Alert tone="danger">{mediaError}</Alert>
          ) : media.length === 0 || products.length === 0 ? (
            <EmptyState icon={Camera} title={media.length === 0 ? "Aucune publication identifiable" : "Aucun produit actif"} description="Publiez une photo, un carrousel ou un Reel sur Instagram, puis revenez ici." />
          ) : (
            <Card>
              <CardBody>
                <TagMediaForm
                  storeId={store.id}
                  media={media.map((m) => ({ id: m.id, caption: m.caption, thumbnail: m.thumbnail, permalink: m.permalink, kind: m.productType === "REELS" ? "Reel" : (KIND_LABEL[m.mediaType] ?? m.mediaType) }))}
                  products={products}
                  max={MAX_TAGS_PER_POST}
                  disabled={!canManage}
                />
              </CardBody>
            </Card>
          )}
        </section>
      )}

      {prerequisites}
    </>
  );
}

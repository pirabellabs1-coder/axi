import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, PackageCheck, PackageX, Rss, ShoppingBag } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { setCatalogFeed } from "@/lib/social/actions";
import { getCatalogStatus, appBaseUrl, type FeedChannel } from "@/lib/social/sync";
import { loadCatalogSource } from "@/lib/social/catalog-data";
import { buildCatalogItems } from "@/lib/social/feed-items";
import { PageHeader, Kpi, EmptyState, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ButtonLink } from "@/components/ui/button";
import { AsyncSwitch } from "@/components/app/action-controls";
import { PlanGate } from "@/components/app/plan-gate";
import { CatalogOptionsForm, CatalogSyncForm, FeedUrl, SyncNowButton } from "./catalog-forms";

export const metadata: Metadata = { title: "Catalogue WhatsApp et flux" };

const FEEDS: Record<FeedChannel, { name: string; where: string }> = {
  meta: { name: "Meta (WhatsApp, Facebook, Instagram)", where: "Commerce Manager, Catalogue, Sources de données, Flux de données programmé" },
  google: { name: "Google Merchant Center", where: "Merchant Center, Produits, Sources de données, Fichier récupéré à heure fixe" },
  tiktok: { name: "TikTok Catalog", where: "TikTok Ads Manager, Catalogues, Ajouter des produits, Flux de données (CSV)" },
};

const SYNC_TONE: Record<string, BadgeTone> = { idle: "neutral", syncing: "info", ok: "success", error: "danger" };
const SYNC_LABEL: Record<string, string> = { idle: "En attente", syncing: "Synchronisation en cours", ok: "À jour", error: "Erreur" };

const nf = (n: number) => n.toLocaleString("fr-FR");

export default async function WhatsappCataloguePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const plan = PLANS[ctx.planId];
  const canManage = ctx.can("integrations.manage");
  const hasFeeds = plan.features.catalogFeeds;
  const hasSync = plan.features.catalogSync;

  const [status, source, integration] = await Promise.all([
    getCatalogStatus(store),
    loadCatalogSource(store.id),
    db.integration.findUnique({ where: { storeId_kind: { storeId: store.id, kind: "whatsapp_cloud" } }, select: { status: true } }),
  ]);
  const built = buildCatalogItems({ store, products: source.products, categories: source.categories, settings: status.settings, baseUrl: appBaseUrl() });
  const names = new Map(source.products.map((p) => [p.id, p.name]));
  const published = store.status === "PUBLISHED" || store.status === "CLOSED_TEMPORARILY";
  const waStatus = integration?.status ?? null;
  const sync = status.sync;

  return (
    <>
      <PageHeader
        title="Catalogue WhatsApp et flux"
        description="Axi devient la source de votre catalogue sur WhatsApp, Facebook, Instagram, Google et TikTok. Les paniers envoyés depuis WhatsApp reviennent dans votre boutique."
      />

      {!published && (
        <Alert tone="warning" className="mb-6" title="Boutique non publiée">
          Les flux et la synchronisation ne fonctionnent qu&apos;une fois la boutique publiée.
        </Alert>
      )}
      {!canManage && (
        <Alert tone="info" className="mb-6">
          Seul le propriétaire de la boutique peut modifier ces réglages.
        </Alert>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Articles publiables" value={nf(built.items.length)} hint="Variantes comprises" icon={ShoppingBag} />
        <Kpi label="Articles exclus" value={nf(built.skipped.length)} hint={built.skipped.length ? "Photo ou prix manquant" : "Aucun"} icon={PackageX} />
        <Kpi label="Sur WhatsApp" value={nf(status.items.synced)} hint={sync.lastSuccessAt ? `Synchronisé ${relativeTime(sync.lastSuccessAt)}` : "Jamais synchronisé"} icon={PackageCheck} />
        <Kpi label="Refusés par Meta" value={nf(status.items.error)} hint={status.items.error ? "Détail ci-dessous" : "Aucun"} icon={AlertTriangle} />
      </div>

      {/* Flux publics */}
      <section className="mb-10" aria-labelledby="feeds-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="feeds-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Flux catalogues</h2>
          <p className="text-sm text-ink-muted">Mis à jour toutes les heures, sans action de votre part.</p>
        </div>
        {!hasFeeds ? (
          <PlanGate
            storeId={store.id}
            feature="catalogFeeds"
            description="Publiez votre catalogue sur WhatsApp, Facebook, Instagram, Google et TikTok à partir d'une simple adresse, mise à jour automatiquement."
            unlocks={["Catalogue WhatsApp alimenté par Axi", "Produits sur Facebook et Instagram Shopping", "Google Shopping gratuit", "Catalogue TikTok"]}
          />
        ) : (
          <Card>
            <CardBody className="divide-y divide-line">
              {status.feeds.map((f) => (
                <div key={f.channel} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium text-ink">
                        <Rss className="size-4 text-primary" aria-hidden /> {FEEDS[f.channel].name}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-muted">À coller dans : {FEEDS[f.channel].where}.</p>
                    </div>
                    <AsyncSwitch checked={f.enabled} label={f.enabled ? "Activé" : "Désactivé"} action={setCatalogFeed.bind(null, store.id, f.channel)} disabled={!canManage} />
                  </div>
                  {f.enabled && <FeedUrl url={f.url} label={`Adresse du flux ${FEEDS[f.channel].name}`} />}
                </div>
              ))}
            </CardBody>
          </Card>
        )}
      </section>

      {/* Synchronisation API */}
      <section className="mb-10" aria-labelledby="sync-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="sync-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Synchronisation avec le catalogue WhatsApp</h2>
            {hasSync && sync.configured && (
              <Badge tone={SYNC_TONE[sync.status] ?? "neutral"} dot>
                {sync.enabled ? (SYNC_LABEL[sync.status] ?? sync.status) : "Désactivée"}
              </Badge>
            )}
          </div>
          <p className="text-sm text-ink-muted">Par l&apos;API Meta, via votre connexion WhatsApp officielle.</p>
        </div>

        {!hasSync ? (
          <PlanGate
            storeId={store.id}
            feature="catalogSync"
            description="Envoyez votre catalogue directement dans WhatsApp : l'agent IA de Meta recommande vos produits et les paniers reviennent dans Axi."
            unlocks={["Catalogue WhatsApp toujours à jour", "Erreurs de Meta visibles article par article", "Paniers WhatsApp transformés en liens de commande Axi"]}
          />
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <CardHeader title="Réglages" description="Le catalogue doit être relié à votre numéro WhatsApp Business dans le Gestionnaire WhatsApp." />
              <CardBody>
                {!waStatus && (
                  <Alert tone="warning" className="mb-4" title="API WhatsApp non connectée">
                    Connectez d&apos;abord votre numéro depuis la{" "}
                    <Link href={`/app/${store.id}/whatsapp`} className="font-medium text-primary underline-offset-4 hover:underline">
                      page WhatsApp
                    </Link>
                    .
                  </Alert>
                )}
                {waStatus === "pending" && (
                  <Alert tone="info" className="mb-4">
                    Votre connexion WhatsApp attend la validation de la plateforme : la synchronisation démarrera ensuite.
                  </Alert>
                )}
                {sync.lastError && (
                  <Alert tone="danger" className="mb-4" title="Dernière synchronisation">
                    {sync.lastError}
                  </Alert>
                )}
                <CatalogSyncForm storeId={store.id} catalogId={sync.externalCatalogId ?? ""} enabled={sync.enabled} disabled={!canManage} />
              </CardBody>
            </Card>

            <Card as="section" aria-label="État de la synchronisation">
              <CardBody>
                <dl className="divide-y divide-line rounded-[var(--radius-md)] ring-1 ring-line">
                  <Row label="Dernière synchronisation" value={sync.lastSyncAt ? formatDateTime(sync.lastSyncAt) : "Jamais"} />
                  <Row label="Dernier succès" value={sync.lastSuccessAt ? formatDateTime(sync.lastSuccessAt) : "Jamais"} />
                  <Row label="Prochaine" value={sync.enabled && sync.nextSyncAt ? formatDateTime(sync.nextSyncAt) : "Non planifiée"} />
                  <Row label="Articles envoyés" value={nf(sync.itemCount)} />
                  {sync.consecutiveFailures > 0 && <Row label="Échecs consécutifs" value={nf(sync.consecutiveFailures)} />}
                </dl>
                <div className="mt-4">
                  <SyncNowButton storeId={store.id} disabled={!canManage || !sync.enabled || !sync.externalCatalogId} />
                </div>
                <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
                  <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Seuls les articles modifiés sont renvoyés. « Synchroniser maintenant » renvoie aussi les articles refusés.
                </p>
              </CardBody>
            </Card>
          </div>
        )}
      </section>

      {(hasFeeds || hasSync) && (
        <section className="mb-10" aria-labelledby="options-title">
          <h2 id="options-title" className="mb-4 text-lg font-semibold tracking-[-0.02em] text-ink">Options du catalogue</h2>
          <Card>
            <CardBody>
              <CatalogOptionsForm storeId={store.id} brand={status.settings.brand ?? ""} includeOutOfStock={status.settings.includeOutOfStock} storeName={store.name} disabled={!canManage} />
            </CardBody>
          </Card>
        </section>
      )}

      {hasSync && sync.configured && (
        <section className="mb-10" aria-labelledby="errors-title">
          <h2 id="errors-title" className="mb-4 text-lg font-semibold tracking-[-0.02em] text-ink">Articles refusés par Meta</h2>
          {status.errors.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Aucun article refusé" description="Les refus de Meta (photo trop petite, prix invalide…) apparaîtront ici, article par article." />
          ) : (
            <Table minWidth={640}>
              <THead>
                <tr>
                  <TH>Article</TH>
                  <TH>Motif</TH>
                  <TH>Date</TH>
                </tr>
              </THead>
              <TBody>
                {status.errors.map((e) => (
                  <TR key={e.retailerId}>
                    <TD>
                      <Link href={`/app/${store.id}/produits/${e.productId}`} className="font-medium text-ink underline-offset-4 hover:underline">
                        {names.get(e.productId) ?? "Produit supprimé"}
                      </Link>
                      <span className="block font-mono text-xs text-ink-muted">{e.retailerId}</span>
                    </TD>
                    <TD className="max-w-[360px] text-ink-muted">{e.error ?? "Refusé"}</TD>
                    <TD className="whitespace-nowrap tabular text-ink-muted">{formatDateTime(e.updatedAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>
      )}

      {(hasFeeds || hasSync) && built.skipped.length > 0 && (
        <section className="mb-10" aria-labelledby="skipped-title">
          <h2 id="skipped-title" className="mb-4 text-lg font-semibold tracking-[-0.02em] text-ink">Articles exclus des catalogues</h2>
          <Table minWidth={560}>
            <THead>
              <tr>
                <TH>Article</TH>
                <TH>À corriger</TH>
              </tr>
            </THead>
            <TBody>
              {built.skipped.slice(0, 100).map((s) => (
                <TR key={s.id}>
                  <TD>
                    <Link href={`/app/${store.id}/produits/${s.productId}`} className="font-medium text-ink underline-offset-4 hover:underline">
                      {s.title}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted">{s.reason}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      <section aria-labelledby="guide-title">
        <h2 id="guide-title" className="mb-4 text-lg font-semibold tracking-[-0.02em] text-ink">Guide pas à pas</h2>
        <Card>
          <CardBody>
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-ink">
              <li>
                <strong>Flux Meta.</strong> Activez le flux Meta ci-dessus et copiez son adresse. Dans Commerce Manager, créez un catalogue « E-commerce », puis Sources de données, Flux de données, « Flux programmé » : collez l&apos;adresse et choisissez une mise à jour toutes les heures.
              </li>
              <li>
                <strong>Relier le catalogue à WhatsApp.</strong> Dans le Gestionnaire WhatsApp, Outils du compte, Catalogue : choisissez ce catalogue pour votre numéro. Les clients le voient dans votre profil WhatsApp et l&apos;agent IA de Meta peut recommander vos produits.
              </li>
              <li>
                <strong>Synchronisation directe (facultatif, plus rapide).</strong> Connectez l&apos;API WhatsApp officielle, puis saisissez l&apos;identifiant du catalogue ci-dessus. Le jeton doit avoir la permission « catalog_management ». Utilisez soit le flux, soit la synchronisation pour un même catalogue, pas les deux.
              </li>
              <li>
                <strong>Commandes.</strong> Quand un client envoie un panier depuis WhatsApp, Axi lui répond avec un lien vers votre boutique pour choisir la livraison et payer. La conversation apparaît dans{" "}
                <Link href={`/app/${store.id}/conversations`} className="font-medium text-primary underline-offset-4 hover:underline">
                  Conversations
                </Link>
                .
              </li>
              <li>
                <strong>Google et TikTok.</strong> Activez leur flux et collez l&apos;adresse dans Merchant Center ou TikTok Ads Manager. Renseignez-y aussi vos frais de livraison.
              </li>
            </ol>
            <div className="mt-5 flex flex-wrap gap-2">
              <ButtonLink href={`/app/${store.id}/produits`} variant="outline" size="md">
                Compléter mes fiches produits
              </ButtonLink>
              <ButtonLink href={`/app/${store.id}/whatsapp`} variant="ghost" size="md">
                Connexion WhatsApp
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard, PackageCheck, ShoppingBag, Store as StoreIcon } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { isConfigured, isFakeMode } from "@/lib/tiktok-shop/config";
import { loadIntegration } from "@/lib/tiktok-shop/connection";
import { isCountryCovered, marketFor, marketNames } from "@/lib/tiktok-shop/markets";
import { STATUS_LABELS } from "@/lib/tiktok-shop/model";
import { getCountry } from "@/config/site";
import { PageHeader, Kpi, EmptyState, Alert, KeyValue } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ButtonLink } from "@/components/ui/button";
import { DisconnectButton, PublishButton, SelectShopForm, SettingsForm, SyncNowButton } from "./tiktok-forms";

export const metadata: Metadata = { title: "TikTok Shop" };

const TONE: Record<string, BadgeTone> = { draft: "neutral", publishing: "info", PENDING: "warning", FAILED: "danger", ACTIVATE: "success", error: "danger", SELLER_DEACTIVATED: "neutral", PLATFORM_DEACTIVATED: "danger", FREEZE: "danger", DELETED: "neutral" };

const ERRORS: Record<string, string> = {
  config: "L'intégration TikTok Shop n'est pas encore activée sur Axi. Elle sera disponible dès que la plateforme aura reçu son agrément de partenaire TikTok Shop.",
  market: "Aucune boutique TikTok Shop d'un marché ouvert n'est rattachée à ce compte TikTok.",
  exchange: "TikTok n'a pas validé l'autorisation. Recommencez ; si le problème persiste, contactez le support.",
  denied: "Autorisation annulée dans TikTok.",
};

export default async function TiktokShopPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const canConnect = ctx.can("integrations.manage");
  const canProducts = ctx.can("products.manage");
  const configured = isConfigured();
  const covered = isCountryCovered(store.country);
  const current = await loadIntegration(store.id);
  const connected = !!current && current.row.status !== "inactive";
  const config = current?.config;
  const shop = connected ? config?.shop : null;
  const market = shop ? marketFor(shop.region) : null;

  const products = shop
    ? await db.product.findMany({
        where: { storeId: store.id, status: "ACTIVE", kind: "PHYSICAL", isGiftCard: false },
        select: { id: true, name: true, price: true, _count: { select: { variants: true } } },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }],
        take: 300,
      })
    : [];
  const links = config?.products ?? {};
  const published = Object.values(links).filter((l) => l.tiktokProductId).length;
  const live = Object.values(links).filter((l) => l.status === "ACTIVATE").length;
  const imported = await db.order.count({ where: { storeId: store.id, idempotencyKey: { startsWith: "tiktok_shop:" } } });

  return (
    <>
      <PageHeader
        title="TikTok Shop"
        description="Vendez dans vos vidéos et vos lives TikTok : l'acheteur paie sans quitter TikTok, la commande arrive dans Axi avec un stock commun."
        actions={shop && canConnect ? <SyncNowButton storeId={store.id} /> : undefined}
      />

      {isFakeMode() && (
        <Alert tone="info" className="mb-6" title="Mode simulé">
          TIKTOK_SHOP_FAKE=1 : aucune donnée n&apos;est envoyée à TikTok (développement et recette uniquement).
        </Alert>
      )}
      {sp.error && ERRORS[sp.error] && (
        <Alert tone="danger" className="mb-6" title="Connexion impossible">
          {ERRORS[sp.error]}
        </Alert>
      )}
      {sp.connected === "1" && (
        <Alert tone="success" className="mb-6" title="TikTok Shop connecté">
          Choisissez maintenant une catégorie TikTok pour chaque produit à publier.
        </Alert>
      )}
      {!configured && (
        <Alert tone="warning" className="mb-6" title="Bientôt disponible">
          {ERRORS.config}
        </Alert>
      )}
      {!covered && (
        <Alert tone="warning" className="mb-6" title={`TikTok Shop n'est pas ouvert dans votre pays (${getCountry(store.country).name})`}>
          TikTok Shop accepte uniquement des vendeurs enregistrés dans : {marketNames()}. Vous pouvez connecter une boutique TikTok Shop ouverte par
          votre société dans l&apos;un de ces pays ; les prix y sont affichés dans la devise du marché, convertis depuis votre devise ({store.currency}).
        </Alert>
      )}
      {connected && current?.row.lastError && (
        <Alert tone={current.row.status === "error" ? "danger" : "warning"} className="mb-6" title="À vérifier">
          {current.row.lastError}
        </Alert>
      )}

      {!connected ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={Clapperboard}
              title="Connectez votre boutique TikTok Shop"
              description="Vous serez redirigé vers TikTok pour autoriser Axi à publier vos produits, recevoir vos commandes et transmettre vos expéditions."
              action={
                canConnect && configured ? (
                  <ButtonLink href={`/api/tiktok-shop/connect?storeId=${store.id}`} prefetch={false} className="min-h-11">
                    Connecter TikTok Shop
                  </ButtonLink>
                ) : !canConnect ? (
                  <p className="text-sm text-ink-muted">Seul le propriétaire de la boutique peut connecter TikTok Shop.</p>
                ) : undefined
              }
            />
          </CardBody>
        </Card>
      ) : !shop ? (
        <Card>
          <CardHeader title="Choisissez votre boutique TikTok" description="Plusieurs boutiques TikTok Shop sont rattachées à ce compte." />
          <CardBody>
            {config && config.shops.length > 0 && canConnect ? (
              <SelectShopForm storeId={store.id} shops={config.shops.map((s) => ({ id: s.id, label: `${s.name} (${marketFor(s.region)?.name ?? s.region})` }))} />
            ) : (
              <p className="text-sm text-ink-muted">Aucune boutique utilisable. Reconnectez TikTok Shop avec le compte vendeur adéquat.</p>
            )}
            {canConnect && (
              <div className="mt-4 flex flex-wrap gap-3">
                <ButtonLink href={`/api/tiktok-shop/connect?storeId=${store.id}`} prefetch={false} variant="outline" className="min-h-11">
                  Reconnecter
                </ButtonLink>
                <DisconnectButton storeId={store.id} />
              </div>
            )}
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Boutique TikTok" value={shop.name || shop.id} hint={market ? `${market.name}, ${market.currency}` : shop.region} icon={StoreIcon} />
            <Kpi label="Produits publiés" value={String(published)} hint={`${live} en ligne`} icon={PackageCheck} />
            <Kpi label="Commandes importées" value={String(imported)} hint={config?.orders.lastImportAt ? `Dernière ${relativeTime(new Date(config.orders.lastImportAt))}` : "Aucune pour l'instant"} icon={ShoppingBag} />
            <Kpi label="Dernière synchro" value={config?.orders.lastPullAt ? relativeTime(new Date(config.orders.lastPullAt)) : "Jamais"} hint={config?.settings.enabled ? "Automatique" : "Désactivée"} icon={Clapperboard} />
          </div>

          <section className="mb-10" aria-labelledby="tts-products">
            <h2 id="tts-products" className="mb-4 text-lg font-semibold tracking-[-0.02em] text-ink">
              Produits sur TikTok
            </h2>
            {products.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="Aucun produit physique actif" description="Seuls les produits physiques actifs avec photo peuvent être vendus sur TikTok Shop." />
            ) : (
              <Table minWidth={720}>
                <THead>
                  <TR>
                    <TH>Produit</TH>
                    <TH>Catégorie TikTok</TH>
                    <TH>État TikTok</TH>
                    <TH>Dernier envoi</TH>
                    <TH align="right">Action</TH>
                  </TR>
                </THead>
                <TBody>
                  {products.map((p) => {
                    const l = links[p.id];
                    const status = l?.status ?? "none";
                    return (
                      <TR key={p.id}>
                        <TD>
                          <Link href={`/app/${store.id}/integrations/tiktok-shop/produits/${p.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                            {p.name}
                          </Link>
                          {p._count.variants > 0 && <span className="block text-xs text-ink-muted">{p._count.variants} variante(s)</span>}
                        </TD>
                        <TD>{l ? <span className="text-sm">{l.categoryName}</span> : <span className="text-sm text-ink-muted">Non choisie</span>}</TD>
                        <TD>
                          {l ? (
                            <>
                              <Badge tone={TONE[status] ?? "neutral"}>{STATUS_LABELS[status] ?? status}</Badge>
                              {(l.lastError || l.reviewReasons.length > 0) && <span className="mt-1 block max-w-xs text-xs text-danger">{l.lastError ?? l.reviewReasons.join(" ; ")}</span>}
                            </>
                          ) : (
                            <span className="text-sm text-ink-muted">Non relié</span>
                          )}
                        </TD>
                        <TD>{l?.lastSyncedAt ? <span className="text-sm">{formatDateTime(new Date(l.lastSyncedAt))}</span> : <span className="text-sm text-ink-muted">-</span>}</TD>
                        <TD align="right">
                          {!l ? (
                            <ButtonLink href={`/app/${store.id}/integrations/tiktok-shop/produits/${p.id}`} size="sm" variant="outline" className="min-h-11">
                              Configurer
                            </ButtonLink>
                          ) : (
                            <PublishButton storeId={store.id} productId={p.id} label={l.tiktokProductId ? "Mettre à jour" : "Publier"} disabled={!canProducts} />
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
            <p className="mt-3 text-sm text-ink-muted">
              Une fois en ligne, épinglez vos produits dans vos vidéos et pendant vos lives depuis l&apos;application TikTok (vitrine du créateur).
            </p>
          </section>

          <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <CardHeader title="Réglages" description="Prix, colis et synchronisation." />
              <CardBody>
                <SettingsForm
                  storeId={store.id}
                  disabled={!canConnect}
                  values={{
                    markupPercent: (config?.settings.markupBps ?? 0) / 100,
                    defaultWeightGrams: config?.settings.defaultWeightGrams ?? 500,
                    lengthCm: config?.settings.lengthCm ?? 20,
                    widthCm: config?.settings.widthCm ?? 15,
                    heightCm: config?.settings.heightCm ?? 10,
                    untrackedQuantity: config?.settings.untrackedQuantity ?? 50,
                    enabled: config?.settings.enabled ?? true,
                  }}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Connexion" />
              <CardBody>
                <KeyValue
                  items={[
                    { label: "Vendeur", value: config?.tokens.sellerName ?? "-" },
                    { label: "Marché", value: market ? `${market.name} (${market.currency})` : shop.region },
                    { label: "Devise Axi", value: store.currency },
                    { label: "Connecté", value: config?.connectedAt ? formatDateTime(new Date(config.connectedAt)) : "-" },
                    { label: "Autorisation valable jusqu'au", value: config?.tokens.refreshExpiresAt ? formatDateTime(new Date(config.tokens.refreshExpiresAt)) : "-" },
                  ]}
                />
                {canConnect && (
                  <div className="mt-5 flex flex-wrap gap-3">
                    <ButtonLink href={`/api/tiktok-shop/connect?storeId=${store.id}`} prefetch={false} variant="outline" className="min-h-11">
                      Reconnecter
                    </ButtonLink>
                    <DisconnectButton storeId={store.id} />
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

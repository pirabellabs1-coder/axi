import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Search } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { apiFor } from "@/lib/tiktok-shop/connection";
import { platformRate } from "@/lib/tiktok-shop/fx";
import { marketFor } from "@/lib/tiktok-shop/markets";
import { convertStorePrice, eligibilityErrors, salesAttributesOf, sellableQuantity, sellerSkus, SIMPLE_KEY, toTiktokAmount } from "@/lib/tiktok-shop/mapping";
import { STATUS_LABELS } from "@/lib/tiktok-shop/model";
import { loadProductForSync } from "@/lib/tiktok-shop/sync";
import { TiktokShopError, type TiktokAttribute, type TiktokCategory } from "@/lib/tiktok-shop/types";
import { formatMoney } from "@/lib/money";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { AttributesForm, CategoryChoiceForm, PublishButton, UnlinkButton } from "../../tiktok-forms";

export const metadata: Metadata = { title: "Produit sur TikTok Shop" };

export default async function TiktokProductPage({ params, searchParams }: { params: Promise<{ storeId: string; productId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { storeId, productId } = await params;
  const { q } = await searchParams;
  const ctx = await getStoreContext(storeId, "products.manage");
  const store = ctx.store;
  const back = { href: `/app/${store.id}/integrations/tiktok-shop`, label: "TikTok Shop" };

  let conn: Awaited<ReturnType<typeof apiFor>>;
  try {
    conn = await apiFor(store.id);
  } catch {
    redirect(back.href);
  }
  const product = await loadProductForSync(store.id, productId);
  if (!product) notFound();
  const { api, config } = conn;
  const link = config.products[product.id] ?? null;
  const market = marketFor(config.shop?.region);
  const blockers = eligibilityErrors(product);

  const query = (q ?? "").trim().slice(0, 80);
  let categories: TiktokCategory[] = [];
  let attributes: TiktokAttribute[] = [];
  let apiError: string | null = null;
  try {
    if (query) categories = await api.searchCategories(query);
    if (link) attributes = (await api.getCategoryAttributes(link.categoryId)).filter((a) => a.type === "PRODUCT_PROPERTY");
  } catch (e) {
    apiError = e instanceof TiktokShopError ? e.message : "TikTok est momentanément indisponible.";
  }

  let preview: { key: string; label: string; sellerSku: string; axi: string; tiktok: string; quantity: number }[] = [];
  let fxError: string | null = null;
  if (market) {
    try {
      const { rate } = await platformRate(store.currency, market.currency);
      const skus = sellerSkus(product);
      const conv = (minor: number) => toTiktokAmount(convertStorePrice(minor, { storeCurrency: store.currency, marketCurrency: market.currency, rate, markupBps: config.settings.markupBps }), market.currency, market.priceDecimals);
      preview = product.variants.length
        ? product.variants.map((v) => ({ key: v.id, label: salesAttributesOf(v).map((a) => `${a.name} : ${a.valueName}`).join(", "), sellerSku: skus[v.id], axi: formatMoney(v.price ?? product.price, store.currency), tiktok: `${conv(v.price ?? product.price)} ${market.currency}`, quantity: sellableQuantity(product, v, config.settings) }))
        : [{ key: SIMPLE_KEY, label: "Article unique", sellerSku: skus[SIMPLE_KEY], axi: formatMoney(product.price, store.currency), tiktok: `${conv(product.price)} ${market.currency}`, quantity: sellableQuantity(product, null, config.settings) }];
    } catch (e) {
      fxError = (e as Error).message;
    }
  }

  return (
    <>
      <PageHeader
        title={product.name}
        description={link ? `Catégorie TikTok : ${link.categoryName}` : "Choisissez la catégorie TikTok de ce produit, puis renseignez ses attributs obligatoires."}
        back={back}
        actions={
          link ? (
            <div className="flex flex-wrap gap-2">
              <PublishButton storeId={store.id} productId={product.id} label={link.tiktokProductId ? "Mettre à jour sur TikTok" : "Publier sur TikTok"} disabled={blockers.length > 0} />
              {link.tiktokProductId && <UnlinkButton storeId={store.id} productId={product.id} />}
            </div>
          ) : undefined
        }
      />
      {blockers.length > 0 && (
        <Alert tone="warning" className="mb-6" title="Produit non publiable">
          {blockers.join(" ")}
        </Alert>
      )}
      {apiError && (
        <Alert tone="danger" className="mb-6">
          {apiError}
        </Alert>
      )}
      {link && (
        <Alert tone={link.status === "FAILED" || link.status === "error" ? "danger" : "info"} className="mb-6" title={`État TikTok : ${STATUS_LABELS[link.status] ?? link.status}`}>
          {link.lastError ?? (link.reviewReasons.length ? link.reviewReasons.join(" ; ") : link.tiktokProductId ? `Identifiant TikTok ${link.tiktokProductId}.` : "Pas encore publié.")}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Catégorie TikTok" description="Recherchez par mot-clé (en langue du marché, ex. « dress », « robe »)." />
          <CardBody>
            <form method="get" className="mb-4 flex gap-2" role="search">
              <label htmlFor="tts-q" className="sr-only">
                Rechercher une catégorie
              </label>
              <Input id="tts-q" name="q" defaultValue={query} placeholder="Ex. robe, sac, crème" maxLength={80} />
              <Button type="submit" variant="outline" className="min-h-11" aria-label="Rechercher">
                <Search className="size-4" aria-hidden />
              </Button>
            </form>
            {query && categories.length === 0 && !apiError && <p className="text-sm text-ink-muted">Aucune catégorie pour « {query} ».</p>}
            {categories.length > 0 && (
              <CategoryChoiceForm storeId={store.id} productId={product.id} current={link?.categoryId ?? null} categories={categories.map((c) => ({ id: c.id, label: c.path.join(" › ") }))} />
            )}
            {!query && link && <Badge tone="primary">{link.categoryName}</Badge>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Attributs" description="Les attributs marqués d'un astérisque sont exigés par TikTok pour cette catégorie." />
          <CardBody>
            {!link ? (
              <p className="text-sm text-ink-muted">Choisissez d&apos;abord une catégorie.</p>
            ) : attributes.length === 0 ? (
              <p className="text-sm text-ink-muted">Aucun attribut pour cette catégorie.</p>
            ) : (
              <AttributesForm
                storeId={store.id}
                productId={product.id}
                attributes={attributes.map((a) => {
                  const saved = link.attributes.find((x) => x.id === a.id);
                  return { id: a.id, name: a.name, required: a.required, multiple: a.multiple, customizable: a.customizable, values: a.values, selected: (saved?.values ?? []).map((v) => v.id).filter((x): x is string => !!x), custom: saved?.values.find((v) => v.name)?.name ?? "" };
                })}
              />
            )}
          </CardBody>
        </Card>
      </div>

      <section className="mt-8" aria-labelledby="tts-preview">
        <h2 id="tts-preview" className="mb-2 text-lg font-semibold tracking-[-0.02em] text-ink">
          Aperçu des articles envoyés
        </h2>
        <p className="mb-4 text-sm text-ink-muted">
          Prix convertis au taux du jour{config.settings.markupBps ? `, majorés de ${config.settings.markupBps / 100} %` : ""}. Le stock suit celui d&apos;Axi automatiquement.
        </p>
        {fxError ? (
          <Alert tone="warning">{fxError}</Alert>
        ) : (
          <Table minWidth={600}>
            <THead>
              <TR>
                <TH>Article</TH>
                <TH>SKU vendeur</TH>
                <TH align="right">Prix Axi</TH>
                <TH align="right">Prix TikTok</TH>
                <TH align="right">Quantité</TH>
              </TR>
            </THead>
            <TBody>
              {preview.map((r) => (
                <TR key={r.key}>
                  <TD>{r.label}</TD>
                  <TD>
                    <code className="font-mono text-xs">{r.sellerSku}</code>
                  </TD>
                  <TD align="right">{r.axi}</TD>
                  <TD align="right">{r.tiktok}</TD>
                  <TD align="right">{r.quantity}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </>
  );
}

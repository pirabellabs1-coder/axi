import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma, ProductStatus } from "@prisma/client";
import { Plus, Package, ChevronLeft, ChevronRight, ArrowUpRight, SearchX } from "lucide-react";
import { getStoreContext, planFeature } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { checkProductsQuota } from "@/lib/commerce/quotas";
import { effectivePrice } from "@/lib/commerce/pricing";
import { formatMoney } from "@/lib/money";
import { PLANS } from "@/config/plans";
import { getCollectionProducts, collectionsByProduct } from "@/lib/collections/service";
import { readRules } from "@/lib/collections/rules";
import { stockSummary } from "@/lib/products/variants";
import { effectiveLowStockThreshold, isBackorder, isLowStock } from "@/lib/inventory/policy";
import { lowStockProductIds, storeLowStockThreshold } from "@/lib/inventory/service";
import { requiredPlanFor } from "@/components/app/plan-gate";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { TableToolbar, TableFooter } from "@/components/ui/table";
import { ProductsActionsMenu } from "./products-actions";
import { ProductFilters } from "./product-filters";
import { ProductsTable, type ProductRow } from "./products-table";
import { countAssetsByProduct } from "@/lib/digital/service";
import { productKindOf } from "@/lib/digital/kinds";

export const metadata: Metadata = { title: "Produits" };

const PAGE_SIZE = 50;
const STATUSES: ProductStatus[] = ["ACTIVE", "DRAFT", "ARCHIVED"];
const SORTS: Record<string, Prisma.ProductOrderByWithRelationInput[]> = {
  updated: [{ updatedAt: "desc" }],
  created: [{ createdAt: "desc" }],
  name: [{ name: "asc" }],
  price_asc: [{ price: "asc" }],
  price_desc: [{ price: "desc" }],
};

export default async function ProductsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "products.manage");
  const sid = ctx.store.id;
  const base = `/app/${sid}`;
  const plan = PLANS[ctx.planId];
  const stockTracking = planFeature(ctx.planId, "stockTracking");

  const q = (sp.q ?? "").trim().slice(0, 60);
  const rawStatus = sp.status ?? sp.statut;
  const status = STATUSES.includes(rawStatus as ProductStatus) ? (rawStatus as ProductStatus) : undefined;
  const collection = sp.collection || sp.categorie || undefined;
  const type = sp.type?.slice(0, 60) || undefined;
  const vendor = sp.vendor?.slice(0, 60) || undefined;
  const tag = sp.tag?.slice(0, 40) || undefined;
  const lowStock = stockTracking && (sp.stock === "bas" || sp.stock === "epuise");
  const sort = sp.sort && SORTS[sp.sort] ? sp.sort : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const [cols, meta, storeThreshold] = await Promise.all([
    db.category.findMany({ where: { storeId: sid }, orderBy: { position: "asc" }, select: { id: true, name: true, rules: true } }),
    db.product.findMany({ where: { storeId: sid }, select: { tags: true, productType: true, vendor: true }, take: 2000 }),
    storeLowStockThreshold(sid),
  ]);
  // « Stock bas » : seuil du produit s'il en a un, sinon celui de la boutique (ruptures et surventes comprises).
  const lowIds = lowStock ? await lowStockProductIds(sid, storeThreshold, "catalog") : null;
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "fr"));

  // Filtre collection : manuelle (liste + catégorie principale) ou automatique (règles évaluées).
  let collectionWhere: Prisma.ProductWhereInput = {};
  if (collection === "none") {
    collectionWhere = { categoryId: null };
  } else if (collection && cols.some((c) => c.id === collection)) {
    const res = await getCollectionProducts(sid, collection, { includeInactive: true });
    collectionWhere = { id: { in: res?.products.map((p) => p.id) ?? [] } };
  }

  const where: Prisma.ProductWhereInput = {
    storeId: sid,
    ...(status ? { status } : { status: { not: "ARCHIVED" } }),
    ...collectionWhere,
    ...(type ? { productType: type } : {}),
    ...(vendor ? { vendor } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
    ...(lowIds ? { trackStock: true, AND: [{ id: { in: lowIds } }] } : {}),
    ...(q
      ? {
          AND: [
            ...(lowIds ? [{ id: { in: lowIds } }] : []),
            {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { tags: { has: q } },
                { variants: { some: { sku: { contains: q, mode: "insensitive" } } } },
              ],
            },
          ],
        }
      : {}),
  };

  const [products, total, quota, byStatus] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: [...(sort ? SORTS[sort] : SORTS.updated), { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, name: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, trackStock: true, stock: true, status: true, isFeatured: true, images: true,
        productType: true, vendor: true, inventoryPolicy: true, lowStockThreshold: true, kind: true, isGiftCard: true,
        variants: { select: { stock: true, price: true, inventoryPolicy: true, available: true } },
      },
    }),
    db.product.count({ where }),
    checkProductsQuota(sid, ctx.planId),
    db.product.groupBy({ by: ["status"], where: { storeId: sid }, _count: { _all: true } }),
  ]);
  const membership = await collectionsByProduct(sid, products.map((p) => p.id));
  // Vague 2 : nombre de fichiers vendus par produit numérique (une seule requête groupée).
  const fileCounts = products.some((p) => p.kind === "DIGITAL") ? await countAssetsByProduct(sid, products.filter((p) => p.kind === "DIGITAL").map((p) => p.id)) : new Map<string, number>();

  const now = new Date();
  const cur = ctx.store.currency;
  const rows: ProductRow[] = products.map((p) => {
    const img = Array.isArray(p.images) ? (p.images as { url?: string; alt?: string }[])[0] : undefined;
    const st = stockSummary(p);
    const threshold = effectiveLowStockThreshold(p.lowStockThreshold, storeThreshold);
    // Variantes désactivées : hors vente, ignorées pour « stock bas », « survente » et « précommande ».
    const items = p.variants.length ? p.variants.filter((v) => v.available).map((v) => ({ trackStock: p.trackStock, stock: v.stock, policy: v.inventoryPolicy })) : [{ trackStock: p.trackStock, stock: p.stock, policy: p.inventoryPolicy }];
    const tracked = p.trackStock && stockTracking;
    const low = tracked && items.some((i) => isLowStock(i, threshold));
    const oversold = tracked && items.some((i) => i.stock < 0);
    // Précommande : plus rien en stock mais au moins un article encore vendable en rupture.
    const preorder = tracked && !oversold && st.total <= 0 && items.some((i) => isBackorder(i));
    const eff = effectivePrice(p, now).price;
    const prices = p.variants.map((v) => v.price ?? eff);
    const min = prices.length ? Math.min(...prices) : eff;
    const max = prices.length ? Math.max(...prices) : eff;
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      isFeatured: p.isFeatured,
      trackStock: p.trackStock,
      thumb: typeof img?.url === "string" ? img.url : null,
      thumbAlt: img?.alt || p.name,
      stockLabel: !stockTracking || !p.trackStock ? "Non suivi" : oversold ? st.label : st.total <= 0 ? `Rupture${p.variants.length ? ` (${p.variants.length} variantes)` : ""}` : st.label,
      stockTone: !stockTracking || !p.trackStock ? "muted" : st.total <= 0 ? "danger" : low ? "warning" : "neutral",
      oversold,
      preorder,
      priceLabel: min === max ? formatMoney(min, cur) : `${formatMoney(min, cur)} à ${formatMoney(max, cur)}`,
      productType: p.productType,
      vendor: p.vendor,
      collections: (membership.get(p.id) ?? []).map((c) => c.name),
      variantCount: p.variants.length,
      kind: productKindOf(p),
      files: fileCounts.get(p.id) ?? 0,
    };
  });

  const counts = Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0])) as Record<ProductStatus, number>;
  const catalogEmpty = counts.ACTIVE + counts.DRAFT + counts.ARCHIVED === 0;
  const filtered = !!(q || status || collection || type || vendor || tag || lowStock);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showExport = ctx.can("export");
  const canExport = showExport && planFeature(ctx.planId, "csvExport");
  const canImport = planFeature(ctx.planId, "csvImport");
  const limitReached = !quota.allowed;
  const remaining = quota.limit != null ? Math.max(0, quota.limit - quota.used) : null;

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const current = { q: q || undefined, status, collection, type, vendor, tag, stock: lowStock ? "bas" : undefined, sort };
    for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return `${base}/produits${s ? `?${s}` : ""}`;
  };

  const addButton = limitReached ? (
    <ButtonLink href={`${base}/abonnement#plans`} variant="accent" trailing={ArrowUpRight}>
      Augmenter la limite
    </ButtonLink>
  ) : (
    <ButtonLink href={`${base}/produits/nouveau`} variant="primary">
      <Plus className="size-4" aria-hidden /> Ajouter un produit
    </ButtonLink>
  );

  return (
    <div>
      <PageHeader
        title="Produits"
        description={
          quota.limit != null ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="tabular">
                {quota.used} / {quota.limit} produits
              </span>
              <Progress value={quota.used} max={quota.limit} size="sm" className="w-32" />
              <span className="text-ink-faint">Plan {plan.name}</span>
            </span>
          ) : (
            <span className="tabular">
              {quota.used} produit{quota.used > 1 ? "s" : ""} au catalogue, sans limite sur le plan {plan.name}.
            </span>
          )
        }
        actions={
          <>
            <ProductsActionsMenu storeId={sid} canImport={canImport} canExport={canExport} showExport={showExport} importPlan={PLANS[requiredPlanFor("csvImport")].name} exportPlan={PLANS[requiredPlanFor("csvExport")].name} stockTracking={stockTracking} />
            {addButton}
          </>
        }
      />

      {limitReached ? (
        <Alert tone="warning" title="Limite de produits atteinte" className="mb-5">
          Votre plan {plan.name} inclut {quota.limit} produits. Vos produits restent en ligne ; pour en ajouter, archivez-en un ou{" "}
          <Link href={`${base}/abonnement#plans`} className="font-semibold underline underline-offset-4">
            passez à un plan supérieur
          </Link>
          .
        </Alert>
      ) : remaining != null && remaining <= 3 ? (
        <Alert tone="info" className="mb-5">
          Il vous reste {remaining} produit{remaining > 1 ? "s" : ""} sur votre plan {plan.name}.{" "}
          <Link href={`${base}/abonnement#plans`} className="font-semibold underline underline-offset-4">
            Voir les plans
          </Link>
        </Alert>
      ) : null}

      {catalogEmpty ? (
        <EmptyState
          icon={Package}
          title="Votre catalogue est vide"
          description="Ajoutez votre premier produit : un titre, un prix et une photo suffisent. Ajoutez des couleurs et tailles avec les options."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {addButton}
              {canImport && (
                <ButtonLink href={`${base}/produits/import`} variant="outline">
                  Importer un fichier CSV
                </ButtonLink>
              )}
            </div>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableToolbar className="gap-y-3">
            <Segmented
              label="Statut des produits"
              size="sm"
              value={status ?? "ALL"}
              options={[
                { value: "ALL", label: "Tous", href: qs({ status: undefined, page: undefined }), count: counts.ACTIVE + counts.DRAFT },
                { value: "ACTIVE", label: "Actifs", href: qs({ status: "ACTIVE", page: undefined }), count: counts.ACTIVE },
                { value: "DRAFT", label: "Brouillons", href: qs({ status: "DRAFT", page: undefined }), count: counts.DRAFT },
                { value: "ARCHIVED", label: "Archivés", href: qs({ status: "ARCHIVED", page: undefined }), count: counts.ARCHIVED },
              ]}
            />
            <ProductFilters
              action={`${base}/produits`}
              values={{ q, status, collection, type, vendor, tag, lowStock, sort }}
              collections={cols.map((c) => ({ id: c.id, name: c.name }))}
              types={uniq(meta.map((m) => m.productType))}
              vendors={uniq(meta.map((m) => m.vendor))}
              tags={uniq(meta.flatMap((m) => m.tags))}
              stockTracking={stockTracking}
            />
          </TableToolbar>

          {rows.length === 0 ? (
            <EmptyState
              compact
              icon={SearchX}
              title="Aucun produit ne correspond"
              description={status === "ARCHIVED" && !filtered ? "Aucun produit archivé." : "Modifiez la recherche ou retirez des filtres."}
              action={
                filtered ? (
                  <ButtonLink href={`${base}/produits`} variant="outline" size="sm">
                    Effacer les filtres
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <ProductsTable storeId={sid} rows={rows} collections={cols.map((c) => ({ id: c.id, name: c.name, auto: readRules(c.rules).type === "auto" }))} tags={uniq(meta.flatMap((m) => m.tags))} canExport={canExport} />
          )}

          {total > 0 && (
            <TableFooter>
              <span className="tabular">
                {pages > 1 ? `${(page - 1) * PAGE_SIZE + 1} à ${Math.min(page * PAGE_SIZE, total)} sur ${total}` : `${total} produit${total > 1 ? "s" : ""}`}
              </span>
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

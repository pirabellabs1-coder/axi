import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Boxes, Search, History, ImageOff } from "lucide-react";
import { getStoreContext, planFeature } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { thumbUrl } from "@/lib/image-loader";
import { PageHeader, EmptyState, Kpi } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { TableToolbar, TableFooter } from "@/components/ui/table";
import { PlanGate } from "@/components/app/plan-gate";
import { QuickStock } from "./inventory-row";
import { effectiveLowStockThreshold } from "@/lib/inventory/policy";
import { storeLowStockThreshold } from "@/lib/inventory/service";

export const metadata: Metadata = { title: "Inventaire" };

const PAGE_SIZE = 40;

type Line = { key: string; productId: string; variantId: string | null; product: string; variant: string | null; sku: string | null; stock: number; thumb: string | null; available: boolean; policy: "DENY" | "CONTINUE"; threshold: number };

/** Inventaire par variante : une ligne par article vendable, ajustement rapide en ligne, mouvements audités. */
export default async function InventoryPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ q?: string; vue?: string; page?: string }> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const ctx = await getStoreContext(storeId, "products.manage");
  const sid = ctx.store.id;
  const base = `/app/${sid}/produits`;
  if (!planFeature(ctx.planId, "stockTracking")) {
    return (
      <div>
        <PageHeader back={{ href: base, label: "Produits" }} title="Inventaire" />
        <PlanGate storeId={sid} feature="stockTracking" />
      </div>
    );
  }
  const q = (sp.q ?? "").trim().slice(0, 60);
  const view = sp.vue === "bas" || sp.vue === "rupture" || sp.vue === "survente" ? sp.vue : "tout";
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.ProductWhereInput = {
    storeId: sid,
    trackStock: true,
    status: { not: "ARCHIVED" },
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { variants: { some: { sku: { contains: q, mode: "insensitive" } } } }] } : {}),
  };
  const [products, recent, storeThreshold] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { name: "asc" },
      take: 1000,
      select: {
        id: true, name: true, sku: true, stock: true, images: true, inventoryPolicy: true, lowStockThreshold: true,
        variants: { orderBy: { position: "asc" }, select: { id: true, name: true, sku: true, stock: true, imageUrl: true, available: true, inventoryPolicy: true } },
      },
    }),
    db.inventoryMovement.count({ where: { storeId: sid, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } } }),
    storeLowStockThreshold(sid),
  ]);

  // Seuil « stock bas » : celui du produit, sinon le seuil par défaut de la boutique.
  const all: Line[] = products.flatMap((p): Line[] => {
    const img = Array.isArray(p.images) ? ((p.images as { url?: string }[])[0]?.url ?? null) : null;
    const threshold = effectiveLowStockThreshold(p.lowStockThreshold, storeThreshold);
    if (p.variants.length === 0) return [{ key: p.id, productId: p.id, variantId: null, product: p.name, variant: null, sku: p.sku, stock: p.stock, thumb: img, available: true, policy: p.inventoryPolicy, threshold }];
    return p.variants.map((v) => ({ key: v.id, productId: p.id, variantId: v.id, product: p.name, variant: v.name, sku: v.sku, stock: v.stock, thumb: v.imageUrl ?? img, available: v.available, policy: v.inventoryPolicy, threshold }));
  });
  // Variantes désactivées : listées dans « Tout », exclues des vues et compteurs d'alerte.
  const lines = all.filter((l) => (view === "tout" ? true : !l.available ? false : view === "rupture" ? l.stock <= 0 : view === "bas" ? l.stock <= l.threshold : l.stock < 0));
  const pages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const shown = lines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const sellable = all.filter((l) => l.available);
  const out = sellable.filter((l) => l.stock <= 0).length;
  const oversold = sellable.filter((l) => l.stock < 0).length;
  const low = sellable.filter((l) => l.stock > 0 && l.stock <= l.threshold).length;
  const units = all.reduce((s, l) => s + Math.max(0, l.stock), 0);
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: q || undefined, vue: view === "tout" ? undefined : view, ...over })) if (v) p.set(k, v);
    return `${base}/stock${p.size ? `?${p}` : ""}`;
  };

  return (
    <div>
      <PageHeader back={{ href: base, label: "Produits" }} title="Inventaire" description="Une ligne par variante. Modifiez la quantité puis validez : chaque changement est enregistré comme mouvement de stock." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Articles suivis" icon={Boxes} value={all.length} hint={`${units.toLocaleString("fr-FR")} unités au total`} />
        <Kpi label="En rupture" value={<span className={out ? "text-danger" : undefined}>{out}</span>} hint={oversold ? `Dont ${oversold} en survente` : "Stock à zéro ou moins"} />
        <Kpi label="Stock bas" value={<span className={low ? "text-warning" : undefined}>{low}</span>} hint={`Sous le seuil (${storeThreshold} par défaut)`} />
        <Kpi label="Mouvements" icon={History} value={recent} hint="7 derniers jours" />
      </div>
      <Card className="overflow-hidden">
        <TableToolbar className="gap-y-3">
          <Segmented
            label="Filtrer l'inventaire"
            size="sm"
            value={view}
            options={[
              { value: "tout", label: "Tout", href: href({ vue: undefined, page: undefined }), count: all.length },
              { value: "bas", label: "Stock bas", href: href({ vue: "bas", page: undefined }), count: low + out },
              { value: "rupture", label: "Rupture", href: href({ vue: "rupture", page: undefined }), count: out },
              ...(oversold || view === "survente" ? [{ value: "survente", label: "Survente", href: href({ vue: "survente", page: undefined }), count: oversold }] : []),
            ]}
          />
          <form method="get" action={`${base}/stock`} role="search" className="relative ml-auto w-full sm:w-72">
            {view !== "tout" && <input type="hidden" name="vue" value={view} />}
            <label htmlFor="inv-q" className="sr-only">
              Rechercher un article
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input id="inv-q" name="q" type="search" defaultValue={q} placeholder="Produit ou SKU" className="h-11 w-full rounded-full bg-surface pl-9 pr-3 text-sm text-ink ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-primary md:h-9" />
          </form>
        </TableToolbar>
        {shown.length === 0 ? (
          <EmptyState
            compact
            icon={Boxes}
            title={all.length === 0 ? "Aucun produit suivi" : "Rien à afficher"}
            description={all.length === 0 ? "Activez « Suivre la quantité » dans la fiche d'un produit pour gérer son stock ici." : "Aucun article ne correspond à ce filtre."}
            action={
              <ButtonLink href={base} variant="outline" size="sm">
                Voir les produits
              </ButtonLink>
            }
          />
        ) : (
          <ul className="divide-y divide-line" aria-label="Articles en stock">
            {shown.map((l) => {
              const label = l.variant ? `${l.product} (${l.variant})` : l.product;
              return (
                <li key={l.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:flex-nowrap">
                  {l.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbUrl(l.thumb)} alt="" width={40} height={40} loading="lazy" className="size-10 shrink-0 rounded-[10px] object-cover ring-1 ring-line" />
                  ) : (
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-ink-faint ring-1 ring-inset ring-line" aria-hidden>
                      <ImageOff className="size-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`${base}/${l.productId}`} className="block truncate text-sm font-medium text-ink hover:underline">
                      {l.product}
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                      {l.variant && <span>{l.variant}</span>}
                      {l.sku && <span className="font-mono">{l.sku}</span>}
                      {!l.available && <Badge tone="neutral">Indisponible</Badge>}
                      {l.stock < 0 ? (
                        <Badge tone="danger">Survente ({l.stock})</Badge>
                      ) : l.stock === 0 ? (
                        l.policy === "CONTINUE" ? <Badge tone="info">Précommande</Badge> : <Badge tone="danger">Rupture</Badge>
                      ) : l.stock <= l.threshold ? (
                        <Badge tone="warning">Stock bas</Badge>
                      ) : null}
                      {l.policy === "CONTINUE" && l.stock > 0 && <span title="Continuer à vendre en cas de rupture">Vente en rupture autorisée</span>}
                    </p>
                  </div>
                  <QuickStock key={`${l.key}-${l.stock}`} storeId={sid} productId={l.productId} variantId={l.variantId} stock={l.stock} label={label} />
                  <Link href={`${base}/${l.productId}/stock`} className="hidden text-xs text-ink-muted underline-offset-4 hover:text-ink hover:underline md:inline">
                    Historique
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {lines.length > 0 && (
          <TableFooter>
            <span className="tabular">
              {lines.length} article{lines.length > 1 ? "s" : ""}
            </span>
            {pages > 1 && (
              <nav className="flex items-center gap-2" aria-label="Pagination">
                {page > 1 && (
                  <ButtonLink href={href({ page: String(page - 1) })} variant="outline" size="sm">
                    Précédent
                  </ButtonLink>
                )}
                <span className="tabular text-xs">
                  {page} / {pages}
                </span>
                {page < pages && (
                  <ButtonLink href={href({ page: String(page + 1) })} variant="outline" size="sm">
                    Suivant
                  </ButtonLink>
                )}
              </nav>
            )}
          </TableFooter>
        )}
      </Card>
    </div>
  );
}

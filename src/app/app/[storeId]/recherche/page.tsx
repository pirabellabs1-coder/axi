import type { Metadata } from "next";
import Link from "next/link";
import { Search, ShoppingBag, Users, Package, ArrowRight } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { relativeTime, formatPhone } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/commerce/order-state";
import { Avatar, EmptyState, Money } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { thumbUrl } from "@/lib/image-loader";

export const metadata: Metadata = { title: "Recherche" };

const LIMIT = 8;

export default async function SearchPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { storeId } = await params;
  const { q: raw = "" } = await searchParams;
  const ctx = await getStoreContext(storeId, "store.view");
  const store = ctx.store;
  const base = `/app/${store.id}`;
  const q = raw.trim().slice(0, 80);
  const digits = q.replace(/\D/g, "");
  const canOrders = ctx.can("orders.view");
  const canCustomers = ctx.can("customers.view");
  const canProducts = ctx.can("products.manage") || ctx.role === "SUPPORT";

  const ci = { contains: q, mode: "insensitive" as const };
  const [orders, customers, products] = q.length < 2
    ? [[], [], []]
    : await Promise.all([
        canOrders
          ? db.order.findMany({
              where: {
                storeId: store.id,
                OR: [
                  { reference: ci },
                  { customerName: ci },
                  ...(digits.length >= 4 ? [{ customerPhone: { contains: digits } }] : []),
                ],
              },
              orderBy: { createdAt: "desc" },
              take: LIMIT,
              select: { id: true, reference: true, customerName: true, total: true, currency: true, status: true, createdAt: true },
            })
          : Promise.resolve([]),
        canCustomers
          ? db.customer.findMany({
              where: {
                storeId: store.id,
                OR: [{ name: ci }, { email: ci }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])],
              },
              orderBy: { lastOrderAt: { sort: "desc", nulls: "last" } },
              take: LIMIT,
              select: { id: true, name: true, phone: true, ordersCount: true, totalSpent: true },
            })
          : Promise.resolve([]),
        canProducts
          ? db.product.findMany({
              where: { storeId: store.id, status: { not: "ARCHIVED" }, OR: [{ name: ci }, { sku: ci }] },
              orderBy: { updatedAt: "desc" },
              take: LIMIT,
              select: { id: true, name: true, price: true, status: true, images: true, sku: true },
            })
          : Promise.resolve([]),
      ]);

  const total = orders.length + customers.length + products.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-ink sm:text-[30px]">Recherche</h1>
        <form action={`${base}/recherche`} method="get" role="search" className="relative mt-4 max-w-xl">
          <label htmlFor="search-page-q" className="sr-only">
            Référence de commande, nom, téléphone ou produit
          </label>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            id="search-page-q"
            name="q"
            type="search"
            defaultValue={q}
            autoFocus={!q}
            placeholder="Référence, client, téléphone ou produit"
            className="h-12 w-full rounded-full border-0 bg-surface pl-11 pr-4 text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </form>
        {q.length >= 2 && (
          <p className="mt-3 text-sm text-ink-muted" role="status">
            {total === 0 ? "Aucun résultat" : `${total} résultat${total > 1 ? "s" : ""}`} pour « {q} »
          </p>
        )}
      </div>

      {q.length < 2 ? (
        <EmptyState icon={Search} title="Que cherchez-vous ?" description="Saisissez au moins 2 caractères : une référence de commande (ex. AX-7K3P9Q), un nom, un numéro de téléphone ou un produit." />
      ) : total === 0 ? (
        <EmptyState icon={Search} title="Aucun résultat" description="Vérifiez l'orthographe ou essayez avec une partie du numéro de téléphone ou de la référence." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {canOrders && (
            <ResultGroup icon={ShoppingBag} title="Commandes" count={orders.length} more={orders.length === LIMIT ? `${base}/commandes?q=${encodeURIComponent(q)}` : undefined} className="lg:col-span-2">
              {orders.map((o) => (
                <ResultRow key={o.id} href={`${base}/commandes/${o.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px] font-semibold text-ink">{o.reference}</p>
                    <p className="truncate text-[13px] text-ink-muted">
                      {o.customerName}, <time dateTime={o.createdAt.toISOString()}>{relativeTime(o.createdAt)}</time>
                    </p>
                  </div>
                  <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                  <Money amount={o.total} currency={o.currency} className="w-28 text-right text-sm font-semibold" />
                </ResultRow>
              ))}
            </ResultGroup>
          )}
          {canCustomers && (
            <ResultGroup icon={Users} title="Clients" count={customers.length} more={customers.length === LIMIT ? `${base}/clients?q=${encodeURIComponent(q)}` : undefined}>
              {customers.map((c) => (
                <ResultRow key={c.id} href={`${base}/clients/${c.id}`}>
                  <Avatar name={c.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                    <p className="tabular truncate text-[13px] text-ink-muted">{formatPhone(c.phone)}</p>
                  </div>
                  <div className="text-right text-[13px] text-ink-muted">
                    <Money amount={c.totalSpent} currency={store.currency} className="block font-medium text-ink" />
                    {c.ordersCount} commande{c.ordersCount > 1 ? "s" : ""}
                  </div>
                </ResultRow>
              ))}
            </ResultGroup>
          )}
          {canProducts && (
            <ResultGroup icon={Package} title="Produits" count={products.length} more={products.length === LIMIT ? `${base}/produits?q=${encodeURIComponent(q)}` : undefined}>
              {products.map((p) => {
                const img = Array.isArray(p.images) ? (p.images[0] as { url?: string } | undefined)?.url : undefined;
                return (
                  <ResultRow key={p.id} href={`${base}/produits/${p.id}`}>
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl(img)} alt="" className="size-8 shrink-0 rounded-[10px] object-cover ring-1 ring-line" loading="lazy" />
                    ) : (
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-ink-faint">
                        <Package className="size-4" aria-hidden />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                      {p.sku && <p className="truncate font-mono text-xs text-ink-muted">{p.sku}</p>}
                    </div>
                    {p.status === "DRAFT" && <Badge>Brouillon</Badge>}
                    <Money amount={p.price} currency={store.currency} className="text-sm font-medium" />
                  </ResultRow>
                );
              })}
            </ResultGroup>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({
  icon: Icon,
  title,
  count,
  more,
  className,
  children,
}: {
  icon: typeof Search;
  title: string;
  count: number;
  more?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card as="section" className={className}>
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Icon className="size-4 text-ink-faint" aria-hidden /> {title}
          <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs font-medium text-ink-muted">{count}</span>
        </h2>
        {more && (
          <Link href={more} className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-primary hover:underline">
            Voir plus <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {count === 0 ? <p className="border-t border-line px-5 py-4 text-sm text-ink-muted">Aucun résultat dans cette catégorie.</p> : <ul className="divide-y divide-line border-t border-line">{children}</ul>}
    </Card>
  );
}

function ResultRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex min-h-14 items-center gap-3 px-5 py-2.5 transition-colors duration-150 hover:bg-surface-2/60">
        {children}
      </Link>
    </li>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Receipt } from "lucide-react";
import { db } from "@/lib/db";
import { getAccountPage } from "@/lib/buyer/account";
import { ORDER_STATUS_LABELS } from "@/lib/commerce/order-state";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { AccountCard, AccountShell } from "@/components/storefront/account/account-shell";
import { AccountDisabled } from "@/components/storefront/account/account-disabled";
import { OrderStatusPill } from "@/components/storefront/account/order-status-pill";

export const metadata: Metadata = { title: "Mes commandes", robots: { index: false, follow: false } };

const PAGE = 20;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AccountOrders({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getAccountPage(slug, `/s/${slug}/compte/commandes`);
  if (ctx.state === "disabled") return <AccountDisabled slug={ctx.store.slug} />;
  const { store, buyer, readOnly } = ctx;
  const after = typeof sp.apres === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(sp.apres) ? sp.apres : null;

  // Pagination par curseur (id), ordre stable date puis id : pas de dérive quand de nouvelles commandes arrivent.
  const where = { storeId: store.id, customerId: buyer.customerId };
  const cursorOk = after ? await db.order.findFirst({ where: { ...where, id: after }, select: { id: true } }) : null;
  const rows = await db.order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(cursorOk ? { cursor: { id: cursorOk.id }, skip: 1 } : {}),
    select: { id: true, reference: true, createdAt: true, status: true, total: true, currency: true, fulfillmentType: true, _count: { select: { items: true } } },
  });
  const hasMore = rows.length > PAGE;
  const orders = rows.slice(0, PAGE);
  const base = `/s/${store.slug}/compte`;

  return (
    <AccountShell slug={store.slug} active="orders" title="Mes commandes" description="Toutes vos commandes passées avec votre numéro, y compris sans compte." readOnlyNotice={readOnly}>
      {orders.length === 0 ? (
        <AccountCard className="flex flex-col items-center py-12 text-center">
          <span className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink">
            <Receipt className="size-6" aria-hidden />
          </span>
          <p className="text-base font-semibold text-ink">{cursorOk ? "Plus aucune commande" : "Aucune commande pour le moment"}</p>
          <p className="mt-1 max-w-[44ch] text-sm text-ink-muted">Vos commandes chez {store.name} apparaîtront ici avec leur suivi.</p>
          <Link href={cursorOk ? `${base}/commandes` : `/s/${store.slug}`} className="sf-btn sf-btn-solid mt-5 h-12 px-6 text-[15px]">
            {cursorOk ? "Revenir au début" : "Découvrir la boutique"}
          </Link>
        </AccountCard>
      ) : (
        <AccountCard className="p-0 sm:p-0">
          <ul className="divide-y divide-line" aria-label="Commandes">
            {orders.map((o) => (
              <li key={o.id} className="relative flex min-h-[72px] items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2 sm:px-6">
                <div className="min-w-0 flex-1">
                  <Link href={`${base}/commandes/${o.reference}`} className="font-mono text-[15px] font-semibold text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-[var(--store-primary)]">
                    {o.reference}
                  </Link>
                  <p className="text-[13px] text-ink-muted">
                    {formatDate(o.createdAt)} · {o._count.items} article{o._count.items > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums text-ink">{formatMoney(o.total, o.currency)}</span>
                  <OrderStatusPill status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
                </div>
                <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
              </li>
            ))}
          </ul>
        </AccountCard>
      )}
      {hasMore && (
        <div className="mt-5 flex justify-center">
          <Link href={`${base}/commandes?apres=${orders[orders.length - 1]!.id}`} className="sf-btn sf-btn-outline h-12 px-6 text-[15px]">
            Commandes plus anciennes
          </Link>
        </div>
      )}
    </AccountShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Info, Undo2 } from "lucide-react";
import { db } from "@/lib/db";
import { getAccountPage } from "@/lib/buyer/account";
import { getBuyerReturnView } from "@/lib/returns/buyer";
import { RETURN_STATUS_LABELS } from "@/lib/returns/state";
import { formatDate } from "@/lib/utils";
import { AccountCard, AccountShell } from "@/components/storefront/account/account-shell";
import { AccountDisabled } from "@/components/storefront/account/account-disabled";
import { ReturnRequestForm } from "./_components/return-request-form";

export const metadata: Metadata = { title: "Mes retours", robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ commande?: string }> };

/** Retours du client connecté ; `?commande={référence}` ouvre le formulaire de demande pour cette commande. */
export default async function AccountReturnsPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const reference = sp.commande && /^[A-Z0-9-]{4,24}$/.test(sp.commande) ? sp.commande : null;
  const ctx = await getAccountPage(slug, `/s/${slug}/compte/retours${reference ? `?commande=${reference}` : ""}`);
  if (ctx.state === "disabled") return <AccountDisabled slug={ctx.store.slug} />;
  const { store, buyer, readOnly } = ctx;
  const base = `/s/${store.slug}/compte`;

  if (reference) {
    // Isolation : commande de CETTE boutique ET de ce client.
    const order = await db.order.findFirst({ where: { storeId: store.id, customerId: buyer.customerId, reference }, select: { id: true, reference: true, currency: true } });
    if (!order) notFound();
    const view = await getBuyerReturnView(store.id, order.id);
    if (!view) notFound();
    return (
      <AccountShell slug={store.slug} active="returns" back={{ href: `${base}/commandes/${order.reference}`, label: `Commande ${order.reference}` }} title="Retourner des articles" description={view.deadline ? `Demande possible jusqu'au ${formatDate(view.deadline)}.` : undefined} readOnlyNotice={readOnly}>
        <AccountCard>
          {view.canRequest && !readOnly ? (
            <ReturnRequestForm
              slug={store.slug}
              proof={{ kind: "session", reference: order.reference }}
              items={view.items}
              currency={order.currency}
              resolutions={view.resolutions}
              requirePhotos={view.policy.requirePhotos}
              afterSuccessHref={`${base}/retours/{reference}`}
            />
          ) : (
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {readOnly
                ? "La boutique est fermée temporairement : les demandes reprendront à sa réouverture."
                : !view.portalOpen
                  ? "Cette boutique ne prend pas les demandes de retour en ligne. Contactez-la directement."
                  : (view.eligibilityMessage ?? "Aucun article de cette commande ne peut faire l'objet d'une nouvelle demande.")}
            </p>
          )}
        </AccountCard>
      </AccountShell>
    );
  }

  const returns = await db.returnRequest.findMany({
    where: { storeId: store.id, order: { customerId: buyer.customerId } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, reference: true, status: true, createdAt: true, order: { select: { reference: true } }, items: { select: { quantity: true } } },
  });

  return (
    <AccountShell slug={store.slug} active="returns" title="Mes retours" description="Suivez vos demandes de retour et d'échange." readOnlyNotice={readOnly}>
      {returns.length === 0 ? (
        <AccountCard className="flex flex-col items-center py-12 text-center">
          <Undo2 className="size-8 text-ink-muted" aria-hidden />
          <p className="mt-3 font-semibold text-ink">Aucun retour</p>
          <p className="mt-1 max-w-[40ch] text-sm text-ink-muted">Pour retourner un article, ouvrez une commande livrée puis « Retourner des articles ».</p>
          <Link href={`${base}/commandes`} className="mt-5 inline-flex h-12 items-center rounded-full bg-[var(--store-primary)] px-6 text-sm font-semibold text-[var(--store-primary-contrast)]">
            Mes commandes
          </Link>
        </AccountCard>
      ) : (
        <ul className="space-y-3">
          {returns.map((r) => {
            const units = r.items.reduce((s, i) => s + i.quantity, 0);
            return (
              <li key={r.id}>
                <Link href={`${base}/retours/${r.reference}`} className="flex min-h-16 items-center justify-between gap-3 rounded-[var(--store-card-radius)] bg-surface px-5 py-4 ring-1 ring-line hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block font-mono font-semibold text-ink">{r.reference}</span>
                    <span className="block text-sm text-ink-muted">
                      Commande {r.order.reference} · {units} article{units > 1 ? "s" : ""} · {formatDate(r.createdAt)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-ink">{RETURN_STATUS_LABELS[r.status]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AccountShell>
  );
}

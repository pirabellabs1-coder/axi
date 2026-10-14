import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountPage } from "@/lib/buyer/account";
import { getBuyerReturnView } from "@/lib/returns/buyer";
import { AccountShell } from "@/components/storefront/account/account-shell";
import { AccountDisabled } from "@/components/storefront/account/account-disabled";
import { BuyerReturnList } from "../_components/return-list";

export const metadata: Metadata = { title: "Suivi du retour", robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string; reference: string }> };

export default async function AccountReturnDetail({ params }: Props) {
  const { slug, reference } = await params;
  if (!/^RT-[A-Z0-9]{4,12}$/.test(reference)) notFound();
  const ctx = await getAccountPage(slug, `/s/${slug}/compte/retours/${reference}`);
  if (ctx.state === "disabled") return <AccountDisabled slug={ctx.store.slug} />;
  const { store, buyer, readOnly } = ctx;
  // Isolation : retour de CETTE boutique, sur une commande de CE client.
  const ret = await db.returnRequest.findFirst({
    where: { storeId: store.id, reference, order: { customerId: buyer.customerId } },
    select: { id: true, orderId: true, order: { select: { reference: true, currency: true } } },
  });
  if (!ret) notFound();
  const view = await getBuyerReturnView(store.id, ret.orderId);
  const summary = view?.returns.find((r) => r.id === ret.id);
  if (!view || !summary) notFound();
  const base = `/s/${store.slug}/compte`;
  return (
    <AccountShell slug={store.slug} active="returns" back={{ href: `${base}/retours`, label: "Mes retours" }} title={<span className="font-mono">{reference}</span>} description={`Commande ${ret.order.reference}`} readOnlyNotice={readOnly}>
      <BuyerReturnList returns={[summary]} currency={ret.order.currency} proof={{ kind: "session", slug: store.slug, reference: ret.order.reference }} instructions={view.policy.instructions} />
    </AccountShell>
  );
}

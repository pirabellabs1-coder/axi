import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { isItemReturnable, parseReturnPolicy, remainingQuantities } from "@/lib/returns/policy";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { PlanGate } from "@/components/app/plan-gate";
import { CreateReturnForm, type CreatableItem } from "./create-return-form";

export const metadata: Metadata = { title: "Créer un retour" };

export default async function NewReturnPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ commande?: string }> }) {
  const [{ storeId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getStoreContext(storeId, "returns.manage");
  const store = ctx.store;
  if (!sp.commande || !/^[A-Za-z0-9_-]{8,64}$/.test(sp.commande)) notFound();
  const order = await db.order.findFirst({
    where: { id: sp.commande, storeId: store.id },
    select: {
      id: true, reference: true, status: true, currency: true,
      items: { select: { id: true, name: true, variantName: true, unitPrice: true, quantity: true, isGiftCard: true, product: { select: { tags: true } } } },
      returnRequests: { select: { id: true, status: true, items: { select: { orderItemId: true, quantity: true } } } },
    },
  });
  if (!order) notFound();
  const back = { href: `/app/${store.id}/commandes/${order.id}`, label: `Commande ${order.reference}` };

  if (!PLANS[ctx.planId].features.returnsPortal) {
    return (
      <>
        <PageHeader back={back} title="Créer un retour" />
        <PlanGate storeId={store.id} feature="returnsPortal" />
      </>
    );
  }

  const policy = parseReturnPolicy(store.returnPolicy);
  const remaining = remainingQuantities(
    order.items,
    order.returnRequests.flatMap((r) => r.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity, status: r.status, returnId: r.id }))),
  );
  const items: CreatableItem[] = order.items.map((i) => ({
    id: i.id,
    name: i.name,
    variantName: i.variantName,
    unitPrice: i.unitPrice,
    remaining: remaining.get(i.id) ?? 0,
    returnable: isItemReturnable({ isGiftCard: i.isGiftCard, productTags: i.product?.tags ?? null }, policy),
  }));

  return (
    <>
      <PageHeader back={back} title="Créer un retour" description="Retour rapporté en boutique ou accepté par téléphone. Le remboursement se décide à l'étape suivante." />
      {order.status !== "DELIVERED" ? (
        <Alert tone="warning">Un retour n'est possible qu'après la livraison de la commande.</Alert>
      ) : items.every((i) => !i.returnable || i.remaining === 0) ? (
        <Alert tone="info">Tous les articles de cette commande ont déjà été retournés ou ne sont pas retournables.</Alert>
      ) : (
        <Card>
          <CardBody>
            <CreateReturnForm storeId={store.id} orderId={order.id} items={items} currency={order.currency} />
          </CardBody>
        </Card>
      )}
    </>
  );
}

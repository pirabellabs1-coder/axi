import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { getCountry } from "@/config/site";
import { PackagePlus } from "lucide-react";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { NewOrderForm } from "./new-order-form";

export const metadata: Metadata = { title: "Nouvelle commande" };

export default async function NewOrderPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ client?: string }> }) {
  const { storeId } = await params;
  const { client } = await searchParams;
  const ctx = await getStoreContext(storeId, "orders.manage");
  const store = ctx.store;
  const [products, zones, methods, customers] = await Promise.all([
    db.product.findMany({
      where: { storeId: store.id, status: "ACTIVE" },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, trackStock: true, stock: true, inventoryPolicy: true, variants: { orderBy: { position: "asc" }, select: { id: true, name: true, price: true, stock: true, inventoryPolicy: true } } },
    }),
    db.deliveryZone.findMany({ where: { storeId: store.id, active: true }, orderBy: { position: "asc" }, select: { id: true, name: true, fee: true } }),
    db.paymentMethod.findMany({ where: { storeId: store.id, active: true }, orderBy: { position: "asc" }, select: { id: true, label: true } }),
    db.customer.findMany({ where: { storeId: store.id }, orderBy: { lastOrderAt: "desc" }, take: 300, select: { id: true, name: true, phone: true, email: true, address: true, storeCreditBalance: true } }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader back={{ href: `/app/${store.id}/commandes`, label: "Commandes" }} title="Nouvelle commande" description="Saisissez une commande reçue par téléphone, WhatsApp ou en boutique. Les montants sont recalculés côté serveur." />
      {store.status !== "PUBLISHED" && (
        <Alert tone="warning" className="mb-6">
          La boutique n&apos;est pas publiée : la création de commandes est bloquée tant qu&apos;elle n&apos;est pas en ligne.
        </Alert>
      )}
      {products.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          title="Aucun produit actif"
          description="Ajoutez au moins un produit actif à votre catalogue avant de saisir une commande."
          action={<ButtonLink href={`/app/${store.id}/produits`}>Gérer mes produits</ButtonLink>}
        />
      ) : (
        <NewOrderForm
          storeId={store.id}
          currency={store.currency}
          dialCode={getCountry(store.country).dialCode}
          products={products.map((p) => ({ ...p, promoStart: p.promoStart?.toISOString() ?? null, promoEnd: p.promoEnd?.toISOString() ?? null }))}
          zones={zones}
          methods={methods}
          customers={customers}
          initialCustomerId={client && customers.some((c) => c.id === client) ? client : ""}
          pickupEnabled={store.pickupEnabled}
          deliveryEnabled={store.deliveryEnabled}
          whatsappOrdering={store.whatsappOrdering}
          canUseStoreCredit={ctx.can("customers.manage")}
        />
      )}
    </div>
  );
}

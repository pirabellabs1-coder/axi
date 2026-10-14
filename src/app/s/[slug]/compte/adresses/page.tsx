import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getAccountPage } from "@/lib/buyer/account";
import { MAX_ADDRESSES } from "@/lib/buyer/otp";
import { formatPhone } from "@/lib/utils";
import { AccountShell } from "@/components/storefront/account/account-shell";
import { AccountDisabled } from "@/components/storefront/account/account-disabled";
import { AddressManager } from "@/components/storefront/account/address-manager";

export const metadata: Metadata = { title: "Mes adresses", robots: { index: false, follow: false } };

export default async function AccountAddresses({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountPage(slug, `/s/${slug}/compte/adresses`);
  if (ctx.state === "disabled") return <AccountDisabled slug={ctx.store.slug} />;
  const { store, buyer, readOnly } = ctx;
  const rows = await db.customerAddress.findMany({
    where: { storeId: store.id, customerId: buyer.customerId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    take: MAX_ADDRESSES,
    include: { deliveryZone: { select: { name: true, active: true } } },
  });
  const zones = store.deliveryEnabled ? store.deliveryZones.map((z) => ({ id: z.id, name: z.name })) : [];

  return (
    <AccountShell slug={store.slug} active="addresses" title="Mes adresses" description="Proposées au moment de commander. Une adresse par défaut, jusqu'à 10." readOnlyNotice={readOnly}>
      <AddressManager
        slug={store.slug}
        max={MAX_ADDRESSES}
        readOnly={readOnly}
        zones={zones}
        addresses={rows.map((a) => ({
          id: a.id,
          label: a.label,
          recipientName: a.recipientName,
          phone: a.phone,
          phoneDisplay: a.phone ? formatPhone(a.phone) : null,
          address: a.address,
          landmark: a.landmark,
          city: a.city,
          deliveryZoneId: a.deliveryZoneId,
          zoneName: a.deliveryZone?.name ?? null,
          zoneInactive: !!a.deliveryZone && !a.deliveryZone.active,
          isDefault: a.isDefault,
        }))}
      />
    </AccountShell>
  );
}

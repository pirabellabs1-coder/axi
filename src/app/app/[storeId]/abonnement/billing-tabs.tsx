import { LinkTabs } from "@/components/ui/tabs";

/** Sous-navigation facturation : abonnement et factures / options et crédits. */
export function BillingTabs({ storeId }: { storeId: string }) {
  return (
    <LinkTabs
      items={[
        { href: `/app/${storeId}/abonnement`, label: "Abonnement et factures" },
        { href: `/app/${storeId}/options`, label: "Options et crédits" },
      ]}
    />
  );
}

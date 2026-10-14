"use client";

import { LinkTabs } from "@/components/ui/tabs";

/** Onglets du module Promotions : codes promo, remises automatiques, offres au panier. */
export function PromotionsTabs({ storeId, counts }: { storeId: string; counts?: { coupons?: number; automatic?: number; offers?: number } }) {
  const base = `/app/${storeId}/promotions`;
  return (
    <LinkTabs
      className="mb-6"
      items={[
        { href: base, label: "Codes promo", exact: true, count: counts?.coupons },
        { href: `${base}/automatiques`, label: "Remises automatiques", count: counts?.automatic },
        { href: `${base}/offres`, label: "Offres au panier", count: counts?.offers },
      ]}
    />
  );
}

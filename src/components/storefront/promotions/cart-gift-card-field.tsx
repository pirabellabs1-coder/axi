"use client";

import { useEffect, useState, useTransition } from "react";
import { previewTotals } from "@/lib/storefront/actions";
import { GiftCardInput, type AppliedGiftCard } from "../gift-card-input";
import { readCartGiftCards, useCart, writeCartGiftCards } from "../cart-store";

/**
 * Champ « Carte cadeau » du panier (réglage `show_gift_card_field`) : le code est vérifié par le serveur
 * (previewTotals) puis mémorisé sur l'appareil et repris au checkout. Le solde n'est montré qu'à qui a saisi le code.
 */
export function CartGiftCardField({ slug, currency }: { slug: string; currency: string }) {
  const cart = useCart(slug);
  const [codes, setCodes] = useState<string[]>([]);
  const [applied, setApplied] = useState<AppliedGiftCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setCodes(readCartGiftCards(slug)), [slug]);

  const onCodesChange = (next: string[]) => {
    setError(null);
    if (next.length < codes.length) {
      setCodes(next);
      writeCartGiftCards(slug, next);
      setApplied((a) => a.filter((x) => next.some((c) => c.endsWith(x.last4))));
      return;
    }
    start(async () => {
      const r = await previewTotals({
        storeSlug: slug,
        items: cart.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, optionIds: l.optionIds, quantity: l.quantity })),
        fulfillmentType: "PICKUP",
        giftCardCodes: next,
      });
      if (!r.ok) {
        setError(r.field === "giftCardCodes" ? r.error : "Vérification impossible pour le moment. Vous pourrez saisir la carte à la commande.");
        return;
      }
      setCodes(next);
      writeCartGiftCards(slug, next);
      setApplied(r.giftCards);
    });
  };

  return (
    <div>
      <GiftCardInput codes={codes} onCodesChange={onCodesChange} applied={applied} error={error} currency={currency} pending={pending} />
      {codes.length > 0 && <p className="mt-1.5 text-xs text-ink-muted">La carte est déduite à l&apos;étape de commande.</p>}
    </div>
  );
}

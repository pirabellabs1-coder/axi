import { S } from "@/lib/storefront/theme-doc";
import type { RenderCtx, SectionProps } from "../render-context";
import { CartPage } from "../cart-page";
import type { CartConfig } from "../cart-contents";
import { headingClass, SectionShell } from "../ui";

export function cartConfig(ctx: RenderCtx): CartConfig {
  const s = ctx.data.store;
  // Réglages lot 1 de la section « Panier » (modèle cart), partagés avec le tiroir. Absents : valeurs par défaut.
  const cartTpl = ctx.doc.templates.cart;
  const main = cartTpl ? Object.values(cartTpl.sections).find((x) => x.type === "main-cart") : undefined;
  const st = main?.settings ?? {};
  const promos = ctx.data.promotions;
  return {
    showOffers: S.bool(st, "show_offers", true),
    showTierProgress: S.bool(st, "show_tier_progress", true),
    showGiftCardField: S.bool(st, "show_gift_card_field", false),
    tiers: promos?.cartTiers ?? [],
    giftCardsEnabled: promos?.giftCardsEnabled ?? false,
    cartOffersEnabled: promos?.cartOffersEnabled ?? false,
    slug: s.slug,
    currency: s.currency,
    // Lot 2 (devises) : devise d'affichage de l'acheteur (page panier et tiroir).
    view: ctx.data.currency ?? null,
    closed: s.closed,
    ctaLabel: s.booking ? "Réserver" : "Commander",
    freeShippingFrom: s.deliveryEnabled ? s.freeShippingFrom : null,
    showFreeShipping: ctx.settings.cart.freeShippingBar,
    showNote: ctx.settings.cart.showNote,
    loyaltyPer1000: s.loyalty?.pointsPer1000 ?? null,
  };
}

export default function MainCart({ section, ctx }: SectionProps) {
  return (
    <SectionShell section={section} ctx={ctx} padded={false} className="pb-14 pt-6 sm:pt-10">
      <h1 className={headingClass("lg") + " mb-8"}>Votre panier</h1>
      <CartPage cfg={cartConfig(ctx)} showNote={S.bool(section.settings, "show_note", true) && ctx.settings.cart.showNote} />
    </SectionShell>
  );
}

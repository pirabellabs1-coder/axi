import { S } from "@/lib/storefront/theme-doc";
import type { SectionProps } from "../render-context";
import { SectionShell } from "../ui";
import { CartProgressBar } from "../promotions/cart-progress-bar";

/**
 * Lot 1 : « Barre d'offres » (modèles accueil et panier). Progression du panier local vers les paliers de remise
 * actifs (CART_TIER). Rien n'est affiché sans palier ; dans l'éditeur, un palier d'exemple illustre le rendu.
 */
export default function CartProgress({ section, ctx }: SectionProps) {
  const store = ctx.data.store;
  const tiers = ctx.data.promotions?.cartTiers?.length ? ctx.data.promotions.cartTiers : ctx.preview ? [{ minSubtotal: 20_000, label: "−5 %" }, { minSubtotal: 50_000, label: "−10 %" }] : [];
  if (tiers.length === 0) return null;
  const heading = S.str(section.settings, "heading").trim();
  return (
    <SectionShell section={section} ctx={ctx} label={heading || "Offres en cours"}>
      <div className="mx-auto max-w-[720px]">
        {heading && <h2 className="sf-heading mb-3 text-center text-[calc(1.25rem*var(--store-scale))] text-ink">{heading}</h2>}
        <CartProgressBar slug={store.slug} tiers={tiers} currency={store.currency} view={ctx.data.currency} emptyText={S.str(section.settings, "empty_text")} hideWhenEmpty={S.bool(section.settings, "hide_when_empty", false) && !ctx.preview} />
      </div>
    </SectionShell>
  );
}

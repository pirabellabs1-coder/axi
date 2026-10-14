import type { Metadata } from "next";
import Link from "next/link";
import { Heart } from "lucide-react";
import { db } from "@/lib/db";
import { getAccountPage } from "@/lib/buyer/account";
import { MAX_FAVORITES } from "@/lib/buyer/otp";
import { effectivePrice } from "@/lib/commerce/pricing";
import { productImages } from "@/lib/storefront/data";
import { formatMoney } from "@/lib/money";
import { requestCurrencyView } from "@/lib/storefront/currency-context";
import { chargeNotice, viewCompareAt, viewCurrency, viewPrice } from "@/lib/storefront/currency-view";
import { AccountCard, AccountShell } from "@/components/storefront/account/account-shell";
import { AccountDisabled } from "@/components/storefront/account/account-disabled";
import { FavoriteButton } from "@/components/storefront/account/favorite-button";
import { ProductImage } from "@/components/storefront/product-image";

export const metadata: Metadata = { title: "Mes favoris", robots: { index: false, follow: false } };

export default async function AccountFavorites({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountPage(slug, `/s/${slug}/compte/favoris`);
  if (ctx.state === "disabled") return <AccountDisabled slug={ctx.store.slug} />;
  const { store, buyer, readOnly } = ctx;
  // Produit archivé ou brouillon : masqué, le favori est conservé (il réapparaît si le produit revient).
  const favorites = await db.customerFavorite.findMany({
    where: { storeId: store.id, customerId: buyer.customerId, product: { status: "ACTIVE", storeId: store.id } },
    orderBy: { createdAt: "desc" },
    take: MAX_FAVORITES,
    select: { id: true, product: { select: { id: true, name: true, slug: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, compareAtPrice: true, images: true } } },
  });
  const now = new Date();
  // Lot 2 (devises) : prix affichés dans la devise choisie par l'acheteur (montants encaissés en devise boutique).
  const view = await requestCurrencyView(store);
  const notice = chargeNotice(view);

  return (
    <AccountShell slug={store.slug} active="favorites" title="Mes favoris" description="Les produits que vous avez gardés de côté." readOnlyNotice={readOnly}>
      {favorites.length === 0 ? (
        <AccountCard className="flex flex-col items-center py-12 text-center">
          <span className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink">
            <Heart className="size-6" aria-hidden />
          </span>
          <p className="text-base font-semibold text-ink">Aucun favori pour le moment</p>
          <p className="mt-1 max-w-[44ch] text-sm text-ink-muted">Touchez le cœur d&apos;un produit pour le retrouver ici.</p>
          <Link href={`/s/${store.slug}/catalogue`} className="sf-btn sf-btn-solid mt-5 h-12 px-6 text-[15px]">
            Parcourir le catalogue
          </Link>
        </AccountCard>
      ) : (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4" aria-label="Produits favoris">
          {favorites.map(({ id, product: p }) => {
            const price = effectivePrice(p, now);
            const compare = price.isPromo ? p.price : p.compareAtPrice && p.compareAtPrice > price.price ? p.compareAtPrice : null;
            const img = productImages(p.images)[0];
            const shown = viewPrice(view, price.price, p.id);
            const shownCompare = viewCompareAt(view, compare, shown, p.id);
            return (
              <li key={id} className="group relative">
                <Link href={`/s/${store.slug}/p/${p.slug}`} className="block focus-visible:outline-none">
                  <ProductImage src={img?.url} alt={img?.alt || p.name} className="rounded-[var(--store-card-radius,20px)]" />
                  <p className="mt-3 line-clamp-2 text-[15px] font-medium text-ink group-hover:underline group-focus-visible:underline">{p.name}</p>
                  <p className="mt-1 text-sm">
                    <span className="font-semibold tabular-nums text-ink">{formatMoney(shown, viewCurrency(view))}</span>
                    {shownCompare != null && <span className="ml-2 text-ink-muted line-through tabular-nums">{formatMoney(shownCompare, viewCurrency(view))}</span>}
                  </p>
                </Link>
                {!readOnly && <FavoriteButton slug={store.slug} productId={p.id} productName={p.name} initial className="absolute right-2.5 top-2.5" size="sm" />}
              </li>
            );
          })}
        </ul>
      )}
      {notice && <p className="mt-6 text-xs text-ink-muted">{notice}</p>}
    </AccountShell>
  );
}

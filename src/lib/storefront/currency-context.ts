import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { currencyPickerData, getDisplayCurrency, type CurrencyPickerData, type DisplayCurrency } from "@/lib/currency/display";
import { currencyView, storeCurrencyView, type CurrencyView, type FixedPrice } from "./currency-view";

/**
 * Devise d'affichage de la requête courante (cookie `axi_cur`), chargée UNE SEULE FOIS par requête et par boutique :
 * le rendu de la vitrine (cartes, fiche, collections, recherche, panier, sections de thème) et le sélecteur de
 * l'en-tête lisent le même contexte. Toute erreur (taux indisponible, devise désactivée) retombe silencieusement
 * sur la devise de la boutique.
 */
type FxStore = Parameters<typeof getDisplayCurrency>[0];

/** Un emplacement par boutique et par requête (React `cache` : mémoire propre à la requête). */
const slot = cache((storeId: string) => ({ storeId }) as { storeId: string; display?: Promise<DisplayCurrency | null>; view?: Promise<CurrencyView> });

/** Plafond de prix fixés chargés pour l'affichage (une boutique n'en définit qu'une poignée). */
const FIXED_PRICE_CAP = 500;

export function requestDisplayCurrency(store: FxStore): Promise<DisplayCurrency | null> {
  const s = slot(store.id);
  return (s.display ??= getDisplayCurrency(store).catch(() => null));
}

/** Vue sérialisable passée au rendu (`RenderData.currency`). */
export function requestCurrencyView(store: FxStore): Promise<CurrencyView> {
  const s = slot(store.id);
  return (s.view ??= buildView(store));
}

async function buildView(store: FxStore): Promise<CurrencyView> {
  const d = await requestDisplayCurrency(store);
  if (!d || !d.fx || d.currency === d.storeCurrency) return storeCurrencyView(store.currency);
  const fixed = await loadFixedPrices(store.id, d.currency);
  return currencyView(d.storeCurrency, d.currency, d.fx, fixed);
}

/** Prix fixés de la boutique dans la devise affichée (`ProductPrice`), par `variantId ?? productId`. */
async function loadFixedPrices(storeId: string, currency: string): Promise<Record<string, FixedPrice>> {
  try {
    const rows = await db.productPrice.findMany({
      where: { storeId, currency },
      select: { itemKey: true, price: true, compareAtPrice: true },
      take: FIXED_PRICE_CAP,
    });
    const out: Record<string, FixedPrice> = {};
    for (const r of rows) out[r.itemKey] = { price: r.price, ...(r.compareAtPrice != null ? { compareAt: r.compareAtPrice } : {}) };
    return out;
  } catch {
    return {};
  }
}

/** Données du sélecteur de devise de l'en-tête, sans recharger le contexte. */
export async function requestCurrencyPicker(store: FxStore): Promise<CurrencyPickerData | null> {
  const d = await requestDisplayCurrency(store);
  return d ? currencyPickerData(d) : null;
}

import "server-only";
import type { Prisma, Subscription } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import type { TaxSettingsInput } from "@/lib/tax/compute";
import { taxSettingsOrNull, type TaxStoreRow } from "@/lib/tax/settings";
import { quoteFromFx, readQuote, type FxContext } from "@/lib/currency/convert";
import { presentCart, type PresentedCart } from "@/lib/currency/present";
import { loadStoreFx } from "@/lib/currency/rates";
import { currencyName } from "@/lib/currency/pick";
import type { PricedCart } from "./checkout-pipeline";

/**
 * Contexte de prix du checkout au-delà du lot 1 (lot 2) : réglages de taxes, devise d'affichage et cotation
 * verrouillée, prix fixés par devise. Partagé par `previewTotals` (aperçu) et `createOrder` (commande) pour que
 * l'acheteur voie EXACTEMENT ce qui sera enregistré. Toutes les lectures sont filtrées par `storeId`.
 */

type Db = Tx | typeof db;

/**
 * Réglages de taxes de la boutique pour le pipeline. SOURCE UNIQUE : `src/lib/tax/settings.ts`, qui honore le
 * régime fiscal (TPS = aucune taxe), le contrôle de plan (`features.taxes`) et la normalisation du pays.
 * null = aucune taxe collectée.
 */
export async function loadTaxSettings(client: Db, store: TaxStoreRow): Promise<TaxSettingsInput | null> {
  return taxSettingsOrNull(client, store);
}

export const GIFT_CARD_FOREIGN_MESSAGE = "Les cartes cadeaux s'utilisent uniquement dans la devise de la boutique. Affichez les prix en {base} pour utiliser votre carte.";

export function giftCardForeignMessage(storeCurrency: string): string {
  return GIFT_CARD_FOREIGN_MESSAGE.replace("{base}", storeCurrency === "XOF" || storeCurrency === "XAF" ? "FCFA" : storeCurrency);
}

export type DisplayResolution = {
  /** Contexte de conversion retenu ; null = affichage en devise boutique. */
  fx: FxContext | null;
  /** Message de repli (devise désactivée ou taux périmé pendant le checkout). */
  fallback: string | null;
};

/**
 * Devise d'affichage pour un checkout : la cotation du panier (Cart.fxQuote) si elle est encore valide (15 min),
 * sinon le taux courant, alors enregistré comme nouvelle cotation si un panier serveur existe (`persist`).
 * Devise désactivée, hors plan ou taux > 72 h : repli sur la devise de la boutique, avec message.
 */
export async function resolveDisplayFx(
  client: Db,
  p: { store: { id: string; currency: string; subscription?: Subscription | null }; currency: string | null | undefined; cartToken?: string | null; now: Date; persist: boolean },
): Promise<DisplayResolution> {
  const { store, currency, now } = p;
  if (!currency || currency === store.currency) return { fx: null, fallback: null };
  // Lectures dans la transaction de l'appelant ; aucune planification paresseuse de `fx.refresh` ici
  // (elle ouvrirait une seconde transaction depuis l'intérieur de celle du checkout).
  const state = await loadStoreFx(store, now, { client, schedule: false });
  const live = state.contexts.get(currency) ?? null;
  if (!live) return { fx: null, fallback: `L'affichage en ${currencyName(currency)} n'est plus disponible : les montants sont indiqués en devise de la boutique.` };
  if (!p.cartToken) return { fx: live, fallback: null };
  const cart = await client.cart.findFirst({ where: { token: p.cartToken, storeId: store.id, convertedOrderId: null }, select: { id: true, fxQuote: true } });
  if (!cart) return { fx: live, fallback: null };
  const locked = readQuote(cart.fxQuote, store.currency, currency, now);
  if (locked) return { fx: locked, fallback: null };
  if (p.persist) await client.cart.update({ where: { id: cart.id }, data: { fxQuote: quoteFromFx(live, now) as unknown as Prisma.InputJsonValue } });
  return { fx: live, fallback: null };
}

/** Prix fixés (ProductPrice) par ligne : clé `variantId ?? productId`, devise d'affichage, boutique. */
export async function loadFixedPrices(client: Db, storeId: string, currency: string, lines: readonly { productId: string; variantId?: string | null }[]): Promise<(number | null)[]> {
  const keys = [...new Set(lines.map((l) => l.variantId ?? l.productId))];
  if (keys.length === 0) return [];
  const rows = await client.productPrice.findMany({ where: { storeId, currency, itemKey: { in: keys } }, select: { itemKey: true, price: true } });
  const byKey = new Map(rows.map((r) => [r.itemKey, r.price]));
  return lines.map((l) => byKey.get(l.variantId ?? l.productId) ?? null);
}

/** Présentation complète d'un panier calculé dans la devise d'affichage (null si pas de conversion). */
export async function presentFor(client: Db, storeId: string, priced: PricedCart, fx: FxContext | null, tax: TaxSettingsInput | null): Promise<PresentedCart | null> {
  if (!fx) return null;
  const fixedUnitPrices = await loadFixedPrices(client, storeId, fx.quote, priced.lines);
  return presentCart(priced, fx, { fixedUnitPrices, tax });
}

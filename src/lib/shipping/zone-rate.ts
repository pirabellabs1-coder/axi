import "server-only";
import type { db, Tx } from "@/lib/db";
import { chooseShippingFee, orderWeightGrams, type ShippingChoice, type ShippingRateLike, type ZoneFallback } from "./rates";

/**
 * Tarifs d'expédition d'une zone appliqués à un panier (lot 3 §1.2) : lecture des tarifs actifs de la
 * zone, poids de la commande et choix du tarif applicable le moins cher (`chooseShippingFee`, pur).
 *
 * SOURCE UNIQUE des frais de livraison pour `previewTotals` (affichage) et `createOrder` (encaissement) :
 * l'acheteur voit exactement ce qui sera facturé.
 *
 * Une zone SANS tarif actif renvoie `source: "zone"` : l'appelant conserve alors son forfait
 * `DeliveryZone.fee` / `freeAbove` tel quel (compatibilité, aucune régression).
 */

type Db = Tx | typeof db;

/** Ligne du panier telle que vue par les tarifs (même règle que le pipeline pour « expédiée »). */
export type ShippingCartLine = {
  productId: string;
  variantId?: string | null;
  quantity: number;
  isGiftCard: boolean;
  kind?: string | null;
  /** Net de la ligne après remises automatiques et coupon, AVANT fidélité (§0.2-6). */
  netTotal: number;
};

/** Ni carte cadeau, ni produit numérique, ni service : seules ces lignes sont expédiées (et pesées). */
export function isShippedLine(l: { isGiftCard: boolean; kind?: string | null }): boolean {
  return !l.isGiftCard && (l.kind ?? "PHYSICAL") === "PHYSICAL";
}

/** Sous-total retenu par les tarifs : net des seules lignes expédiées. */
export function shippingSubtotalNet(lines: readonly ShippingCartLine[]): number {
  return lines.reduce((s, l) => s + (isShippedLine(l) ? Math.max(0, l.netTotal) : 0), 0);
}

export type ZoneShippingChoice = ShippingChoice & { missingWeight: number };

export async function chooseZoneShipping(
  client: Db,
  p: { storeId: string; zoneId: string; zone: ZoneFallback; lines: readonly ShippingCartLine[] },
): Promise<ZoneShippingChoice> {
  const subtotalNet = shippingSubtotalNet(p.lines);
  const rates: ShippingRateLike[] = await client.shippingRate.findMany({
    where: { storeId: p.storeId, zoneId: p.zoneId, active: true },
    select: {
      id: true,
      name: true,
      minWeightGrams: true,
      maxWeightGrams: true,
      minSubtotal: true,
      maxSubtotal: true,
      price: true,
      freeAbove: true,
      etaLabel: true,
      active: true,
      position: true,
      carrierAccountId: true,
    },
    take: 100,
  });
  if (!rates.length) {
    // Aucun tarif : comportement historique (forfait de zone), sans même peser la commande.
    return { ...chooseShippingFee([], p.zone, { weightGrams: 0, subtotalNet }), missingWeight: 0 };
  }

  // Poids : variante, sinon produit, sinon 0 avec avertissement au commerçant.
  const productIds = [...new Set(p.lines.map((l) => l.productId))];
  const rows = await client.product.findMany({
    where: { id: { in: productIds }, storeId: p.storeId },
    select: { id: true, weightGrams: true, variants: { select: { id: true, weightGrams: true } } },
  });
  const weight = orderWeightGrams(
    p.lines.map((l) => {
      const row = rows.find((x) => x.id === l.productId);
      return {
        quantity: l.quantity,
        variantWeightGrams: l.variantId ? (row?.variants.find((v) => v.id === l.variantId)?.weightGrams ?? null) : null,
        productWeightGrams: row?.weightGrams ?? null,
        shippable: isShippedLine(l),
      };
    }),
  );
  return { ...chooseShippingFee(rates, p.zone, { weightGrams: weight.grams, subtotalNet }), missingWeight: weight.missingWeight };
}

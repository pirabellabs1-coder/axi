import "server-only";
import type { Tx } from "@/lib/db";
import { allocateLocations, allocatedByLine, type AllocationLine, type LocationAvailability } from "./allocate";
import { applyLevelDeltaTx, groupByLocation, itemKeyOf, levelsFor } from "./levels";

/**
 * Pont entre les commandes et le stock par dépôt (lot 3 §1.1).
 *
 * Le checkout (`src/lib/commerce/**`) reste la référence de disponibilité sur le stock AGRÉGÉ : il le
 * décrémente de façon conditionnelle (politique DENY / CONTINUE). Ce module se charge, DANS LA MÊME
 * TRANSACTION, de la contrepartie par dépôt :
 *  - `planOrderAllocation` : quel dépôt sert quelle ligne (fonction pure `allocateLocations` + lecture des niveaux) ;
 *  - `creditOrderLevelsTx` : restitution des niveaux à l'annulation et au retour, attribuée aux dépôts qui
 *    ont servi la vente (les mouvements positifs écrits par l'appelant reçoivent leur `locationId`).
 * Une boutique sans dépôt (antérieure au lot 3, non migrée) traverse ces fonctions sans effet : aucune
 * régression du checkout, l'agrégat reste seul à faire foi.
 */

export type OrderLineForAllocation = {
  lineId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  trackStock: boolean;
};

export type OrderAllocation = { lineId: string; locationId: string; quantity: number };

/** Dépôts actifs d'une boutique et niveaux des articles concernés, prêts pour `allocateLocations`. */
export async function planOrderAllocation(
  tx: Tx,
  p: { storeId: string; lines: readonly OrderLineForAllocation[]; zoneLocationId?: string | null; pickupLocationId?: string | null },
): Promise<{ allocations: OrderAllocation[]; defaultLocationId: string | null }> {
  const tracked = p.lines.filter((l) => l.trackStock && l.quantity > 0);
  const locations = await tx.location.findMany({
    where: { storeId: p.storeId, active: true },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }, { createdAt: "asc" }],
    select: { id: true, isDefault: true, fulfillsOnlineOrders: true },
  });
  if (!locations.length) return { allocations: [], defaultLocationId: null };
  const defaultLocationId = locations.find((l) => l.isDefault)?.id ?? locations[0].id;
  if (!tracked.length) return { allocations: [], defaultLocationId };

  const itemKeys = [...new Set(tracked.map((l) => itemKeyOf(l.productId, l.variantId)))];
  const levels = groupByLocation(await levelsFor(p.storeId, itemKeys, tx));
  const availability: LocationAvailability[] = locations.map((l) => ({
    locationId: l.id,
    available: levels.get(l.id) ?? new Map<string, number>(),
    fulfillsOnlineOrders: l.fulfillsOnlineOrders,
  }));
  const lines: AllocationLine[] = tracked.map((l) => ({ lineId: l.lineId, itemKey: itemKeyOf(l.productId, l.variantId), quantity: l.quantity, trackStock: true }));
  const allocations = allocateLocations(lines, availability, {
    zoneLocationId: p.zoneLocationId ?? null,
    pickupLocationId: p.pickupLocationId ?? null,
    defaultLocationId,
  });
  // Invariant : chaque ligne suivie est entièrement affectée.
  const byLine = allocatedByLine(allocations);
  for (const l of lines) {
    if ((byLine.get(l.lineId) ?? 0) !== l.quantity) throw new Error("Affectation des dépôts incohérente");
  }
  return { allocations, defaultLocationId };
}

/*
 * Mineur n° 14 : `applyOrderAllocationTx` a été SUPPRIMÉ (code mort). Le décrément des niveaux à la
 * vente est écrit par `createOrderItemsTx` (checkout-lines.ts), au même endroit que les mouvements
 * `SALE` : conserver une seconde porte d'entrée exposait à un double décrément.
 */

/**
 * Restitue `quantity` unités aux dépôts qui ont servi la vente (annulation, retour).
 * `movementId` est le mouvement positif déjà écrit par l'appelant (CANCEL / RETURN) : il reçoit le
 * `locationId` de la première part ; les parts suivantes donnent lieu à des mouvements de même nature,
 * de sorte que l'historique reste entièrement attribué à un dépôt (réconciliation fiable).
 */
export async function creditOrderLevelsTx(
  tx: Tx,
  p: { storeId: string; orderId: string; productId: string; variantId: string | null; quantity: number; movementId: string },
): Promise<void> {
  if (p.quantity <= 0) return;
  const moves = await tx.inventoryMovement.findMany({
    where: { storeId: p.storeId, orderId: p.orderId, productId: p.productId, variantId: p.variantId, locationId: { not: null } },
    select: { id: true, locationId: true, delta: true },
  });
  // Reste dû par dépôt : ce que la vente a retiré, net de ce qui a déjà été rendu (le mouvement courant exclu).
  const outstanding = new Map<string, number>();
  for (const m of moves) {
    if (m.id === p.movementId || !m.locationId) continue;
    outstanding.set(m.locationId, (outstanding.get(m.locationId) ?? 0) - m.delta);
  }
  const shares = [...outstanding.entries()]
    .filter(([, qty]) => qty > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!shares.length) return; // vente antérieure aux dépôts : rien à attribuer

  let left = p.quantity;
  const applied: { locationId: string; quantity: number }[] = [];
  for (const [locationId, qty] of shares) {
    if (left <= 0) break;
    const take = Math.min(qty, left);
    applied.push({ locationId, quantity: take });
    left -= take;
  }
  // Reliquat (survente rendue au-delà de ce que les dépôts avaient fourni) : porté par le premier dépôt.
  if (left > 0 && applied.length) applied[0].quantity += left;

  for (const [index, part] of applied.entries()) {
    await applyLevelDeltaTx(tx, { storeId: p.storeId, locationId: part.locationId, productId: p.productId, variantId: p.variantId, delta: part.quantity });
    if (index === 0) {
      await tx.inventoryMovement.update({ where: { id: p.movementId }, data: { locationId: part.locationId, delta: part.quantity } });
    } else {
      const origin = await tx.inventoryMovement.findUnique({ where: { id: p.movementId }, select: { reason: true, note: true, actorId: true } });
      await tx.inventoryMovement.create({
        data: {
          storeId: p.storeId,
          productId: p.productId,
          variantId: p.variantId,
          locationId: part.locationId,
          delta: part.quantity,
          reason: origin?.reason ?? "CANCEL",
          note: origin?.note ?? null,
          orderId: p.orderId,
          actorId: origin?.actorId ?? null,
        },
      });
    }
  }
}

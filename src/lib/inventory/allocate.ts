/**
 * Affectation d'une commande aux dépôts — module PUR (testé : tests/inventory-allocate.test.ts).
 *
 * Priorités par ligne (spec lot 3 §1.1) :
 *   1. dépôt de la zone de livraison (`DeliveryZone.locationId`) s'il couvre la quantité ;
 *   2. dépôt de retrait choisi (commande en retrait) s'il couvre la quantité ;
 *   3. dépôt par défaut de la boutique s'il couvre la quantité ;
 *   4. dépôt qui couvre le plus.
 * Une ligne peut être répartie entre plusieurs dépôts (du plus fourni au moins fourni, départage par
 * l'ordre de `locations` : déterministe). Si le stock de tous les dépôts ne suffit pas :
 *   - politique CONTINUE : le reliquat est porté par le dépôt préféré, dont le niveau peut devenir négatif ;
 *   - politique DENY : le reliquat est également porté par le dépôt préféré (le refus de vente est décidé en
 *     amont sur le stock AGRÉGÉ, qui reste la référence de disponibilité ; l'affectation ne refuse jamais).
 * L'agrégat n'est jamais modifié ici : `Σ quantités affectées = quantité demandée` (invariant testé).
 */

export type AllocationLine = {
  /** Identifiant de ligne (index ou id d'OrderItem) — repris tel quel dans le résultat. */
  lineId: string;
  /** Clé d'article : `variantId ?? productId` (clé des niveaux de stock). */
  itemKey: string;
  quantity: number;
  /** Article sans suivi de stock : aucune affectation (expédié depuis le dépôt préféré sans mouvement). */
  trackStock?: boolean;
};

export type LocationAvailability = {
  locationId: string;
  /** Stock disponible par clé d'article dans ce dépôt. */
  available: ReadonlyMap<string, number>;
  /** Dépôt capable de servir les commandes en ligne (sinon ignoré, sauf s'il est le dépôt préféré). */
  fulfillsOnlineOrders?: boolean;
};

export type AllocationContext = {
  /** Dépôt de la zone de livraison de la commande. */
  zoneLocationId?: string | null;
  /** Dépôt de retrait choisi par le client. */
  pickupLocationId?: string | null;
  /** Dépôt par défaut de la boutique (toujours fourni en pratique). */
  defaultLocationId?: string | null;
};

export type Allocation = { lineId: string; locationId: string; quantity: number };

function availableIn(loc: LocationAvailability, itemKey: string): number {
  return loc.available.get(itemKey) ?? 0;
}

/** Dépôt préféré d'une ligne, dans l'ordre des priorités, en ne retenant un candidat que s'il couvre la quantité. */
export function preferredLocation(locations: readonly LocationAvailability[], itemKey: string, quantity: number, ctx: AllocationContext): string | null {
  const byId = new Map(locations.map((l) => [l.locationId, l]));
  const candidates = [ctx.zoneLocationId, ctx.pickupLocationId, ctx.defaultLocationId];
  for (const id of candidates) {
    if (!id) continue;
    const loc = byId.get(id);
    if (loc && availableIn(loc, itemKey) >= quantity) return id;
  }
  // 4. dépôt qui couvre le plus (départage : ordre de la liste).
  let best: { id: string; qty: number } | null = null;
  for (const loc of locations) {
    if (loc.fulfillsOnlineOrders === false) continue;
    const qty = availableIn(loc, itemKey);
    if (!best || qty > best.qty) best = { id: loc.locationId, qty };
  }
  if (best && best.qty > 0) return best.id;
  // Aucun dépôt ne détient l'article : repli sur la première priorité déclarée, sinon le premier dépôt.
  return candidates.find((id): id is string => !!id && byId.has(id)) ?? locations[0]?.locationId ?? null;
}

/**
 * Répartit chaque ligne entre les dépôts. Σ des quantités d'une ligne = quantité demandée (ligne suivie),
 * ou aucune allocation si l'article n'est pas suivi en stock.
 */
export function allocateLocations(lines: readonly AllocationLine[], locations: readonly LocationAvailability[], ctx: AllocationContext = {}): Allocation[] {
  if (locations.length === 0) return [];
  // Copie de travail : une ligne consomme le stock vu par les lignes suivantes (deux lignes du même article).
  const remaining = new Map<string, Map<string, number>>();
  for (const loc of locations) remaining.set(loc.locationId, new Map(loc.available));
  const view = (): LocationAvailability[] => locations.map((l) => ({ ...l, available: remaining.get(l.locationId)! }));

  const out: Allocation[] = [];
  for (const line of lines) {
    if (line.trackStock === false || line.quantity <= 0) continue;
    const snapshot = view();
    const preferred = preferredLocation(snapshot, line.itemKey, line.quantity, ctx);
    if (!preferred) continue;
    let left = line.quantity;
    const take = (locationId: string, qty: number) => {
      if (qty <= 0) return;
      const map = remaining.get(locationId)!;
      map.set(line.itemKey, (map.get(line.itemKey) ?? 0) - qty);
      const existing = out.find((a) => a.lineId === line.lineId && a.locationId === locationId);
      if (existing) existing.quantity += qty;
      else out.push({ lineId: line.lineId, locationId, quantity: qty });
      left -= qty;
    };

    // 1. le dépôt préféré d'abord, dans la limite de son stock.
    const prefAvail = Math.max(0, remaining.get(preferred)?.get(line.itemKey) ?? 0);
    take(preferred, Math.min(prefAvail, left));

    // 2. complément : dépôts restants, du plus fourni au moins fourni (ordre de la liste en cas d'égalité).
    if (left > 0) {
      const others = snapshot
        .filter((l) => l.locationId !== preferred && l.fulfillsOnlineOrders !== false)
        .map((l, index) => ({ id: l.locationId, qty: Math.max(0, remaining.get(l.locationId)?.get(line.itemKey) ?? 0), index }))
        .filter((l) => l.qty > 0)
        .sort((a, b) => b.qty - a.qty || a.index - b.index);
      for (const o of others) {
        if (left <= 0) break;
        take(o.id, Math.min(o.qty, left));
      }
    }

    // 3. reliquat (stock insuffisant partout) : porté par le dépôt préféré, qui peut devenir négatif.
    if (left > 0) take(preferred, left);
  }
  return out;
}

/** Σ des quantités affectées par ligne (contrôle d'invariant, utilisé par les tests et les services). */
export function allocatedByLine(allocations: readonly Allocation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of allocations) m.set(a.lineId, (m.get(a.lineId) ?? 0) + a.quantity);
  return m;
}

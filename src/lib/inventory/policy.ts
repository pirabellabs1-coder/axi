/**
 * Règles d'inventaire façon Shopify — module PUR (client + serveur), testé dans tests/inventory-policy.test.ts.
 *
 *  - Politique de rupture (`InventoryPolicy`) : DENY refuse la vente au-delà du stock ; CONTINUE l'autorise
 *    (précommande / expédition différée), le stock peut alors devenir négatif (« survente »).
 *    Produit sans variante : politique du produit ; avec variantes : politique de chaque variante.
 *  - Seuil « stock bas » : seuil du produit, sinon seuil par défaut de la boutique, sinon 5.
 *  - Franchissements : une alerte par passage sous le seuil (et une par passage en négatif), reconstitués à partir
 *    du stock courant et des mouvements d'inventaire (idempotent : la clé = id du mouvement qui a franchi).
 */

export type InventoryPolicyValue = "DENY" | "CONTINUE";

export const INVENTORY_POLICIES: readonly InventoryPolicyValue[] = ["DENY", "CONTINUE"] as const;

/** Seuil par défaut quand ni le produit ni la boutique n'en définissent. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const MAX_LOW_STOCK_THRESHOLD = 100_000;

/** Libellés vitrine (fixes) d'un article vendu en rupture. */
export const BACKORDER_LABEL = "Précommande";
export const BACKORDER_HINT = "Expédition différée : l'article est commandé auprès de notre fournisseur.";

export function isContinue(policy: string | null | undefined): boolean {
  return policy === "CONTINUE";
}

/** Normalise une saisie (CSV Shopify « deny/continue », français, booléens) ; null si illisible ou vide. */
export function parseInventoryPolicy(raw: string | null | undefined): InventoryPolicyValue | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["continue", "continuer", "oui", "yes", "true", "1", "précommande", "precommande", "vendre"].includes(s)) return "CONTINUE";
  if (["deny", "refuser", "bloquer", "non", "no", "false", "0"].includes(s)) return "DENY";
  return null;
}

/** Format d'export compatible Shopify. */
export function policyToCsv(policy: string | null | undefined): "deny" | "continue" {
  return isContinue(policy) ? "continue" : "deny";
}

/** Seuil effectif : produit, sinon boutique, sinon défaut. */
export function effectiveLowStockThreshold(productThreshold: number | null | undefined, storeThreshold?: number | null): number {
  if (productThreshold != null && Number.isInteger(productThreshold) && productThreshold >= 0) return productThreshold;
  if (storeThreshold != null && Number.isInteger(storeThreshold) && storeThreshold >= 0) return storeThreshold;
  return DEFAULT_LOW_STOCK_THRESHOLD;
}

export type StockItem = { trackStock: boolean; stock: number; policy?: string | null };

/** La quantité demandée peut-elle être vendue (stock + politique) ? */
export function canSell(item: StockItem, quantity: number): boolean {
  if (!item.trackStock) return true;
  if (isContinue(item.policy)) return true;
  return quantity <= item.stock;
}

/** Article achetable (au moins une unité) : non suivi, en stock, ou vendable en rupture. */
export function isSellable(item: StockItem): boolean {
  return canSell(item, 1);
}

/** Vendu en précommande : suivi, plus de stock disponible, mais politique CONTINUE. */
export function isBackorder(item: StockItem, quantity = 1): boolean {
  return item.trackStock && isContinue(item.policy) && item.stock < quantity;
}

export type StockState = "untracked" | "in_stock" | "low" | "out" | "backorder" | "oversold";

/**
 * État d'un article pour l'espace marchand :
 *  oversold (stock < 0) > backorder (≤ 0, CONTINUE) > out (≤ 0) > low (≤ seuil) > in_stock.
 */
export function stockState(item: StockItem, threshold: number): StockState {
  if (!item.trackStock) return "untracked";
  if (item.stock < 0) return "oversold";
  if (item.stock <= 0) return isContinue(item.policy) ? "backorder" : "out";
  if (item.stock <= threshold) return "low";
  return "in_stock";
}

/** « Stock bas » au sens des filtres et alertes : stock ≤ seuil (ruptures et surventes incluses). */
export function isLowStock(item: StockItem, threshold: number): boolean {
  return item.trackStock && item.stock <= threshold;
}

/** Disponibilité schema.org (données structurées de la fiche produit). */
export function schemaAvailability(state: { sellable: boolean; backorder: boolean }): string {
  if (!state.sellable) return "https://schema.org/OutOfStock";
  return state.backorder ? "https://schema.org/BackOrder" : "https://schema.org/InStock";
}

/* ───────────────────────── Franchissements de seuil ───────────────────────── */

/** Le passage `before → after` franchit-il le seuil « stock bas » vers le bas ? (au-dessus → au plus le seuil) */
export function crossesLowStock(before: number, after: number, threshold: number): boolean {
  return before > threshold && after <= threshold;
}

/** Le passage `before → after` fait-il entrer en survente (stock négatif) ? */
export function crossesOversold(before: number, after: number): boolean {
  return before >= 0 && after < 0;
}

export type Move = { id: string; delta: number; createdAt?: Date | string | null };
export type CrossingOpts = {
  /**
   * Dernier changement du seuil applicable : un mouvement antérieur (ou contemporain) n'est jamais retenu comme
   * franchissement. Relever un seuil ne déclenche donc pas d'alerte pour des passages anciens.
   */
  since?: Date | null;
};

/**
 * Retrouve le mouvement qui a fait franchir la condition, en remontant l'historique depuis le stock courant.
 * `movements` : du plus récent au plus ancien (delta signé). Renvoie le mouvement de franchissement le plus récent et le
 * stock juste après lui, ou null si la condition n'est pas remplie aujourd'hui, si aucun mouvement de l'historique fourni
 * ne l'a fait basculer (article déjà sous le seuil à sa création, franchissement plus ancien que la fenêtre examinée),
 * ou si le franchissement précède le dernier changement de seuil (`since`). Seul un VRAI passage déclenche une alerte ;
 * l'article reste visible dans les listes « stock bas ». Même entrée → même clé : un balayage répété ne crée pas de doublon.
 */
export function findCrossingDetail(currentStock: number, movements: Move[], test: (stock: number) => boolean, opts: CrossingOpts = {}): { id: string; after: number } | null {
  if (!test(currentStock)) return null;
  const since = opts.since ? new Date(opts.since).getTime() : null;
  let after = currentStock;
  for (const m of movements) {
    if (since != null && m.createdAt != null && new Date(m.createdAt).getTime() <= since) return null;
    const before = after - m.delta;
    if (!test(before) && test(after)) return { id: m.id, after };
    after = before;
  }
  return null;
}

export function findCrossing(currentStock: number, movements: Move[], test: (stock: number) => boolean, opts: CrossingOpts = {}): string | null {
  return findCrossingDetail(currentStock, movements, test, opts)?.id ?? null;
}

/**
 * Clé de franchissement « stock bas » (null si le stock n'est pas bas ou sans passage identifiable depuis `since`).
 * Un passage dont le mouvement a directement rendu le stock NÉGATIF n'est pas un « stock bas » : seule l'alerte
 * « survente » le signale.
 */
export function lowStockCrossing(currentStock: number, movements: Move[], threshold: number, opts: CrossingOpts = {}): string | null {
  const d = findCrossingDetail(currentStock, movements, (s) => s <= threshold, opts);
  return d && d.after >= 0 ? d.id : null;
}

/** Clé de franchissement « survente » (null si le stock n'est pas négatif ou sans passage identifiable). */
export function oversoldCrossing(currentStock: number, movements: Move[]): string | null {
  return findCrossing(currentStock, movements, (s) => s < 0);
}

/**
 * Depuis quand le seuil effectif s'applique : seuil propre au produit → son horodatage ; seuil de la boutique →
 * le plus récent des deux (repasser un produit au seuil boutique est aussi un changement).
 */
export function thresholdSince(product: { lowStockThreshold: number | null; lowStockThresholdChangedAt?: Date | null }, storeChangedAt?: Date | string | null): Date | null {
  const own = product.lowStockThresholdChangedAt ? new Date(product.lowStockThresholdChangedAt) : null;
  if (product.lowStockThreshold != null) return own;
  const store = storeChangedAt ? new Date(storeChangedAt) : null;
  if (!own) return store && !Number.isNaN(store.getTime()) ? store : null;
  if (!store || Number.isNaN(store.getTime())) return own;
  return own > store ? own : store;
}

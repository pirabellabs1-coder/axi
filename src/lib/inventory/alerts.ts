import "server-only";
import { db } from "@/lib/db";
import { getPrefsForStores } from "@/lib/notifications/prefs";
import { notifyStore } from "@/lib/notifications/service";
import { effectiveLowStockThreshold, lowStockCrossing, oversoldCrossing, thresholdSince, type Move } from "./policy";

/**
 * Alertes de stock : franchissement du seuil « stock bas » et passage en survente (stock négatif).
 * Appelé par le balayage des notifications (src/lib/notifications/sweep.ts) pour les articles dont le stock a bougé,
 * et par le balayage des automatisations (déclencheur « Stock bas »).
 */

/* ───────────────────────── Alertes de franchissement ───────────────────────── */

/** Historique examiné pour retrouver le mouvement qui a franchi le seuil. */
const HISTORY = 200;
/** Préfixe de la note du mouvement écrit à la suppression d'une variante (src/lib/products/actions.ts). */
export const DELETED_VARIANT_NOTE = "Variante supprimée";

export type CrossingCheck = { storeId: string; productId: string; variantId: string | null };

/**
 * Pour chaque article dont le stock a bougé : une notification « stock bas » par passage sous le seuil, une notification
 * « survente » par passage en négatif. Clés déterministes (id du mouvement de franchissement) : un balayage répété ou
 * concurrent ne crée jamais de doublon, et un réassort au-dessus du seuil « réarme » l'alerte.
 */
export async function notifyStockCrossings(items: CrossingCheck[]): Promise<number> {
  if (!items.length) return 0;
  const prefs = await getPrefsForStores([...new Set(items.map((m) => m.storeId))]);
  let created = 0;
  const seen = new Set<string>();
  for (const m of items) {
    const id = `${m.productId}:${m.variantId ?? "-"}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = await db.product.findFirst({ where: { id: m.productId, storeId: m.storeId, trackStock: true, status: "ACTIVE" }, select: { id: true, name: true, stock: true, inventoryPolicy: true, lowStockThreshold: true, lowStockThresholdChangedAt: true, _count: { select: { variants: true } } } });
    if (!p) continue;
    let stock = p.stock;
    let name = p.name;
    let policy = p.inventoryPolicy;
    if (m.variantId) {
      const v = await db.variant.findFirst({ where: { id: m.variantId, productId: p.id }, select: { name: true, stock: true, inventoryPolicy: true, available: true } });
      if (!v || !v.available) continue; // variante désactivée : hors vente, pas d'alerte
      stock = v.stock;
      name = `${p.name} (${v.name})`;
      policy = v.inventoryPolicy;
    } else if (p._count.variants > 0) continue; // mouvement d'une variante supprimée
    const storePrefs = prefs.get(m.storeId);
    const threshold = effectiveLowStockThreshold(p.lowStockThreshold, storePrefs?.lowStockThreshold);
    const since = thresholdSince(p, storePrefs?.lowStockThresholdChangedAt);
    if (stock > threshold) continue;

    // Stock et historique lus dans le MÊME instantané : une vente concurrente ne décale pas la reconstitution.
    const snap = await stockSnapshot(m.storeId, p.id, m.variantId);
    if (!snap) continue;
    stock = snap.stock;
    // Stock bas : uniquement un passage postérieur au dernier changement de seuil, et pas un passage direct en négatif.
    const lowKey = lowStockCrossing(stock, snap.moves, threshold, { since });
    const negKey = oversoldCrossing(stock, snap.moves);
    const href = `/app/${m.storeId}/produits/${p.id}`;

    if (negKey) {
      const r = await notifyStore(m.storeId, {
        kind: "stock.oversold",
        key: `stock:${id}:neg:${negKey}`,
        title: `Survente : ${name}`,
        text: `Stock à ${stock} : ${-stock} unité${-stock > 1 ? "s" : ""} vendue${-stock > 1 ? "s" : ""} au-delà du stock (précommande). Réapprovisionnez ou prévenez les clients du délai.`,
        href,
      });
      if (r) created++;
    }
    if (lowKey) {
      const out = stock <= 0;
      const r = await notifyStore(m.storeId, {
        kind: "stock.low",
        key: `stock:${id}:low:${lowKey}`,
        title: out ? `Rupture de stock : ${name}` : `Stock bas : ${name}`,
        text: out
          ? policy === "CONTINUE"
            ? "Plus de stock : l'article reste en vente en précommande (expédition différée)."
            : "L'article n'est plus disponible à la commande."
          : `Plus que ${stock} en stock (seuil : ${threshold}).`,
        href,
      });
      if (r) created++;
    }
  }
  return created;
}

/** Stock courant + derniers mouvements d'un article, lus dans un même instantané (REPEATABLE READ). */
async function stockSnapshot(storeId: string, productId: string, variantId: string | null): Promise<{ stock: number; moves: Move[] } | null> {
  const [item, moves] = await db.$transaction(
    [
      variantId
        ? db.variant.findFirst({ where: { id: variantId, productId, product: { storeId } }, select: { stock: true } })
        : db.product.findFirst({ where: { id: productId, storeId }, select: { stock: true } }),
      db.inventoryMovement.findMany({
        // Produit simple : les mouvements des variantes supprimées (variantId passé à null) ne font pas partie de son historique.
        // (`note: null` explicite : en SQL, NOT (note LIKE …) écarterait aussi les ventes, sans note.)
        // Lot 3 : les mouvements de transfert entre dépôts (TRANSFER / RECEIVE) ne changent pas le stock
        // agrégé ; les inclure fausserait la reconstitution de l'historique (fausses alertes).
        where: { storeId, productId, variantId, reason: { notIn: ["TRANSFER", "RECEIVE"] }, ...(variantId ? {} : { OR: [{ note: null }, { NOT: { note: { startsWith: DELETED_VARIANT_NOTE } } }] }) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: HISTORY,
        select: { id: true, delta: true, createdAt: true },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  return item ? { stock: item.stock, moves } : null;
}

/** Clé de franchissement « stock bas » courante d'un article (automatisations : une exécution par franchissement). */
export async function currentLowStockCrossing(storeId: string, productId: string, variantId: string | null, threshold: number, since: Date | null = null): Promise<string | null> {
  const snap = await stockSnapshot(storeId, productId, variantId);
  if (!snap) return null;
  return lowStockCrossing(snap.stock, snap.moves, threshold, { since });
}

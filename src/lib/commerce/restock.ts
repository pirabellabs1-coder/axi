/**
 * Restock à l'annulation — fonction pure (tests/inventory-policy.test.ts).
 * À partir des mouvements SALE (négatifs) et CANCEL (positifs) d'une commande, quantités encore à rendre par article.
 * Une commande dont le stock n'était pas suivi au moment de la vente n'a aucun mouvement : rien n'est rendu.
 *
 * Variante supprimée depuis la vente : ses mouvements ont perdu leur `variantId` (null). Si la ligne de commande portait
 * une variante (`variantName` en instantané) et qu'aucune ligne « produit simple » n'existe pour ce produit, ces
 * mouvements sont ignorés : on ne gonfle jamais le stock du produit avec les unités d'une variante disparue.
 */
export function restockPlan(
  moves: { productId: string; variantId: string | null; delta: number }[],
  items?: { productId: string | null; variantName: string | null }[],
): { productId: string; variantId: string | null; quantity: number }[] {
  const simpleLine = (productId: string) => !items || items.some((i) => i.productId === productId && i.variantName == null);
  const net = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
  for (const m of moves) {
    if (m.variantId == null && !simpleLine(m.productId)) continue;
    const k = `${m.productId}:${m.variantId ?? "-"}`;
    const cur = net.get(k) ?? { productId: m.productId, variantId: m.variantId, quantity: 0 };
    cur.quantity -= m.delta; // SALE −2 → 2 à rendre ; CANCEL +2 → déjà rendu
    net.set(k, cur);
  }
  return [...net.values()].filter((r) => r.quantity > 0);
}

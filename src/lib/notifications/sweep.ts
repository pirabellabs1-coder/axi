import "server-only";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { notifyStore } from "./service";
import { notifyStockCrossings } from "@/lib/inventory/alerts";

/**
 * Alimente le flux de notifications à partir de ce qui s'est passé depuis le dernier balayage :
 * nouveaux avis, stock bas et survente (mouvements de stock récents), messages non lus, factures à échéance.
 * Chaque notification porte une clé : un double passage ne crée jamais de doublon.
 */

export async function runNotificationSweep(since: Date, now = new Date()) {
  const from = new Date(since.getTime() - 5 * 60_000); // léger recouvrement, les clés évitent les doublons
  let created = 0;
  const bump = (r: unknown) => {
    if (r) created++;
  };

  // Nouveaux avis
  const reviews = await db.review.findMany({ where: { createdAt: { gte: from } }, take: 300, select: { id: true, storeId: true, rating: true, customerName: true, product: { select: { name: true } } } });
  for (const r of reviews) {
    bump(
      await notifyStore(r.storeId, {
        kind: "review.new",
        key: `review:${r.id}`,
        title: `Nouvel avis ${r.rating}/5${r.product ? ` sur ${r.product.name}` : ""}`,
        text: `${r.customerName} a laissé un avis. Relisez-le avant publication.`,
        href: `/app/${r.storeId}/avis`,
      }),
    );
  }

  // Stock bas / survente : uniquement les articles dont le stock a bougé depuis le dernier passage.
  // Une alerte par FRANCHISSEMENT (clé = mouvement qui a fait passer sous le seuil, ou en négatif), pas par semaine.
  // Articles DISTINCTS (boutique, produit, variante) : pas de plafond global qui ferait sauter des articles quand une
  // boutique enchaîne beaucoup de mouvements ; traités par lots.
  const moved = await db.inventoryMovement.groupBy({ by: ["storeId", "productId", "variantId"], where: { createdAt: { gte: from } } });
  for (let i = 0; i < moved.length; i += 200) created += await notifyStockCrossings(moved.slice(i, i + 200));

  // Messages non lus (un regroupement par boutique et par tranche de 10 minutes)
  const convs = await db.conversation.groupBy({ by: ["storeId"], where: { lastMessageAt: { gte: from }, unreadCount: { gt: 0 }, status: { not: "CLOSED" } }, _count: { _all: true } });
  const bucket = now.toISOString().slice(0, 15);
  for (const c of convs) {
    const n = c._count._all;
    bump(
      await notifyStore(c.storeId, {
        kind: "messages.unread",
        key: `msgs:${c.storeId}:${bucket}`,
        title: n > 1 ? `${n} conversations avec de nouveaux messages` : "Nouveau message d'un client",
        text: "Répondez vite : un client qui attend sur WhatsApp commande moins.",
        href: `/app/${c.storeId}/conversations`,
      }),
    );
  }

  // Factures à échéance (3 jours avant) et en retard
  const invoices = await db.invoice.findMany({
    where: { status: "OPEN", dueAt: { lte: new Date(now.getTime() + 3 * 86_400_000) } },
    take: 300,
    select: { id: true, number: true, amount: true, currency: true, dueAt: true, subscription: { select: { storeId: true } } },
  });
  for (const inv of invoices) {
    const late = inv.dueAt < now;
    bump(
      await notifyStore(inv.subscription.storeId, {
        kind: "invoice.due",
        key: `${late ? "invoice-late" : "invoice"}:${inv.id}`,
        title: late ? `Facture ${inv.number} en retard` : `Facture ${inv.number} à régler`,
        text: `${formatMoney(inv.amount, inv.currency)}, échéance le ${inv.dueAt.toLocaleDateString("fr-FR")}. ${late ? "Réglez-la pour garder l'accès à vos fonctions payantes." : "Réglez-la pour éviter toute interruption."}`,
        href: `/app/${inv.subscription.storeId}/abonnement`,
      }),
    );
  }
  return { created };
}

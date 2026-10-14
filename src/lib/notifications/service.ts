import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { getUsage, CREDIT_TYPES } from "@/lib/credits";
import { CREDIT_LABELS } from "@/config/plans";
import type { Capability } from "@/lib/auth/permissions";
import { getSeenAt, getStorePrefs } from "./prefs";
import { countLowStock } from "@/lib/inventory/service";
import { kindOf, type FeedItem, type NotifKind } from "./kinds";

/**
 * Centre de notifications du commerçant.
 *  - flux « Activité » : lignes Notification au canal inapp (créées par les jobs, le balayage,
 *    les crédits, les campagnes, les automatisations) ;
 *  - « À traiter » : compteurs calculés en direct (ce qui attend une action).
 */

type Client = Tx | typeof db;

export type NotifyInput = { kind: NotifKind; title: string; text: string; href?: string | null; key?: string };

/** Ajoute une notification interne. Avec `key`, idempotente (une seule notification par clé). */
export async function notifyStore(storeId: string, n: NotifyInput, client: Client = db) {
  if (n.key) {
    const exists = await client.notification.findFirst({ where: { storeId, channel: "inapp", payload: { path: ["key"], equals: n.key } }, select: { id: true } });
    if (exists) return null;
  }
  return client.notification.create({
    data: {
      storeId,
      channel: "inapp",
      recipient: "store",
      template: `notif.${n.kind}`,
      status: "SENT",
      sentAt: new Date(),
      payload: { title: n.title.slice(0, 140), text: n.text.slice(0, 500), href: n.href ?? null, key: n.key ?? null } as Prisma.InputJsonValue,
    },
  });
}

function hrefOf(storeId: string, template: string, payload: Record<string, unknown>): string | null {
  if (typeof payload.href === "string" && payload.href.startsWith("/app/")) return payload.href;
  if (typeof payload.orderId === "string") return `/app/${storeId}/commandes/${payload.orderId}`;
  if (template.startsWith("credits.")) return `/app/${storeId}/abonnement`;
  if (template.startsWith("campaign.")) return `/app/${storeId}/campagnes`;
  return null;
}

export async function getFeed(storeId: string, opts: { userId: string; limit?: number }): Promise<{ items: FeedItem[]; seenAt: Date }> {
  const [rows, seenAt] = await Promise.all([
    db.notification.findMany({ where: { storeId, channel: "inapp" }, orderBy: { createdAt: "desc" }, take: opts.limit ?? 60 }),
    getSeenAt(storeId, opts.userId),
  ]);
  const items = rows.map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      kind: kindOf(r.template),
      title: typeof p.title === "string" ? p.title : "Notification",
      text: typeof p.text === "string" ? p.text : "",
      href: hrefOf(storeId, r.template, p),
      createdAt: r.createdAt.toISOString(),
      unread: r.createdAt > seenAt,
    };
  });
  return { items, seenAt };
}

export async function unseenCount(storeId: string, userId: string): Promise<number> {
  const seenAt = await getSeenAt(storeId, userId);
  return db.notification.count({ where: { storeId, channel: "inapp", createdAt: { gt: seenAt } } });
}

export type ActionItem = { key: string; kind: NotifKind; label: string; detail: string; count: number; href: string; tone: "warning" | "danger" | "info" };

/** Ce qui attend une action du commerçant, filtré selon son rôle. */
export async function getActionItems(storeId: string, can: (cap: Capability) => boolean): Promise<ActionItem[]> {
  const base = `/app/${storeId}`;
  const now = new Date();
  const prefs = await getStorePrefs(storeId);
  const t = prefs.lowStockThreshold;

  const [newOrders, toVerify, lowItems, pendingReviews, unread, sub] = await Promise.all([
    can("orders.view") ? db.order.count({ where: { storeId, status: "NEW" } }) : 0,
    can("payments.confirm") ? db.order.count({ where: { storeId, paymentStatus: "PENDING", status: { notIn: ["CANCELLED", "REFUNDED"] } } }) : 0,
    // Seuil du produit s'il en a un, sinon celui de la boutique.
    can("products.manage") ? countLowStock(storeId, t) : 0,
    can("products.manage") ? db.review.count({ where: { storeId, status: "PENDING" } }).catch(() => 0) : 0,
    db.conversation.count({ where: { storeId, status: { not: "CLOSED" }, unreadCount: { gt: 0 } } }).catch(() => 0),
    can("billing.manage") ? db.subscription.findUnique({ where: { storeId }, select: { id: true } }) : null,
  ]);

  const items: ActionItem[] = [];
  if (newOrders) items.push({ key: "orders", kind: "order.new", label: "Commandes à confirmer", detail: "Nouvelles commandes en attente de votre confirmation.", count: newOrders, href: `${base}/commandes`, tone: "warning" });
  if (toVerify) items.push({ key: "payments", kind: "payment.verify", label: "Paiements à vérifier", detail: "Mobile Money ou virement déclarés par le client, à confirmer.", count: toVerify, href: `${base}/commandes`, tone: "warning" });
  if (unread) items.push({ key: "messages", kind: "messages.unread", label: "Conversations non lues", detail: "Des clients attendent une réponse sur WhatsApp.", count: unread, href: `${base}/conversations`, tone: "info" });
  if (lowItems) items.push({ key: "stock", kind: "stock.low", label: "Articles en stock bas", detail: `Stock au plus au seuil d'alerte (${t} par défaut, ou celui du produit).`, count: lowItems, href: `${base}/produits/stock?vue=bas`, tone: "danger" });
  if (pendingReviews) items.push({ key: "reviews", kind: "review.new", label: "Avis à modérer", detail: "Nouveaux avis clients en attente de publication.", count: pendingReviews, href: `${base}/avis`, tone: "info" });

  if (can("billing.manage")) {
    for (const type of CREDIT_TYPES) {
      const u = await getUsage(storeId, type).catch(() => null);
      if (u && u.granted > 0 && u.used / u.granted >= 0.8) {
        const pct = Math.min(100, Math.round((u.used / u.granted) * 100));
        items.push({ key: `credits-${type}`, kind: "credits", label: `${CREDIT_LABELS[type]} : ${pct} % consommés`, detail: `Il reste ${u.balance} crédit${u.balance > 1 ? "s" : ""}.`, count: u.balance, href: `${base}/abonnement`, tone: pct >= 100 ? "danger" : "warning" });
      }
    }
    if (sub) {
      const invoice = await db.invoice.findFirst({ where: { subscriptionId: sub.id, status: "OPEN", dueAt: { lte: new Date(now.getTime() + 7 * 86_400_000) } }, orderBy: { dueAt: "asc" }, select: { number: true, dueAt: true } });
      if (invoice) {
        const overdue = invoice.dueAt < now;
        items.push({ key: "invoice", kind: "invoice.due", label: overdue ? "Facture en retard" : "Facture à régler", detail: `Facture ${invoice.number}, échéance le ${invoice.dueAt.toLocaleDateString("fr-FR")}.`, count: 1, href: `${base}/abonnement`, tone: overdue ? "danger" : "warning" });
      }
    }
  }
  return items;
}

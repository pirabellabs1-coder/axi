import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { InboxFilter } from "./constants";

export async function listConversations(storeId: string, opts: { filter: InboxFilter; q: string; label: string; userId: string; take?: number }) {
  const q = opts.q.trim();
  const digits = q.replace(/\D/g, "");
  const where: Prisma.ConversationWhereInput = {
    storeId,
    ...(opts.filter === "fermees" ? { status: "CLOSED" } : { status: { not: "CLOSED" } }),
    ...(opts.filter === "non-lues" ? { unreadCount: { gt: 0 } } : {}),
    ...(opts.filter === "a-moi" ? { assignedToId: opts.userId } : {}),
    ...(opts.filter === "non-attribuees" ? { assignedToId: null } : {}),
    ...(opts.label ? { labels: { has: opts.label } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            { lastPreview: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  return db.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: opts.take ?? 60,
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      stage: true,
      labels: true,
      unreadCount: true,
      lastMessageAt: true,
      lastPreview: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });
}

export type ConversationListItem = Awaited<ReturnType<typeof listConversations>>[number];

export async function countInbox(storeId: string, userId: string) {
  const [unread, mine, unassigned] = await Promise.all([
    db.conversation.count({ where: { storeId, status: { not: "CLOSED" }, unreadCount: { gt: 0 } } }),
    db.conversation.count({ where: { storeId, status: { not: "CLOSED" }, assignedToId: userId } }),
    db.conversation.count({ where: { storeId, status: { not: "CLOSED" }, assignedToId: null } }),
  ]);
  return { unread, mine, unassigned };
}

export async function getConversation(storeId: string, conversationId: string) {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, storeId },
    include: {
      assignedTo: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, phone: true, email: true, address: true, tags: true, ordersCount: true, totalSpent: true, lastOrderAt: true, loyaltyPoints: true, createdAt: true } },
    },
  });
  if (!conversation) return null;
  const [messages, orders] = await Promise.all([
    db.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: 150,
      include: { author: { select: { name: true } } },
    }),
    db.order.findMany({
      where: { storeId, OR: [...(conversation.customerId ? [{ customerId: conversation.customerId }] : []), { customerPhone: conversation.phone }] },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, reference: true, total: true, currency: true, status: true, paymentStatus: true, createdAt: true },
    }),
  ]);
  return { conversation, messages: messages.reverse(), orders };
}

/** Étiquettes utilisées dans la boutique (filtre de la liste). */
export async function listLabels(storeId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ label: string }[]>`
    SELECT DISTINCT unnest("labels") AS label FROM "Conversation" WHERE "storeId" = ${storeId} ORDER BY label LIMIT 50`;
  return rows.map((r) => r.label);
}

export async function listMembers(storeId: string) {
  const rows = await db.membership.findMany({
    where: { storeId, role: { not: "SUPPORT" } },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({ id: m.user.id, name: m.user.name }));
}

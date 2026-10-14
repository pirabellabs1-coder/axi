import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/** Lectures des écrans marchands (toujours filtrées par `storeId`, jamais de code en clair). */

export type GiftCardListFilter = "" | "active" | "exhausted" | "disabled" | "expired";

export function giftCardFilterWhere(storeId: string, f: { status: GiftCardListFilter; q?: string; customerId?: string | null }, now = new Date()): Prisma.GiftCardWhereInput {
  const statusWhere: Record<GiftCardListFilter, Prisma.GiftCardWhereInput> = {
    "": {},
    active: { status: "ACTIVE", balance: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    exhausted: { status: "ACTIVE", balance: { lte: 0 } },
    disabled: { status: "DISABLED" },
    expired: { OR: [{ status: "EXPIRED" }, { status: "ACTIVE", expiresAt: { lte: now } }] },
  };
  const q = (f.q ?? "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "").slice(-4);
  return {
    storeId,
    AND: [
      statusWhere[f.status],
      q ? { last4: { contains: q } } : {},
      f.customerId ? { customerId: f.customerId } : {},
    ],
  };
}

export async function listGiftCards(storeId: string, f: { status: GiftCardListFilter; q?: string; customerId?: string | null; page: number; pageSize: number }) {
  const where = giftCardFilterWhere(storeId, f);
  const [rows, total] = await Promise.all([
    db.giftCard.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true, last4: true, currency: true, initialValue: true, balance: true, status: true, source: true, expiresAt: true, createdAt: true,
        recipientName: true, customer: { select: { id: true, name: true } },
      },
    }),
    db.giftCard.count({ where }),
  ]);
  return { rows, total };
}

export async function giftCardStats(storeId: string, now = new Date()) {
  const [count, outstanding] = await Promise.all([
    db.giftCard.count({ where: { storeId } }),
    db.giftCard.aggregate({ where: { storeId, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, _sum: { balance: true, initialValue: true }, _count: { _all: true } }),
  ]);
  return { count, activeCount: outstanding._count._all, outstanding: outstanding._sum.balance ?? 0 };
}

export async function getGiftCardDetail(storeId: string, id: string) {
  const card = await db.giftCard.findFirst({
    where: { id, storeId },
    select: {
      id: true, last4: true, currency: true, initialValue: true, balance: true, status: true, source: true, expiresAt: true, createdAt: true,
      recipientName: true, recipientPhone: true, recipientEmail: true, message: true, sendAt: true, deliveredAt: true, disabledReason: true,
      sourceOrderId: true, createdById: true, customer: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!card) return null;
  const [transactions, sourceOrder] = await Promise.all([
    db.giftCardTransaction.findMany({
      where: { storeId, giftCardId: card.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, kind: true, amount: true, balanceAfter: true, note: true, createdAt: true, actorId: true, order: { select: { id: true, reference: true } } },
    }),
    card.sourceOrderId ? db.order.findFirst({ where: { id: card.sourceOrderId, storeId }, select: { id: true, reference: true, customerName: true } }) : null,
  ]);
  const actorIds = [...new Set(transactions.map((t) => t.actorId).filter((v): v is string => !!v))];
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  return { card, transactions: transactions.map((t) => ({ ...t, actorName: actors.find((a) => a.id === t.actorId)?.name ?? null })), sourceOrder };
}

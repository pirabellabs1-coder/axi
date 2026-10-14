import type { NextRequest } from "next/server";
import type { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, planFeature, AuthError } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { toCsv, csvResponse } from "@/lib/csv";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/commerce/order-state";

const TAB_STATUSES: Record<string, OrderStatus[]> = {
  "a-traiter": ["NEW"],
  "en-cours": ["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"],
  terminees: ["DELIVERED", "REFUNDED"],
  annulees: ["CANCELLED"],
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  try {
    const ctx = await requireStore(storeId, "export");
    if (!planFeature(ctx.planId, "csvExport")) return new Response("L'export CSV est disponible à partir du plan Business.", { status: 403 });
    const sp = req.nextUrl.searchParams;
    const statuses = TAB_STATUSES[sp.get("statut") ?? ""];
    const q = (sp.get("q") ?? "").trim().slice(0, 60);
    const paiement = sp.get("paiement") as PaymentStatus | null;
    const where: Prisma.OrderWhereInput = {
      storeId: ctx.store.id,
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(paiement && paiement in PAYMENT_STATUS_LABELS ? { paymentStatus: paiement } : {}),
      ...(q ? { OR: [{ reference: { contains: q.toUpperCase() } }, { customerName: { contains: q, mode: "insensitive" } }, { customerPhone: { contains: q.replace(/\D/g, "") || q } }] } : {}),
    };
    const orders = await db.order.findMany({ where, orderBy: { createdAt: "desc" }, take: 5000, include: { items: true } });
    const rows = orders.map((o) => [
      o.reference,
      o.createdAt,
      ORDER_STATUS_LABELS[o.status],
      PAYMENT_STATUS_LABELS[o.paymentStatus],
      o.paymentMethodLabel ?? "",
      o.customerName,
      o.customerPhone,
      o.customerEmail ?? "",
      o.fulfillmentType,
      o.deliveryZoneName ?? "",
      o.deliveryAddress ?? "",
      o.items.map((i) => `${i.quantity} x ${i.name}${i.variantName ? ` (${i.variantName})` : ""}`).join(" | "),
      o.subtotal,
      o.discount,
      o.deliveryFee,
      o.total,
      o.currency,
      o.couponCode ?? "",
      o.channel,
      o.outOfQuota ? "oui" : "non",
      o.courierName ?? "",
      o.internalNote ?? "",
    ]);
    const csv = toCsv(
      ["Référence", "Date", "Statut", "Paiement", "Moyen de paiement", "Client", "Téléphone", "E-mail", "Mode", "Zone", "Adresse", "Articles", "Sous-total", "Remise", "Livraison", "Total", "Devise", "Code promo", "Canal", "Hors quota", "Livreur", "Note interne"],
      rows,
    );
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "orders.exported", metadata: { count: orders.length } });
    return csvResponse(`commandes-${ctx.store.slug}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (e) {
    if (e instanceof AuthError) return new Response(e.message, { status: e.code === "UNAUTHENTICATED" ? 401 : 403 });
    throw e;
  }
}

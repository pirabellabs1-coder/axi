import type { OrderStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

/** Pastille de statut de commande, lisible sur le thème clair de toute boutique (contrastes AA). */
const TONE: Record<OrderStatus, string> = {
  NEW: "bg-info-soft text-info",
  CONFIRMED: "bg-info-soft text-info",
  PREPARING: "bg-sun-soft text-[#8a5a00]",
  READY: "bg-sun-soft text-[#8a5a00]",
  OUT_FOR_DELIVERY: "bg-sun-soft text-[#8a5a00]",
  DELIVERED: "bg-[#e8f6ef] text-[#0b5a3f]",
  CANCELLED: "bg-surface-2 text-ink-muted",
  REFUNDED: "bg-warning-soft text-warning",
};

export function OrderStatusPill({ status, label, className }: { status: OrderStatus; label: string; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold", TONE[status], className)}>{label}</span>;
}

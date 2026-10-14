"use client";

import { useTransition } from "react";
import type { TicketStatus } from "@prisma/client";
import { setTicketStatus } from "@/lib/admin/actions";
import { toast } from "@/components/ui/toast";

const STATUSES: { value: TicketStatus; label: string }[] = [
  { value: "OPEN", label: "Ouvert" },
  { value: "PENDING", label: "En attente" },
  { value: "RESOLVED", label: "Résolu" },
  { value: "CLOSED", label: "Fermé" },
];

export function TicketStatusSelect({ ticketId, status }: { ticketId: string; status: TicketStatus }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Changer le statut du ticket"
      value={status}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          const res = await setTicketStatus(ticketId, e.target.value as TicketStatus);
          if (res.ok) toast.success(res.message ?? "Statut mis à jour");
          else toast.error(res.error);
        })
      }
      className="h-11 rounded-[var(--radius-md)] border border-line-strong bg-surface px-3 text-sm text-ink disabled:opacity-50"
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </select>
  );
}

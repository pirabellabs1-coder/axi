import type { WebhookEvent } from "@/lib/webhooks/events";

/**
 * Lot 2 (webhooks) : charge des événements `customer.created` / `customer.updated`. Les coordonnées sont placées
 * sous l'objet `customer` : le fan-out n'en garde que l'identifiant pour un point sans droit aux données
 * personnelles (`redactPersonalData`). Pur.
 */
export type CustomerEvent = Extract<WebhookEvent, "customer.created" | "customer.updated">;

export function customerEventData(
  c: { id: string; name?: string | null; phone?: string | null; email?: string | null },
  extra: { source: string; updated_fields?: string[] },
): Record<string, unknown> {
  return {
    customer_id: c.id,
    customer: { id: c.id, name: c.name ?? null, phone: c.phone ?? null, email: c.email ?? null },
    ...extra,
  };
}

import { SHIPMENT_STATUS_LABELS, type ShipmentStatusValue } from "@/lib/shipping/state";
import { formatDateTime } from "@/lib/utils";

/**
 * Chronologie d'une expédition (lot 3 §1.2) : partagée par l'espace marchand et le suivi acheteur.
 * Les événements sont affichés du plus récent au plus ancien ; la source (livreur, transporteur,
 * commerçant) est indiquée pour lever toute ambiguïté.
 */

export type TimelineEvent = {
  id: string;
  status: ShipmentStatusValue;
  message: string | null;
  locationLabel: string | null;
  source: string;
  /** ISO 8601. */
  occurredAt: string;
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Commerçant",
  courier: "Livreur",
  webhook: "Transporteur",
  poll: "Transporteur",
};

export function ShipmentTimeline({ events, className }: { events: TimelineEvent[]; className?: string }) {
  if (!events.length) return <p className="text-sm text-ink-muted">Aucun événement pour le moment.</p>;
  return (
    <ol className={className ?? "space-y-3"}>
      {events.map((event, index) => (
        <li key={event.id} className="flex gap-3">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${index === 0 ? "bg-primary" : "bg-line"}`} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{SHIPMENT_STATUS_LABELS[event.status]}</p>
            <p className="text-sm text-ink-muted">
              <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
              {" · "}
              {SOURCE_LABELS[event.source] ?? event.source}
              {event.locationLabel ? ` · ${event.locationLabel}` : ""}
            </p>
            {event.message && <p className="text-sm text-ink">{event.message}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

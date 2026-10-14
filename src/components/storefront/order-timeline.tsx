import { Check, XCircle } from "lucide-react";
import type { OrderStatus, FulfillmentType } from "@prisma/client";
import { cn, formatDateTime } from "@/lib/utils";

const RANK: Record<OrderStatus, number> = { NEW: 0, CONFIRMED: 1, PREPARING: 2, READY: 3, OUT_FOR_DELIVERY: 4, DELIVERED: 5, CANCELLED: -1, REFUNDED: -1 };

type Step = { status: OrderStatus; label: string; hint: string };

function stepsFor(type: FulfillmentType, booking: boolean): Step[] {
  if (booking && type !== "DELIVERY") {
    return [
      { status: "NEW", label: "Demande reçue", hint: "La boutique a bien reçu votre demande." },
      { status: "CONFIRMED", label: "Rendez-vous confirmé", hint: "Votre créneau est réservé." },
      { status: "DELIVERED", label: "Prestation réalisée", hint: "Merci de votre visite." },
    ];
  }
  const head: Step[] = [
    { status: "NEW", label: "Commande reçue", hint: "La boutique a bien reçu votre commande." },
    { status: "CONFIRMED", label: "Confirmée", hint: "La boutique a validé votre commande." },
    { status: "PREPARING", label: "En préparation", hint: "Votre commande est en cours de préparation." },
  ];
  if (type === "DELIVERY") {
    return [...head, { status: "OUT_FOR_DELIVERY", label: "En livraison", hint: "Le livreur est en route." }, { status: "DELIVERED", label: "Livrée", hint: "Bonne dégustation, bon usage !" }];
  }
  return [...head, { status: "READY", label: "Prête", hint: "Vous pouvez venir la récupérer." }, { status: "DELIVERED", label: "Remise", hint: "Merci pour votre commande." }];
}

/**
 * Frise de suivi : étapes passées (cochées, horodatées), étape en cours (anneau), étapes à venir (estompées).
 * Une commande annulée ou remboursée est signalée en tête, en texte (pas seulement en couleur).
 */
export function OrderTimeline({
  status,
  fulfillmentType,
  createdAt,
  events,
  booking = false,
}: {
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  createdAt: Date;
  events: { type: string; toValue: string | null; createdAt: Date }[];
  booking?: boolean;
}) {
  const steps = stepsFor(fulfillmentType, booking);
  const stopped = status === "CANCELLED" || status === "REFUNDED";
  const lastStatusEvent = [...events].reverse().find((e) => e.type === "status_changed" && e.toValue && RANK[e.toValue as OrderStatus] >= 0);
  const rank = stopped ? (lastStatusEvent ? RANK[lastStatusEvent.toValue as OrderStatus] : 0) : RANK[status];
  const stamp = (s: OrderStatus) => (s === "NEW" ? createdAt : events.find((e) => e.type === "status_changed" && e.toValue === s)?.createdAt ?? null);
  const currentIndex = steps.reduce((acc, s, i) => (RANK[s.status] <= rank ? i : acc), 0);

  return (
    <div>
      {stopped && (
        <p className="mb-5 flex items-center gap-2 rounded-[12px] bg-danger-soft px-4 py-3 text-sm font-medium text-danger" role="status">
          <XCircle className="size-5 shrink-0" aria-hidden />
          {status === "CANCELLED" ? "Cette commande a été annulée." : "Cette commande a été remboursée."}
        </p>
      )}
      <ol className="relative">
        {steps.map((s, i) => {
          const done = !stopped && i < currentIndex;
          const current = !stopped && i === currentIndex;
          const reached = i <= currentIndex;
          const at = reached ? stamp(s.status) : null;
          const last = i === steps.length - 1;
          const finished = current && s.status === "DELIVERED";
          return (
            <li key={s.status} className="relative flex gap-4 pb-6 last:pb-0" aria-current={current ? "step" : undefined}>
              {!last && <span className={cn("absolute left-[15px] top-8 h-[calc(100%-24px)] w-0.5 rounded-full", done ? "bg-[var(--store-primary)]" : "bg-line")} aria-hidden />}
              <span
                className={cn(
                  "relative z-[1] inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                  done || finished ? "bg-[var(--store-primary)] text-[var(--store-primary-contrast)]" : current ? "bg-surface ring-2 ring-[var(--store-primary)]" : "bg-surface ring-1 ring-line-strong",
                  stopped && reached && "bg-surface-2 text-ink-muted ring-1 ring-line-strong",
                )}
                aria-hidden
              >
                {done || finished ? <Check className="size-4" /> : current ? <span className="size-2.5 animate-pulse-soft rounded-full bg-[var(--store-primary)]" /> : null}
              </span>
              <div className="min-w-0 pt-1">
                <p className={cn("text-[15px] leading-tight", current ? "font-semibold text-ink" : reached ? "font-medium text-ink" : "text-ink-faint")}>
                  {s.label}
                  {current && <span className="sr-only"> (étape actuelle)</span>}
                  {done && <span className="sr-only"> (terminée)</span>}
                </p>
                {current && !stopped && <p className="mt-1 text-sm text-ink-muted">{s.hint}</p>}
                {at && <p className="mt-0.5 text-xs text-ink-faint tabular">{formatDateTime(at)}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

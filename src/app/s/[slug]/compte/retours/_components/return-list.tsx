import { Check } from "lucide-react";
import type { ReturnStatus } from "@prisma/client";
import type { BuyerReturnSummary } from "@/lib/returns/buyer";
import { RETURN_STATUS_BUYER_TEXT, RETURN_STATUS_LABELS } from "@/lib/returns/state";
import { RESOLUTION_LABELS, type ResolutionKind } from "@/lib/returns/policy";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { CancelMyReturnButton, type Proof } from "./cancel-my-return";

const STEPS: ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED", "RESOLVED"];

/** Suivi des retours d'une commande, côté acheteur (aucune note interne exposée). */
export function BuyerReturnList({ returns, currency, proof, instructions }: { returns: BuyerReturnSummary[]; currency: string; proof: Proof; instructions?: string }) {
  return (
    <ul className="space-y-4">
      {returns.map((r) => {
        const closed = r.status === "REJECTED" || r.status === "CANCELLED";
        const reached = new Set(r.events.map((e) => e.toStatus));
        const res = r.resolution as ResolutionKind;
        return (
          <li key={r.id} className="rounded-[var(--store-card-radius)] bg-surface p-5 ring-1 ring-line">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-base font-semibold text-ink">{r.reference}</p>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${closed ? "bg-surface-2 text-ink-muted" : r.status === "RESOLVED" ? "bg-[#e8f6ef] text-[#0b5a3f]" : "bg-sun-soft text-[#8a5a00]"}`}>
                {RETURN_STATUS_LABELS[r.status]}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">Demande du {formatDateTime(r.createdAt)}</p>
            <ul className="mt-3 text-sm text-ink">
              {r.items.map((i, idx) => (
                <li key={idx}>
                  {i.quantity} × {i.name}
                  {i.variantName ? ` (${i.variantName})` : ""}
                </li>
              ))}
            </ul>
            {!closed && (
              <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Étapes du retour">
                {STEPS.map((s) => {
                  const done = reached.has(s) || STEPS.indexOf(r.status) >= STEPS.indexOf(s);
                  return (
                    <li key={s} className="text-center text-[11px] text-ink-muted">
                      <span className={`mb-1 block h-1.5 rounded-full ${done ? "bg-[var(--store-primary)]" : "bg-surface-2"}`} aria-hidden />
                      <span className={done ? "font-medium text-ink" : ""}>
                        {done && <Check className="mr-0.5 inline size-3" aria-hidden />}
                        {RETURN_STATUS_LABELS[s]}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="mt-3 text-sm text-ink-muted">{RETURN_STATUS_BUYER_TEXT[r.status]}</p>
            {r.status === "APPROVED" && instructions && <p className="mt-2 whitespace-pre-wrap rounded-[12px] bg-surface-2 px-4 py-3 text-sm text-ink">{instructions}</p>}
            {r.status === "REJECTED" && r.rejectionReason && <p className="mt-2 text-sm text-ink [overflow-wrap:anywhere]">Motif : {r.rejectionReason}</p>}
            {r.status === "RESOLVED" && (
              <p className="mt-2 text-sm font-medium text-ink">
                {res === "REFUND"
                  ? `Remboursement : ${formatMoney(r.refundAmount, currency)}`
                  : res === "STORE_CREDIT"
                    ? `Avoir : ${formatMoney(r.storeCreditAmount, currency)}, utilisable sur votre prochaine commande (connectez-vous avec votre numéro).`
                    : res === "EXCHANGE"
                      ? "Échange : une nouvelle commande a été créée par la boutique."
                      : `Résolution : ${RESOLUTION_LABELS[res] ?? res}`}
              </p>
            )}
            {r.status !== "RESOLVED" && !closed && res !== "NONE" && <p className="mt-1 text-xs text-ink-muted">Solution souhaitée : {RESOLUTION_LABELS[res].toLowerCase()}</p>}
            {r.status === "REQUESTED" && <CancelMyReturnButton proof={proof} returnId={r.id} />}
          </li>
        );
      })}
    </ul>
  );
}

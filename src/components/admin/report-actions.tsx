"use client";

import { useState, useTransition } from "react";
import { Ban, EyeOff, XCircle, Search } from "lucide-react";
import { resolveReport, setReportStatus } from "@/lib/admin/platform-actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";

type Decision = "suspend" | "unlist" | "dismiss";

const COPY: Record<Decision, { title: string; description: string; label: string; variant: "danger" | "primary" | "secondary" }> = {
  suspend: { title: "Suspendre la boutique", description: "La boutique passe hors ligne et le marchand ne peut plus la modifier. Les signalements ouverts de cette boutique sont clos.", label: "Suspendre", variant: "danger" },
  unlist: { title: "Retirer de la marketplace", description: "La boutique reste accessible par son lien, mais disparaît de la marketplace ; le marchand ne peut pas la relister.", label: "Retirer", variant: "primary" },
  dismiss: { title: "Rejeter le signalement", description: "Aucune action sur la boutique. Les signalements ouverts de cette boutique sont clos comme rejetés.", label: "Rejeter", variant: "secondary" },
};

/** Actions rapides de modération sur un signalement (motif obligatoire, journalisé). */
export function ReportActions({ reportId, storeName, status, storeSuspended, storeBlocked, canEdit }: { reportId: string; storeName: string; status: string; storeSuspended: boolean; storeBlocked: boolean; canEdit: boolean }) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  const closed = status === "RESOLVED" || status === "DISMISSED";

  const confirm = () =>
    start(async () => {
      if (!decision) return;
      const r = await resolveReport(reportId, decision, why);
      if (r.ok) {
        toast.success(r.message ?? "Décision enregistrée");
        setDecision(null);
        setWhy("");
        setError(null);
      } else setError(r.error);
    });

  const review = () =>
    start(async () => {
      const r = await setReportStatus(reportId, "REVIEWING");
      if (r.ok) toast.success(r.message ?? "En examen");
      else toast.error(r.error);
    });

  const btn = "inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors sm:h-9 disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-1">
      {closed ? (
        <button type="button" className={`${btn} text-ink-muted hover:bg-surface-2 hover:text-ink`} onClick={() => start(async () => { const r = await setReportStatus(reportId, "OPEN"); if (r.ok) toast.success("Signalement rouvert"); else toast.error(r.error); })} disabled={pending}>
          Rouvrir
        </button>
      ) : (
        <>
          {status === "OPEN" && (
            <button type="button" className={`${btn} text-ink-muted hover:bg-surface-2 hover:text-ink`} onClick={review} disabled={pending}>
              <Search className="size-4" aria-hidden /> Examiner
            </button>
          )}
          {!storeSuspended && (
            <button type="button" className={`${btn} text-danger hover:bg-danger-soft`} onClick={() => setDecision("suspend")} disabled={pending}>
              <Ban className="size-4" aria-hidden /> Suspendre
            </button>
          )}
          {!storeBlocked && (
            <button type="button" className={`${btn} text-ink hover:bg-surface-2`} onClick={() => setDecision("unlist")} disabled={pending}>
              <EyeOff className="size-4" aria-hidden /> Retirer
            </button>
          )}
          <button type="button" className={`${btn} text-ink-muted hover:bg-surface-2 hover:text-ink`} onClick={() => setDecision("dismiss")} disabled={pending}>
            <XCircle className="size-4" aria-hidden /> Rejeter
          </button>
        </>
      )}
      <Dialog
        open={decision != null}
        onClose={() => setDecision(null)}
        size="sm"
        title={decision ? `${COPY[decision].title} : ${storeName}` : ""}
        description={decision ? COPY[decision].description : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)} disabled={pending}>Annuler</Button>
            {decision && <Button variant={COPY[decision].variant} loading={pending} onClick={confirm}>{COPY[decision].label}</Button>}
          </>
        }
      >
        <Field id={`why-${reportId}`} label="Motif de la décision" required error={error ?? undefined} hint="Visible dans le journal d'audit et sur le signalement.">
          {(p) => <Textarea {...p} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder="Ex. : photos de produits contrefaits confirmées, plusieurs signalements concordants" />}
        </Field>
      </Dialog>
    </div>
  );
}

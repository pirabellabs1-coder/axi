"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PauseCircle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { reviewApp } from "@/lib/apps/admin-actions";
import type { ReviewAction } from "@/lib/apps/admin-logic";

/** Décisions de revue pour une application : publier, renvoyer en brouillon (avec raison), suspendre. */
export function ReviewControls({ appId, status }: { appId: string; status: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "SUSPENDED" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const run = (action: ReviewAction, r?: string) =>
    start(async () => {
      const res = await reviewApp(appId, action, r);
      if (res.ok) {
        toast.success(res.message ?? "Fait");
        setRejecting(false);
        setReason("");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {status === "IN_REVIEW" && (
        <>
          <Button size="sm" onClick={() => run("publish")} loading={pending}>
            <CheckCircle2 className="size-4" aria-hidden /> Publier
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRejecting(true)} disabled={pending}>
            <Undo2 className="size-4" aria-hidden /> Refuser
          </Button>
        </>
      )}
      {(status === "PUBLISHED" || status === "IN_REVIEW") && (
        <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => run("suspend")} disabled={pending}>
          <PauseCircle className="size-4" aria-hidden /> Suspendre
        </Button>
      )}

      <Dialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Refuser l'application"
        description="Elle repasse en brouillon côté développeur. Indiquez la raison du refus (consignée dans l'audit)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>Annuler</Button>
            <Button variant="danger" onClick={() => run("reject", reason)} loading={pending}>Refuser</Button>
          </>
        }
      >
        <Field id="reject-reason" label="Raison du refus" hint="Visible dans le journal d'audit.">
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} placeholder="Ex. autorisations trop larges, fiche incomplète…" />}
        </Field>
      </Dialog>
    </div>
  );
}

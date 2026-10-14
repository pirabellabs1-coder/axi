"use client";

import { useState, useTransition } from "react";
import { Flag } from "lucide-react";
import { reportStore } from "@/lib/reports/actions";
import { REPORT_REASONS, REPORT_REASON_LABEL, type ReportReason } from "@/lib/reports/constants";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Bouton « Signaler cette boutique » (pied de page de la boutique publique).
 * Usage : <ReportStoreButton slug={store.slug} storeName={store.name} />
 */
export function ReportStoreButton({ slug, storeName, className }: { slug: string; storeName: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const close = () => {
    setOpen(false);
    setError(null);
    setErrors({});
    if (done) {
      setDone(false);
      setReason("");
      setMessage("");
      setEmail("");
    }
  };

  const submit = () =>
    start(async () => {
      if (!reason) {
        setErrors({ reason: ["Choisissez un motif"] });
        return;
      }
      const r = await reportStore(slug, reason, message, email);
      if (r.ok) {
        setDone(true);
        setErrors({});
        setError(null);
        toast.success(r.message ?? "Signalement envoyé");
      } else {
        setError(r.error);
        setErrors(r.fieldErrors ?? {});
      }
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline", className)}
      >
        <Flag className="size-3.5" aria-hidden /> Signaler cette boutique
      </button>
      <Dialog
        open={open}
        onClose={close}
        size="sm"
        title={done ? "Signalement envoyé" : "Signaler cette boutique"}
        description={done ? undefined : `Un problème avec ${storeName} ? L'équipe Axi examine chaque signalement.`}
        footer={
          done ? (
            <Button onClick={close}>Fermer</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={pending}>Annuler</Button>
              <Button variant="danger" loading={pending} onClick={submit}>Envoyer le signalement</Button>
            </>
          )
        }
      >
        {done ? (
          <p className="text-sm text-ink-muted">Merci. Si nous avons besoin de précisions et que vous avez laissé votre e-mail, nous vous écrirons. Les décisions de modération ne sont pas communiquées publiquement.</p>
        ) : (
          <div className="space-y-4">
            {error && !Object.keys(errors).length && <Alert tone="danger">{error}</Alert>}
            <Field id="report-reason" label="Motif" required error={errors.reason}>
              {(p) => (
                <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
                  <option value="">Choisir un motif</option>
                  {REPORT_REASONS.map((r) => (
                    <option key={r} value={r}>{REPORT_REASON_LABEL[r]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="report-message" label="Détails" hint="Facultatif : ce qui s'est passé, numéro de commande…" error={errors.message}>
              {(p) => <Textarea {...p} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />}
            </Field>
            <Field id="report-email" label="Votre e-mail" hint="Facultatif, pour vous recontacter si besoin." error={errors.email}>
              {(p) => <Input {...p} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.com" />}
            </Field>
          </div>
        )}
      </Dialog>
    </>
  );
}

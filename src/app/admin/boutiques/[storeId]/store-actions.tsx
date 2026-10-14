"use client";

import { useState, useTransition } from "react";
import { Ban, CheckCircle2, Star, Eye, EyeOff, LifeBuoy } from "lucide-react";
import { suspendStore, reactivateStore, toggleFeatured, toggleListed, grantSupportAccess } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

type Props = { storeId: string; status: string; isFeatured: boolean; listedInMarketplace: boolean; supportUntil: string | null };

export function StoreAdminActions({ storeId, status, isFeatured, listedInMarketplace, supportUntil }: Props) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<null | "suspend" | "reactivate" | "support">(null);
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("4");
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<ActionResult<unknown>>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Enregistré");
        setDialog(null);
        setReason("");
        setError(null);
      } else {
        setError(res.error);
        toast.error(res.error);
      }
    });

  const close = () => {
    setDialog(null);
    setError(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "SUSPENDED" ? (
        <Button variant="primary" size="sm" onClick={() => setDialog("reactivate")} disabled={pending}>
          <CheckCircle2 className="size-4" aria-hidden /> Réactiver
        </Button>
      ) : (
        <Button variant="danger" size="sm" onClick={() => setDialog("suspend")} disabled={pending}>
          <Ban className="size-4" aria-hidden /> Suspendre
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => run(() => toggleFeatured(storeId))} disabled={pending} aria-pressed={isFeatured}>
        <Star className={isFeatured ? "size-4 fill-current text-sun" : "size-4"} aria-hidden /> {isFeatured ? "Retirer la vedette" : "Mettre en vedette"}
      </Button>
      <Button variant="outline" size="sm" onClick={() => run(() => toggleListed(storeId))} disabled={pending} aria-pressed={listedInMarketplace}>
        {listedInMarketplace ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />} {listedInMarketplace ? "Masquer de la marketplace" : "Lister sur la marketplace"}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setDialog("support")} disabled={pending}>
        <LifeBuoy className="size-4" aria-hidden /> {supportUntil ? "Prolonger l'accès support" : "Accès support"}
      </Button>

      <Dialog
        open={dialog === "suspend" || dialog === "reactivate"}
        onClose={close}
        title={dialog === "suspend" ? "Suspendre la boutique" : "Réactiver la boutique"}
        description={dialog === "suspend" ? "La boutique passe hors ligne et le marchand ne peut plus modifier ses données. Le motif est journalisé." : "La boutique revient en ligne (ou en brouillon si elle n'a jamais été publiée)."}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>Annuler</Button>
            <Button
              variant={dialog === "suspend" ? "danger" : "primary"}
              loading={pending}
              onClick={() => run(() => (dialog === "suspend" ? suspendStore(storeId, reason) : reactivateStore(storeId, reason)))}
            >
              {dialog === "suspend" ? "Suspendre" : "Réactiver"}
            </Button>
          </>
        }
      >
        <Field id="reason" label="Motif" required error={error ?? undefined} hint="Obligatoire, visible dans le journal d'audit.">
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : signalement de produits contrefaits, impayé persistant…" />}
        </Field>
      </Dialog>

      <Dialog
        open={dialog === "support"}
        onClose={close}
        title="Accorder un accès support"
        description="Crée un accès SUPPORT temporaire (lecture) à votre compte sur cette boutique. Justifié et journalisé."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>Annuler</Button>
            <Button loading={pending} onClick={() => run(() => grantSupportAccess(storeId, Number(hours), reason))}>Accorder</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field id="hours" label="Durée">
            {(p) => (
              <Select {...p} value={hours} onChange={(e) => setHours(e.target.value)}>
                <option value="1">1 heure</option>
                <option value="4">4 heures</option>
                <option value="24">24 heures</option>
                <option value="72">3 jours</option>
                <option value="168">7 jours</option>
              </Select>
            )}
          </Field>
          <Field id="support-reason" label="Motif" required error={error ?? undefined}>
            {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : ticket #123, vérification d'une commande bloquée" />}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

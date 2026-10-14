"use client";

import { useState } from "react";
import { PauseCircle, PlayCircle, Archive } from "lucide-react";
import { setStoreStatus } from "@/lib/store/actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ActionButton } from "@/components/app/action-controls";
import { toast } from "@/components/ui/toast";

export function DangerZone({ storeId, storeName, status, canArchive }: { storeId: string; storeName: string; status: string; canArchive: boolean }) {
  const closed = status === "CLOSED_TEMPORARILY";
  const [closeOpen, setCloseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <div className="divide-y divide-line">
      <div className="flex flex-wrap items-center gap-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{closed ? "Rouvrir la boutique" : "Fermer temporairement"}</p>
          <p className="text-sm text-ink-muted">{closed ? "La boutique redevient accessible et acceptera les commandes." : "Congés, rupture de stock : la boutique reste visible avec un message, mais n'accepte plus de commandes."}</p>
        </div>
        {closed ? (
          <ActionButton variant="primary" action={() => setStoreStatus(storeId, "PUBLISHED")}><PlayCircle className="size-4" aria-hidden /> Rouvrir</ActionButton>
        ) : (
          <Button variant="outline" onClick={() => setCloseOpen(true)} disabled={status !== "PUBLISHED"} title={status !== "PUBLISHED" ? "La boutique n'est pas publiée" : undefined}><PauseCircle className="size-4" aria-hidden /> Fermer temporairement</Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-danger">Archiver la boutique</p>
          <p className="text-sm text-ink-muted">La boutique disparaît du public et de votre liste. Les données (commandes, clients, produits) sont conservées et exportables ; le support peut la restaurer.</p>
        </div>
        <Button variant="danger" onClick={() => setArchiveOpen(true)} disabled={!canArchive} title={!canArchive ? "Réservé au propriétaire" : undefined}><Archive className="size-4" aria-hidden /> Archiver</Button>
      </div>

      <Dialog open={closeOpen} onClose={() => setCloseOpen(false)} title="Fermer temporairement" description="Indiquez un message pour vos clients (facultatif)." size="sm" footer={
        <>
          <Button variant="ghost" onClick={() => setCloseOpen(false)}>Annuler</Button>
          <Button loading={pending} onClick={async () => {
            setPending(true);
            const r = await setStoreStatus(storeId, "CLOSED_TEMPORARILY", reason.trim() || undefined);
            setPending(false);
            if (r.ok) { toast.success("Boutique fermée temporairement"); setCloseOpen(false); } else toast.error(r.error);
          }}>Fermer la boutique</Button>
        </>
      }>
        <Field id="close-reason" label="Message affiché">
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={200} placeholder="Nous sommes en congés jusqu'au 15 : à très vite !" />}
        </Field>
      </Dialog>

      <Dialog open={archiveOpen} onClose={() => setArchiveOpen(false)} title="Archiver la boutique ?" description={`Pour confirmer, saisissez le nom exact de la boutique : ${storeName}`} size="sm" footer={
        <>
          <Button variant="ghost" onClick={() => setArchiveOpen(false)}>Annuler</Button>
          <Button variant="danger" loading={pending} disabled={confirmName.trim() !== storeName} onClick={async () => {
            setPending(true);
            const r = await setStoreStatus(storeId, "ARCHIVED", "Archivée par le propriétaire");
            setPending(false);
            if (r && !r.ok) toast.error(r.error);
          }}>Archiver définitivement</Button>
        </>
      }>
        <Field id="archive-name" label="Nom de la boutique">
          {(p) => <Input {...p} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" placeholder={storeName} />}
        </Field>
        <p className="mt-3 text-xs text-ink-muted">Pensez à exporter vos données avant (section Export).</p>
      </Dialog>
    </div>
  );
}

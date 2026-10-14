"use client";

import { useActionState, useState } from "react";
import { Plus, Truck, PackageCheck } from "lucide-react";
import { createTransfer, shipTransfer, receiveTransfer, cancelTransfer } from "@/lib/inventory/actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";
import type { TransferStatusValue } from "@/lib/inventory/transfer";

type LocationStock = { id: string; name: string; items: { productId: string; variantId: string | null; label: string; available: number }[] };

/** Création d'un transfert : dépôt source, dépôt destination, quantités par article disponible. */
export function TransferDialog({ storeId, locations }: { storeId: string; locations: LocationStock[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createTransfer, undefined);
  const [fromId, setFromId] = useState(locations[0]?.id ?? "");
  const [toId, setToId] = useState(locations[1]?.id ?? "");
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  const source = locations.find((l) => l.id === fromId);
  const enoughLocations = locations.length >= 2;

  return (
    <>
      <Button variant="accent" size="sm" className="h-11 sm:h-9" onClick={() => setOpen(true)} disabled={!enoughLocations} title={enoughLocations ? undefined : "Créez au moins deux dépôts"}>
        <Plus className="size-4" aria-hidden /> Nouveau transfert
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Nouveau transfert" description="Le stock quitte le dépôt source à l'expédition et n'est crédité à la destination qu'à la réception.">
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="trfrom" label="Dépôt source" required>
              {(p) => (
                <Select {...p} name="fromLocationId" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="trto" label="Dépôt destination" required>
              {(p) => (
                <Select {...p} name="toLocationId" value={toId} onChange={(e) => setToId(e.target.value)}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Articles à transférer</p>
            {!source || source.items.length === 0 ? (
              <p className="text-sm text-ink-muted">Aucun article en stock dans ce dépôt.</p>
            ) : (
              <div className="max-h-[40vh] space-y-3 overflow-y-auto pr-1">
                {source.items.map((item) => (
                  <div key={`${item.productId}:${item.variantId ?? ""}`} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.label}</span>
                    <span className="tabular text-sm text-ink-muted">{item.available}</span>
                    <Input
                      name={`item-${item.productId}${item.variantId ? `:${item.variantId}` : ""}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={Math.max(0, item.available)}
                      defaultValue={0}
                      className="tabular w-24"
                      aria-label={`Quantité à transférer pour ${item.label}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          <Field id="trnote" label="Note">{(p) => <Input {...p} name="note" maxLength={200} placeholder="Réassort boutique" />}</Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton disabled={fromId === toId}>Créer le transfert</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

type TransferDTO = { id: string; reference: string; status: TransferStatusValue; items: { id: string; label: string; quantity: number }[] };

export function TransferRowActions({ storeId, transfer }: { storeId: string; transfer: TransferDTO }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(receiveTransfer, undefined);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {transfer.status === "DRAFT" && (
        <ActionButton variant="secondary" size="sm" action={() => shipTransfer(storeId, transfer.id)}>
          <Truck className="size-4" aria-hidden /> Expédier
        </ActionButton>
      )}
      {transfer.status === "IN_TRANSIT" && (
        <>
          <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
            <PackageCheck className="size-4" aria-hidden /> Recevoir
          </Button>
          <Dialog open={open} onClose={() => setOpen(false)} title={`Réception ${transfer.reference}`} description="Saisissez les quantités réellement reçues. Tout écart est déclaré en perte, avec motif obligatoire.">
            <form action={action} noValidate className="space-y-4">
              <FormMessage state={state} />
              <input type="hidden" name="storeId" value={storeId} />
              <input type="hidden" name="id" value={transfer.id} />
              <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
                {transfer.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.label}</span>
                    <span className="tabular text-sm text-ink-muted">envoyé {item.quantity}</span>
                    <Input name={`received-${item.id}`} type="number" inputMode="numeric" min={0} max={item.quantity} defaultValue={item.quantity} className="tabular w-24" aria-label={`Quantité reçue pour ${item.label}`} />
                  </div>
                ))}
              </div>
              <Field id="loss" label="Motif de l'écart" error={fieldError(state, "lossReason")} hint="Obligatoire seulement si une quantité reçue est inférieure à la quantité envoyée.">
                {(p) => <Input {...p} name="lossReason" maxLength={120} placeholder="Colis endommagé" />}
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Annuler
                </Button>
                <SubmitButton>Enregistrer la réception</SubmitButton>
              </div>
            </form>
          </Dialog>
        </>
      )}
      {(transfer.status === "DRAFT" || transfer.status === "IN_TRANSIT") && (
        <ConfirmActionButton
          action={() => cancelTransfer(storeId, transfer.id)}
          title="Annuler ce transfert ?"
          description={transfer.status === "IN_TRANSIT" ? "Le stock en transit est restitué au dépôt source." : "Le brouillon sera annulé."}
          confirmLabel="Annuler le transfert"
        >
          Annuler
        </ConfirmActionButton>
      )}
    </div>
  );
}

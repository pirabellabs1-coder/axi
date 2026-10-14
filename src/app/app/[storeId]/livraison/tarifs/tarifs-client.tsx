"use client";

import { useActionState, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { upsertShippingRate, deleteShippingRate, setZoneLocation } from "@/lib/shipping/actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Checkbox } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";

type RateDTO = {
  id: string;
  name: string;
  price: number;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  minSubtotal: number | null;
  maxSubtotal: number | null;
  freeAbove: number | null;
  etaLabel: string | null;
  active: boolean;
  carrierAccountId: string | null;
};

export function RateDialog({
  storeId,
  zoneId,
  currency,
  carriers,
  rate,
}: {
  storeId: string;
  zoneId: string;
  currency: string;
  carriers: { id: string; name: string; carrier: string }[];
  rate?: RateDTO;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(upsertShippingRate, undefined);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  return (
    <>
      {rate ? (
        <Button variant="ghost" size="icon" aria-label={`Modifier le tarif ${rate.name}`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button variant="secondary" size="sm" className="h-11 sm:h-9" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Ajouter un tarif
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={rate ? "Modifier le tarif" : "Nouveau tarif d'expédition"} description="Bornes incluses. Laissez un champ vide pour « sans limite ».">
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="zoneId" value={zoneId} />
          {rate && <input type="hidden" name="id" value={rate.id} />}
          <Field id="rname" label="Nom du tarif" required error={fieldError(state, "name")} hint="Visible par le client, par exemple « Colis standard ».">
            {(p) => <Input {...p} name="name" defaultValue={rate?.name} maxLength={80} placeholder="Colis standard" />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="rprice" label={`Prix (${currency})`} required error={fieldError(state, "price")}>
              {(p) => <Input {...p} name="price" type="number" inputMode="numeric" min={0} defaultValue={rate?.price ?? 0} className="tabular" />}
            </Field>
            <Field id="rfree" label={`Offerte dès (${currency})`} error={fieldError(state, "freeAbove")} hint="Vide = jamais offerte.">
              {(p) => <Input {...p} name="freeAbove" type="number" inputMode="numeric" min={0} defaultValue={rate?.freeAbove ?? ""} className="tabular" />}
            </Field>
            <Field id="rminw" label="Poids minimum (g)" error={fieldError(state, "minWeightGrams")}>
              {(p) => <Input {...p} name="minWeightGrams" type="number" inputMode="numeric" min={0} defaultValue={rate?.minWeightGrams ?? ""} className="tabular" />}
            </Field>
            <Field id="rmaxw" label="Poids maximum (g)" error={fieldError(state, "maxWeightGrams")}>
              {(p) => <Input {...p} name="maxWeightGrams" type="number" inputMode="numeric" min={0} defaultValue={rate?.maxWeightGrams ?? ""} className="tabular" />}
            </Field>
            <Field id="rmins" label={`Montant minimum (${currency})`} error={fieldError(state, "minSubtotal")}>
              {(p) => <Input {...p} name="minSubtotal" type="number" inputMode="numeric" min={0} defaultValue={rate?.minSubtotal ?? ""} className="tabular" />}
            </Field>
            <Field id="rmaxs" label={`Montant maximum (${currency})`} error={fieldError(state, "maxSubtotal")}>
              {(p) => <Input {...p} name="maxSubtotal" type="number" inputMode="numeric" min={0} defaultValue={rate?.maxSubtotal ?? ""} className="tabular" />}
            </Field>
          </div>
          <Field id="reta" label="Délai annoncé">{(p) => <Input {...p} name="etaLabel" defaultValue={rate?.etaLabel ?? ""} maxLength={60} placeholder="Sous 48 h" />}</Field>
          <Field id="rcarrier" label="Transporteur">
            {(p) => (
              <Select {...p} name="carrierAccountId" defaultValue={rate?.carrierAccountId ?? ""}>
                <option value="">Aucun (livreur interne)</option>
                {carriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Checkbox name="active" defaultChecked={rate?.active ?? true} label="Tarif actif" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton>{rate ? "Enregistrer" : "Ajouter le tarif"}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function RateDelete({ storeId, rateId, name }: { storeId: string; rateId: string; name: string }) {
  return (
    <ConfirmActionButton action={() => deleteShippingRate(storeId, rateId)} title={`Supprimer le tarif « ${name} » ?`} description="Les commandes déjà passées gardent le tarif qui leur a été appliqué." confirmLabel="Supprimer">
      <span className="inline-flex items-center gap-1.5">
        <Trash2 className="size-4" aria-hidden /> Supprimer
      </span>
    </ConfirmActionButton>
  );
}

/** Dépôt qui sert la zone : première priorité de l'affectation des commandes. */
export function ZoneLocationForm({ storeId, zoneId, locationId, locations }: { storeId: string; zoneId: string; locationId: string | null; locations: { id: string; name: string }[] }) {
  const [value, setValue] = useState(locationId ?? "");
  if (!locations.length) return null;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field id={`zoneloc-${zoneId}`} label="Dépôt qui sert cette zone" className="min-w-56" hint="Les commandes de la zone sont prélevées en priorité dans ce dépôt.">
        {(p) => (
          <Select {...p} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Dépôt par défaut</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <ActionButton variant="secondary" size="sm" className="h-11 sm:h-10" action={() => setZoneLocation(storeId, zoneId, value || null)}>
        Enregistrer
      </ActionButton>
    </div>
  );
}

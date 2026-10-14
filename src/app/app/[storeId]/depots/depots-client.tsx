"use client";

import { useActionState, useState } from "react";
import { Plus, Pencil, Star, Archive, ClipboardList, ArrowRightLeft } from "lucide-react";
import { upsertLocation, setDefaultLocation, archiveLocation } from "@/lib/locations/actions";
import { assignStockToLocation, submitCount } from "@/lib/inventory/actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Checkbox } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";
import { LOCATION_TYPE_LABELS, type LocationRow } from "@/lib/locations/types";

/**
 * Interface des dépôts (lot 3 §1.1) : création et modification, dépôt par défaut, archivage,
 * répartition d'un article entre dépôts et inventaire tournant. Toutes les règles (limites de plan,
 * invariant de stock, refus d'archiver un dépôt non vide) sont appliquées côté serveur.
 */

export function LocationDialog({ storeId, location, disabled, limit, planName }: { storeId: string; location?: LocationRow; disabled: boolean; limit: number | null; planName: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(upsertLocation, undefined);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  return (
    <>
      {location ? (
        <Button variant="ghost" size="icon" aria-label={`Modifier le dépôt ${location.name}`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button variant="accent" size="sm" className="h-11 sm:h-9" onClick={() => setOpen(true)} disabled={disabled} title={disabled ? `Plan ${planName} : ${limit} dépôt(s)` : undefined}>
          <Plus className="size-4" aria-hidden /> Ajouter un dépôt
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={location ? "Modifier le dépôt" : "Nouveau dépôt"} description="Entrepôt, magasin ou point de retrait : chaque dépôt a son propre stock.">
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          {location && <input type="hidden" name="id" value={location.id} />}
          <Field id="locname" label="Nom du dépôt" required error={fieldError(state, "name")} hint="Par exemple « Boutique Akpakpa ».">
            {(p) => <Input {...p} name="name" defaultValue={location?.name} maxLength={80} placeholder="Dépôt principal" />}
          </Field>
          <Field id="loctype" label="Type" required>
            {(p) => (
              <Select {...p} name="type" defaultValue={location?.type ?? "WAREHOUSE"}>
                {Object.entries(LOCATION_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="loccity" label="Ville">{(p) => <Input {...p} name="city" defaultValue={location?.city ?? ""} maxLength={80} />}</Field>
            <Field id="locphone" label="Téléphone">{(p) => <Input {...p} name="phone" type="tel" maxLength={20} />}</Field>
          </div>
          <Field id="locaddress" label="Adresse">{(p) => <Input {...p} name="address" maxLength={200} />}</Field>
          <div className="space-y-2">
            <Checkbox name="fulfillsOnlineOrders" defaultChecked={location?.fulfillsOnlineOrders ?? true} label="Sert les commandes en ligne" description="Ce dépôt peut être affecté aux commandes de la boutique." />
            <Checkbox name="pickupEnabled" defaultChecked={location?.pickupEnabled ?? false} label="Retrait possible sur place" />
            <Checkbox name="active" defaultChecked={location?.active ?? true} label="Dépôt actif" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton>{location ? "Enregistrer" : "Créer le dépôt"}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function LocationRowActions({ storeId, location }: { storeId: string; location: LocationRow }) {
  return (
    <>
      {!location.isDefault && (
        <ActionButton variant="ghost" size="icon" aria-label={`Définir ${location.name} comme dépôt par défaut`} action={() => setDefaultLocation(storeId, location.id)}>
          <Star className="size-4" aria-hidden />
        </ActionButton>
      )}
      {!location.isDefault && location.active && (
        <ConfirmActionButton
          action={() => archiveLocation(storeId, location.id)}
          title="Archiver ce dépôt ?"
          description="L'archivage n'est possible que si le dépôt ne contient plus aucun article."
          confirmLabel="Archiver"
        >
          <span className="inline-flex items-center gap-1.5">
            <Archive className="size-4" aria-hidden /> Archiver
          </span>
        </ConfirmActionButton>
      )}
    </>
  );
}

export function AssignStockDialog({
  storeId,
  item,
  locations,
}: {
  storeId: string;
  item: { itemKey: string; productId: string; variantId: string | null; label: string };
  locations: { id: string; name: string; available: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(assignStockToLocation, undefined);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  const current = locations.find((l) => l.id === locationId)?.available ?? 0;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <ArrowRightLeft className="size-4" aria-hidden /> Répartir
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Répartir « ${item.label} »`} description="Le stock total ne change pas : la contrepartie est prise sur un autre dépôt.">
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="productId" value={item.productId} />
          {item.variantId && <input type="hidden" name="variantId" value={item.variantId} />}
          <Field id="assignloc" label="Dépôt" required>
            {(p) => (
              <Select {...p} name="locationId" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.available})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="assignqty" label="Quantité dans ce dépôt" required error={fieldError(state, "quantity")} hint={`Actuellement ${current}.`}>
            {(p) => <Input {...p} name="quantity" type="number" inputMode="numeric" min={0} defaultValue={current} className="tabular" />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton>Répartir</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function CountDialog({ storeId, location, items }: { storeId: string; location: LocationRow; items: { itemKey: string; label: string; available: number }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(submitCount, undefined);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  return (
    <>
      <Button variant="ghost" size="icon" aria-label={`Inventaire du dépôt ${location.name}`} onClick={() => setOpen(true)}>
        <ClipboardList className="size-4" aria-hidden />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Inventaire — ${location.name}`} description="Saisissez les quantités comptées. L'écart est enregistré dans l'historique de stock et audité.">
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="locationId" value={location.id} />
          {items.length === 0 ? (
            <p className="text-sm text-ink-muted">Aucun article réparti dans ce dépôt.</p>
          ) : (
            <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
              {items.map((item) => (
                <div key={item.itemKey} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.label}</span>
                  <span className="tabular text-sm text-ink-muted">{item.available}</span>
                  <Input name={`count-${item.itemKey}`} type="number" inputMode="numeric" min={0} defaultValue={item.available} className="tabular w-24" aria-label={`Quantité comptée pour ${item.label}`} />
                </div>
              ))}
            </div>
          )}
          <Field id="countnote" label="Note">{(p) => <Input {...p} name="note" maxLength={120} placeholder="Inventaire du soir" />}</Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton disabled={items.length === 0}>Enregistrer l&apos;inventaire</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

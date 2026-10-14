"use client";

import { useActionState, useState } from "react";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Clock, MapPin } from "lucide-react";
import { upsertDeliveryZone, deleteDeliveryZone, moveDeliveryZone, upsertPickupSlot, deletePickupSlot, togglePickupSlot, setFulfillmentOption } from "@/lib/delivery/actions";
import { updateOpeningHours } from "@/lib/store/actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Checkbox } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, AsyncSwitch, ConfirmActionButton } from "@/components/app/action-controls";
import { EmptyState } from "@/components/ui/misc";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export const DAYS = [
  { key: "mon", label: "Lundi", dow: 1 },
  { key: "tue", label: "Mardi", dow: 2 },
  { key: "wed", label: "Mercredi", dow: 3 },
  { key: "thu", label: "Jeudi", dow: 4 },
  { key: "fri", label: "Vendredi", dow: 5 },
  { key: "sat", label: "Samedi", dow: 6 },
  { key: "sun", label: "Dimanche", dow: 0 },
] as const;

const iconBtn =
  "inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2";

// ─────────────── Zones ───────────────

export type ZoneDTO = { id: string; name: string; fee: number; freeAbove: number | null; etaLabel: string | null; active: boolean };

export function ZoneDialog({ storeId, zone, currency, city, variant = "secondary" }: { storeId: string; zone?: ZoneDTO; currency: string; city?: string | null; variant?: "secondary" | "accent" }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(upsertDeliveryZone, undefined);
  const [active, setActive] = useState(zone?.active ?? true);
  const place = city ?? "Cotonou";
  // Ferme la fenêtre au succès (comparaison pendant le rendu, sans effet).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  return (
    <>
      {zone ? (
        <Button variant="ghost" size="icon" aria-label={`Modifier la zone ${zone.name}`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button variant={variant} size="sm" className="h-11 sm:h-9" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Ajouter une zone
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={zone ? "Modifier la zone" : "Nouvelle zone de livraison"} description="Le client choisit sa zone en commandant ; les frais s'ajoutent au total.">
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          {zone && <input type="hidden" name="id" value={zone.id} />}
          <Field id="zname" label="Nom de la zone" required error={fieldError(state, "name")} hint={`Quartier ou ville, par exemple « ${place}, Akpakpa ».`}>
            {(p) => <Input {...p} name="name" defaultValue={zone?.name} placeholder={`${place}, centre`} maxLength={80} />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="zfee" label={`Frais (${currency})`} required error={fieldError(state, "fee")} hint="0 = livraison gratuite.">
              {(p) => <Input {...p} name="fee" type="number" inputMode="numeric" min={0} defaultValue={zone?.fee ?? 0} className="tabular" />}
            </Field>
            <Field id="zfree" label={`Offerte dès (${currency})`} error={fieldError(state, "freeAbove")} hint="Vide = jamais offerte.">
              {(p) => <Input {...p} name="freeAbove" type="number" inputMode="numeric" min={0} defaultValue={zone?.freeAbove ?? ""} className="tabular" />}
            </Field>
          </div>
          <Field id="zeta" label="Délai affiché" error={fieldError(state, "etaLabel")} hint="Par exemple « Sous 24 h » ou « Le jour même avant 14 h ».">
            {(p) => <Input {...p} name="etaLabel" defaultValue={zone?.etaLabel ?? ""} maxLength={60} />}
          </Field>
          <div className="flex min-h-11 items-center">
            <Switch name="active" checked={active} onChange={setActive} label="Zone proposée aux clients" />
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <SubmitButton>{zone ? "Enregistrer" : "Ajouter la zone"}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function ZonesList({ storeId, zones, currency, city, canAdd }: { storeId: string; zones: ZoneDTO[]; currency: string; city?: string | null; canAdd: boolean }) {
  if (zones.length === 0) {
    return (
      <EmptyState
        compact
        icon={MapPin}
        title="Aucune zone de livraison"
        description="Ajoutez les quartiers ou villes que vous desservez, avec leurs frais."
        action={canAdd ? <ZoneDialog storeId={storeId} currency={currency} city={city} variant="accent" /> : undefined}
      />
    );
  }
  return (
    <ul className="divide-y divide-line">
      {zones.map((z, i) => (
        <li key={z.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-6">
          <div className={cn("min-w-0 flex-1", !z.active && "opacity-60")}>
            <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
              <span className="[overflow-wrap:anywhere]">{z.name}</span>
              {!z.active && <Badge tone="neutral">Masquée</Badge>}
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">
              <span className="tabular font-medium text-ink">{z.fee > 0 ? formatMoney(z.fee, currency) : "Gratuite"}</span>
              {z.freeAbove != null && <> · offerte dès <span className="tabular">{formatMoney(z.freeAbove, currency)}</span></>}
              {z.etaLabel && ` · ${z.etaLabel}`}
            </p>
          </div>
          <div className="-mr-2 flex items-center">
            {zones.length > 1 && (
              <>
                <ActionButton variant="ghost" size="icon" aria-label={`Monter ${z.name}`} disabled={i === 0} action={() => moveDeliveryZone(storeId, z.id, "up")} successMessage="Ordre mis à jour">
                  <ArrowUp className="size-4" aria-hidden />
                </ActionButton>
                <ActionButton variant="ghost" size="icon" aria-label={`Descendre ${z.name}`} disabled={i === zones.length - 1} action={() => moveDeliveryZone(storeId, z.id, "down")} successMessage="Ordre mis à jour">
                  <ArrowDown className="size-4" aria-hidden />
                </ActionButton>
              </>
            )}
            <ZoneDialog storeId={storeId} zone={z} currency={currency} city={city} />
            <ConfirmActionButton title={`Supprimer « ${z.name} » ?`} description="Les commandes passées conservent le nom de la zone." confirmLabel="Supprimer" action={() => deleteDeliveryZone(storeId, z.id)} className={iconBtn}>
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Supprimer {z.name}</span>
            </ConfirmActionButton>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─────────────── Créneaux de retrait ───────────────

export type SlotDTO = { id: string; dayOfWeek: number; startTime: string; endTime: string; capacity: number | null; active: boolean };

export function SlotDialog({ storeId, slot, variant = "secondary" }: { storeId: string; slot?: SlotDTO; variant?: "secondary" | "accent" }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(upsertPickupSlot, undefined);
  const [active, setActive] = useState(slot?.active ?? true);
  // Ferme la fenêtre au succès (comparaison pendant le rendu, sans effet).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  return (
    <>
      {slot ? (
        <Button variant="ghost" size="icon" aria-label="Modifier le créneau" onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button variant={variant} size="sm" className="h-11 sm:h-9" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Ajouter un créneau
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={slot ? "Modifier le créneau" : "Nouveau créneau de retrait"} description="Le client choisit un créneau en commandant.">
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          {slot && <input type="hidden" name="id" value={slot.id} />}
          <Field id="sday" label="Jour" required>
            {(p) => (
              <Select {...p} name="dayOfWeek" defaultValue={slot?.dayOfWeek ?? 1}>
                {DAYS.map((d) => (
                  <option key={d.key} value={d.dow}>{d.label}</option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field id="sstart" label="Début" required error={fieldError(state, "startTime")}>
              {(p) => <Input {...p} name="startTime" type="time" defaultValue={slot?.startTime ?? "09:00"} className="tabular" />}
            </Field>
            <Field id="send" label="Fin" required error={fieldError(state, "endTime")}>
              {(p) => <Input {...p} name="endTime" type="time" defaultValue={slot?.endTime ?? "12:00"} className="tabular" />}
            </Field>
            <Field id="scap" label="Capacité" error={fieldError(state, "capacity")} hint="Vide = sans limite.">
              {(p) => <Input {...p} name="capacity" type="number" inputMode="numeric" min={1} defaultValue={slot?.capacity ?? ""} className="tabular" />}
            </Field>
          </div>
          <div className="flex min-h-11 items-center">
            <Switch name="active" checked={active} onChange={setActive} label="Créneau proposé aux clients" />
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <SubmitButton>{slot ? "Enregistrer" : "Ajouter le créneau"}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function SlotsList({ storeId, slots }: { storeId: string; slots: SlotDTO[] }) {
  if (slots.length === 0) {
    return (
      <EmptyState
        compact
        icon={Clock}
        title="Aucun créneau de retrait"
        description="Par exemple : lundi de 09:00 à 12:00, 10 commandes maximum."
        action={<SlotDialog storeId={storeId} variant="accent" />}
      />
    );
  }
  const byDay = DAYS.map((d) => ({ ...d, slots: slots.filter((s) => s.dayOfWeek === d.dow).sort((a, b) => a.startTime.localeCompare(b.startTime)) })).filter((d) => d.slots.length);
  return (
    <div className="divide-y divide-line">
      {byDay.map((d) => (
        <div key={d.key} className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[120px_1fr] sm:gap-4 sm:px-6">
          <p className="pt-3 text-sm font-medium text-ink">{d.label}</p>
          <ul className="divide-y divide-line">
            {d.slots.map((s) => (
              <li key={s.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5")}>
                <span className={cn("font-mono text-sm tabular text-ink", !s.active && "text-ink-muted")}>
                  {s.startTime} à {s.endTime}
                </span>
                <span className="text-sm text-ink-muted">{s.capacity != null ? `${s.capacity} commande${s.capacity > 1 ? "s" : ""} max.` : "Sans limite"}</span>
                <div className="ml-auto -mr-2 flex items-center gap-1">
                  <AsyncSwitch checked={s.active} label={s.active ? "Proposé" : "Masqué"} action={(v) => togglePickupSlot(storeId, s.id, v)} />
                  <SlotDialog storeId={storeId} slot={s} />
                  <ConfirmActionButton title="Supprimer ce créneau ?" description={`${d.label}, ${s.startTime} à ${s.endTime}.`} confirmLabel="Supprimer" action={() => deletePickupSlot(storeId, s.id)} className={iconBtn}>
                    <Trash2 className="size-4" aria-hidden />
                    <span className="sr-only">Supprimer le créneau {d.label} {s.startTime}</span>
                  </ConfirmActionButton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ─────────────── Horaires d'ouverture ───────────────

type Range = [string, string];
type Hours = Record<string, Range[]>;

export function HoursGrid({ storeId, initial }: { storeId: string; initial: Hours }) {
  const [state, action] = useActionState(updateOpeningHours, undefined);
  const [hours, setHours] = useState<Hours>(() => Object.fromEntries(DAYS.map((d) => [d.key, initial[d.key] ?? []])));

  const setDay = (key: string, ranges: Range[]) => setHours((h) => ({ ...h, [key]: ranges }));
  const payload = JSON.stringify(Object.fromEntries(Object.entries(hours).filter(([, r]) => r.length)));

  return (
    <form action={action} noValidate>
      <div className="px-5 sm:px-6">
        <FormMessage state={state} />
      </div>
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="hours" value={payload} />
      <div className="divide-y divide-line">
        {DAYS.map((d) => {
          const ranges = hours[d.key];
          const openDay = ranges.length > 0;
          return (
            <div key={d.key} className="grid grid-cols-1 gap-2 px-5 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-4 sm:px-6">
              <Checkbox label={d.label} checked={openDay} onChange={(e) => setDay(d.key, e.target.checked ? [["08:00", "18:00"]] : [])} className="min-h-11 items-center" />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {!openDay && <p className="text-sm text-ink-faint">Fermé</p>}
                {ranges.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input type="time" aria-label={`${d.label}, plage ${i + 1}, ouverture`} value={r[0]} onChange={(e) => setDay(d.key, ranges.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} className="h-11 w-[7.5rem] tabular" />
                    <span className="text-sm text-ink-muted">à</span>
                    <Input type="time" aria-label={`${d.label}, plage ${i + 1}, fermeture`} value={r[1]} onChange={(e) => setDay(d.key, ranges.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} className="h-11 w-[7.5rem] tabular" />
                    {ranges.length > 1 && (
                      <Button variant="ghost" size="icon" aria-label={`Retirer la plage ${i + 1} du ${d.label.toLowerCase()}`} onClick={() => setDay(d.key, ranges.filter((_, j) => j !== i))}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                ))}
                {openDay && ranges.length < 2 && (
                  <Button variant="ghost" size="sm" className="h-11 text-primary sm:h-9" onClick={() => setDay(d.key, [...ranges, ["14:00", "18:00"]])}>
                    <Plus className="size-4" aria-hidden /> Ajouter une plage
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end border-t border-line px-5 py-3.5 sm:px-6">
        <SubmitButton>Enregistrer les horaires</SubmitButton>
      </div>
    </form>
  );
}

// ─────────────── Interrupteurs retrait / livraison ───────────────

export function FulfillmentToggle({ storeId, option, checked }: { storeId: string; option: "pickupEnabled" | "deliveryEnabled"; checked: boolean }) {
  return <AsyncSwitch checked={checked} label={checked ? "Activé" : "Désactivé"} action={(v) => setFulfillmentOption(storeId, option, v)} />;
}

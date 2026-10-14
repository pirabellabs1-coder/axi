"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { deleteAddress, saveAddress, setDefaultAddress } from "@/lib/buyer/actions";
import type { ActionResult } from "@/lib/action";
import { btnClass } from "@/components/storefront/ui";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SfField, SfFormError, SfSubmit, sfFieldError } from "./sf-form";

export type AddressView = {
  id: string;
  label: string | null;
  recipientName: string | null;
  phone: string | null;
  phoneDisplay: string | null;
  address: string;
  landmark: string | null;
  city: string | null;
  deliveryZoneId: string | null;
  zoneName: string | null;
  zoneInactive: boolean;
  isDefault: boolean;
};

type Zone = { id: string; name: string };

/** Carnet d'adresses (10 au plus, une par défaut, zone de livraison associée). */
export function AddressManager({ slug, addresses, zones, max, readOnly }: { slug: string; addresses: AddressView[]; zones: Zone[]; max: number; readOnly: boolean }) {
  const [editing, setEditing] = useState<AddressView | "new" | null>(addresses.length === 0 && !readOnly ? "new" : null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const full = addresses.length >= max;

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Enregistré");
      else toast.error(r.error);
      setConfirmId(null);
    });

  return (
    <div className="space-y-5">
      {addresses.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Mes adresses">
          {addresses.map((a) => (
            <li key={a.id} className={cn("flex flex-col rounded-[var(--store-card-radius,20px)] bg-surface p-5", a.isDefault ? "ring-2 ring-[var(--store-primary)]" : "ring-1 ring-line")}>
              <div className="flex items-start justify-between gap-3">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <MapPin className="size-4 text-[var(--store-primary)]" aria-hidden /> {a.label || "Adresse"}
                </p>
                {a.isDefault && <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold text-ink">Par défaut</span>}
              </div>
              <div className="mt-2 flex-1 space-y-0.5 text-sm text-ink-muted [overflow-wrap:anywhere]">
                {a.recipientName && <p className="text-ink">{a.recipientName}</p>}
                <p>{a.address}</p>
                {a.landmark && <p>Repère : {a.landmark}</p>}
                {a.city && <p>{a.city}</p>}
                {a.phoneDisplay && <p className="tabular-nums">{a.phoneDisplay}</p>}
                {a.zoneName && !a.zoneInactive && <p>Zone : {a.zoneName}</p>}
                {a.zoneInactive && <p className="font-medium text-[#8a5a00]">Zone de livraison à resélectionner lors de la commande.</p>}
              </div>
              {!readOnly && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => setEditing(a)} className={btnClass("soft", "sm")}>
                    <Pencil className="size-3.5" aria-hidden /> Modifier
                  </button>
                  {!a.isDefault && (
                    <button type="button" disabled={pending} onClick={() => run(() => setDefaultAddress(slug, a.id))} className={btnClass("soft", "sm")}>
                      <Star className="size-3.5" aria-hidden /> Par défaut
                    </button>
                  )}
                  {confirmId === a.id ? (
                    <span className="inline-flex items-center gap-1.5">
                      <button type="button" disabled={pending} onClick={() => run(() => deleteAddress(slug, a.id))} className="inline-flex h-10 items-center rounded-full bg-danger px-4 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60">
                        Confirmer
                      </button>
                      <button type="button" onClick={() => setConfirmId(null)} className={btnClass("soft", "sm")}>
                        Annuler
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmId(a.id)} aria-label={`Supprimer l'adresse ${a.label || a.address}`} className="inline-flex size-11 items-center justify-center rounded-full text-danger hover:bg-danger-soft">
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <AddressForm key={editing === "new" ? "new" : editing.id} slug={slug} zones={zones} initial={editing === "new" ? null : editing} first={addresses.length === 0} onDone={() => setEditing(null)} />
      ) : (
        !readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={full} onClick={() => setEditing("new")} className={cn(btnClass("outline", "md"), "disabled:opacity-50")}>
              <Plus className="size-4" aria-hidden /> Ajouter une adresse
            </button>
            <p className="text-[13px] text-ink-muted">{full ? `Limite de ${max} adresses atteinte.` : `${addresses.length} sur ${max}`}</p>
          </div>
        )
      )}
    </div>
  );
}

function AddressForm({ slug, zones, initial, first, onDone }: { slug: string; zones: Zone[]; initial: AddressView | null; first: boolean; onDone: () => void }) {
  const [state, action] = useActionState(saveAddress, undefined);
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Adresse enregistrée");
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const err = (n: string) => sfFieldError(state, n);
  return (
    <form action={action} className="rounded-[var(--store-card-radius,20px)] bg-surface p-5 ring-1 ring-line sm:p-6" noValidate aria-labelledby="address-form-title">
      <h2 id="address-form-title" className="mb-4 text-base font-semibold text-ink">
        {initial ? "Modifier l'adresse" : "Nouvelle adresse"}
      </h2>
      <input type="hidden" name="slug" value={slug} />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SfField id="addr-label" label="Nom de l'adresse" optional hint="Maison, Bureau…" error={err("label")}>
          {(p) => <input {...p} name="label" maxLength={40} defaultValue={initial?.label ?? ""} className="sf-input" />}
        </SfField>
        <SfField id="addr-recipient" label="Destinataire" optional error={err("recipientName")}>
          {(p) => <input {...p} name="recipientName" autoComplete="name" maxLength={80} defaultValue={initial?.recipientName ?? ""} className="sf-input" />}
        </SfField>
        <div className="sm:col-span-2">
          <SfField id="addr-address" label="Adresse" hint="Quartier, rue, maison" error={err("address")}>
            {(p) => <input {...p} name="address" autoComplete="street-address" required maxLength={300} defaultValue={initial?.address ?? ""} className="sf-input" />}
          </SfField>
        </div>
        <SfField id="addr-landmark" label="Point de repère" optional hint="Près de la pharmacie…" error={err("landmark")}>
          {(p) => <input {...p} name="landmark" maxLength={200} defaultValue={initial?.landmark ?? ""} className="sf-input" />}
        </SfField>
        <SfField id="addr-city" label="Ville" optional error={err("city")}>
          {(p) => <input {...p} name="city" autoComplete="address-level2" maxLength={80} defaultValue={initial?.city ?? ""} className="sf-input" />}
        </SfField>
        <SfField id="addr-phone" label="Téléphone du destinataire" optional error={err("phone")}>
          {(p) => <input {...p} name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} defaultValue={initial?.phone ?? ""} className="sf-input" />}
        </SfField>
        {zones.length > 0 && (
          <SfField id="addr-zone" label="Zone de livraison" optional error={err("deliveryZoneId")}>
            {(p) => (
              <select {...p} name="deliveryZoneId" defaultValue={initial && !initial.zoneInactive ? (initial.deliveryZoneId ?? "") : ""} className="sf-input">
                <option value="">Choisir au moment de commander</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            )}
          </SfField>
        )}
      </div>
      {!first && !initial?.isDefault && (
        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
          <input type="checkbox" name="isDefault" value="true" className="size-5 accent-[var(--store-primary)]" />
          Utiliser par défaut
        </label>
      )}
      <div className="mt-4">
        <SfFormError state={state} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <SfSubmit>{initial ? "Enregistrer" : "Ajouter l'adresse"}</SfSubmit>
        {!first && (
          <button type="button" onClick={onDone} className={btnClass("soft", "md")}>
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}

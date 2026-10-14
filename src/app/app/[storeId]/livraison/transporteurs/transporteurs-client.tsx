"use client";

import { useActionState, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { upsertCarrierAccount, deleteCarrierAccount } from "@/lib/shipping/actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Checkbox } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ConfirmActionButton } from "@/components/app/action-controls";
import { CARRIER_IDS, CARRIER_LABELS, type CarrierId } from "@/lib/carriers/types";

/** Champs d'identifiants attendus par transporteur (miroir des adaptateurs ; jamais relus en clair). */
const CREDENTIAL_FIELDS: Record<CarrierId, { key: string; label: string }[]> = {
  manual: [],
  gozem: [
    { key: "apiKey", label: "Clé d'API Gozem Business" },
    { key: "webhookSecret", label: "Secret des webhooks" },
  ],
  yango: [
    { key: "apiKey", label: "Jeton Yango Delivery" },
    { key: "webhookSecret", label: "Secret des webhooks" },
  ],
  dhl: [
    { key: "apiKey", label: "Clé d'API DHL" },
    { key: "apiSecret", label: "Secret d'API DHL" },
    { key: "accountNumber", label: "Numéro de compte DHL" },
    { key: "webhookSecret", label: "Secret des webhooks" },
  ],
  laposte_bj: [
    { key: "apiKey", label: "Identifiant La Poste du Bénin" },
    { key: "webhookSecret", label: "Secret des webhooks" },
  ],
};

export function CarrierDialog({ storeId, canUseApi, account }: { storeId: string; canUseApi: boolean; account?: { id: string; carrier: CarrierId; name: string; active: boolean } }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(upsertCarrierAccount, undefined);
  const [carrier, setCarrier] = useState<CarrierId>(account?.carrier ?? "manual");
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }
  const fields = CREDENTIAL_FIELDS[carrier] ?? [];
  return (
    <>
      {account ? (
        <Button variant="ghost" size="icon" aria-label={`Modifier ${account.name}`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button variant="accent" size="sm" className="h-11 sm:h-9" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Ajouter un transporteur
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={account ? "Modifier le transporteur" : "Nouveau transporteur"} description="Les identifiants sont chiffrés et ne sont jamais réaffichés.">
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          {account && <input type="hidden" name="id" value={account.id} />}
          <Field id="ctype" label="Transporteur" required>
            {(p) => (
              <Select {...p} name="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value as CarrierId)}>
                {CARRIER_IDS.map((id) => (
                  <option key={id} value={id} disabled={id !== "manual" && !canUseApi}>
                    {CARRIER_LABELS[id]}
                    {id !== "manual" && !canUseApi ? " — plan Scale" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="cname" label="Nom affiché" required error={fieldError(state, "name")} hint="Par exemple « Moto Kofi » ou « DHL Cotonou ».">
            {(p) => <Input {...p} name="name" defaultValue={account?.name} maxLength={80} placeholder="Livreur de la boutique" />}
          </Field>
          {fields.length > 0 && (
            <div className="space-y-3 rounded-[var(--radius-md)] bg-surface-2/60 p-3 ring-1 ring-inset ring-line">
              <p className="text-sm text-ink-muted">
                Identifiants fournis par le transporteur. Laissez vide pour ne rien changer. L&apos;intégration API de ce transporteur n&apos;est pas encore activée : utilisez un livreur interne pour créer des expéditions.
              </p>
              {fields.map((f) => (
                <Field key={f.key} id={`cred-${f.key}`} label={f.label}>
                  {(p) => <Input {...p} name={`cred-${f.key}`} type="password" autoComplete="off" maxLength={300} />}
                </Field>
              ))}
            </div>
          )}
          <Checkbox name="active" defaultChecked={account?.active ?? true} label="Transporteur actif" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton>{account ? "Enregistrer" : "Ajouter"}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function CarrierDelete({ storeId, id, name }: { storeId: string; id: string; name: string }) {
  return (
    <ConfirmActionButton action={() => deleteCarrierAccount(storeId, id)} title={`Supprimer « ${name} » ?`} description="S'il a déjà servi à des expéditions, il sera simplement désactivé." confirmLabel="Supprimer">
      <span className="inline-flex items-center gap-1.5">
        <Trash2 className="size-4" aria-hidden /> Supprimer
      </span>
    </ConfirmActionButton>
  );
}

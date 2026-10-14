"use client";

import { useActionState, useState } from "react";
import { Truck } from "lucide-react";
import { createShipmentAction, revokeCourierToken, updateShipmentStatus } from "@/lib/shipping/actions";
import { Field, Input, Select, Checkbox } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { SHIPMENT_STATUS_LABELS, type ShipmentStatusValue } from "@/lib/shipping/state";

/**
 * Formulaires d'expédition (lot 3 §1.2). Le code de remise n'est affiché QU'UNE FOIS, au retour de
 * l'action : il n'est pas relisible ensuite (seule son empreinte est en base).
 */
export function CreateShipmentForm({
  storeId,
  orderId,
  items,
  carriers,
  locations,
  defaultLocationId,
  canUseDeliveryCode,
}: {
  storeId: string;
  orderId: string;
  items: { id: string; label: string; remaining: number; quantity: number }[];
  carriers: { id: string; name: string; carrier: string }[];
  locations: { id: string; name: string }[];
  defaultLocationId: string | null;
  canUseDeliveryCode: boolean;
}) {
  const [state, action] = useActionState(createShipmentAction, undefined);
  const code = state?.ok ? state.data?.deliveryCode : null;

  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} toastSuccess={false} />
      {code && (
        <Alert tone="success" title="Code de remise à transmettre à l'acheteur">
          <span className="tabular text-xl font-semibold">{code}</span> — ce code ne sera plus affiché. Le livreur devra le saisir pour valider la livraison.
        </Alert>
      )}
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="orderId" value={orderId} />

      <div className="space-y-3">
        <p className="text-sm font-medium text-ink">Articles à expédier</p>
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.label}</span>
            <span className="tabular text-sm text-ink-muted">reste {item.remaining}</span>
            <Input
              name={`ship-${item.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={item.remaining}
              defaultValue={item.remaining}
              disabled={item.remaining === 0}
              className="tabular w-24"
              aria-label={`Quantité à expédier pour ${item.label}`}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="shcarrier" label="Transporteur">
          {(p) => (
            <Select {...p} name="carrierAccountId" defaultValue="">
              <option value="">Livreur interne (étiquette Axi)</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="shloc" label="Dépôt d'expédition">
          {(p) => (
            <Select {...p} name="locationId" defaultValue={defaultLocationId ?? ""}>
              <option value="">Dépôt par défaut</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="shcourier" label="Nom du livreur">{(p) => <Input {...p} name="courierName" maxLength={80} placeholder="Kofi" />}</Field>
        <Field id="shphone" label="Téléphone du livreur">{(p) => <Input {...p} name="courierPhone" type="tel" maxLength={20} />}</Field>
        <Field id="shtrack" label="Numéro de suivi" error={fieldError(state, "trackingNumber")} hint="Fourni par le transporteur, facultatif.">
          {(p) => <Input {...p} name="trackingNumber" maxLength={60} />}
        </Field>
      </div>

      <Checkbox
        name="withDeliveryCode"
        defaultChecked={canUseDeliveryCode}
        disabled={!canUseDeliveryCode}
        label="Exiger un code de remise à 4 chiffres"
        description={canUseDeliveryCode ? "Anti-fraude : le livreur doit saisir le code de l'acheteur (5 essais)." : "Inclus à partir du plan Business."}
      />

      <div className="flex justify-end">
        <SubmitButton>
          <Truck className="size-4" aria-hidden /> Créer l&apos;expédition
        </SubmitButton>
      </div>
    </form>
  );
}

export function ShipmentStatusForm({ storeId, shipmentId, options }: { storeId: string; shipmentId: string; options: ShipmentStatusValue[] }) {
  const [state, action] = useActionState(updateShipmentStatus, undefined);
  if (!options.length) return <p className="text-sm text-ink-muted">Cette expédition est clôturée.</p>;
  return (
    <form action={action} noValidate className="flex flex-wrap items-end gap-3">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <Field id={`status-${shipmentId}`} label="Faire avancer l'expédition" className="min-w-52">
        {(p) => (
          <Select {...p} name="status" defaultValue={options[0]}>
            {options.map((status) => (
              <option key={status} value={status}>
                {SHIPMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id={`msg-${shipmentId}`} label="Commentaire" className="min-w-52">
        {(p) => <Input {...p} name="message" maxLength={200} placeholder="Confié au livreur" />}
      </Field>
      <SubmitButton variant="secondary" className="h-11 sm:h-10">
        Enregistrer
      </SubmitButton>
    </form>
  );
}

/**
 * Révocation du lien livreur (mineur n° 6). Le jeton d'URL vaut accès sans authentification à l'adresse
 * et au téléphone du client : le commerçant doit pouvoir le couper immédiatement.
 */
export function RevokeCourierLink({ storeId, shipmentId }: { storeId: string; shipmentId: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={async () => {
        if (!window.confirm("Révoquer ce lien livreur ? Il cessera immédiatement de fonctionner.")) return;
        setPending(true);
        const r = await revokeCourierToken(storeId, shipmentId);
        setPending(false);
        if (r.ok) toast.success(r.message ?? "Lien révoqué");
        else toast.error(r.error);
      }}
    >
      Révoquer le lien livreur
    </Button>
  );
}

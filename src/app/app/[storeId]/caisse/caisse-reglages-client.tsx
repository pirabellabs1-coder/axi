"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { registerPosDevice, revokePosDevice, setPosManagerCode, clearPosManagerCode } from "@/lib/pos/actions";
import { MANAGER_CODE_MAX_LENGTH, MANAGER_CODE_MIN_LENGTH } from "@/lib/pos/manager-code-shape";
import { formatDateTime } from "@/lib/utils";

/**
 * Réglages de la caisse DANS l'espace marchand (barre latérale conservée) : appareils, jeton affiché
 * une seule fois, code du gérant. Ces écrans ont quitté l'interface de vente plein écran : ils n'ont
 * rien à faire sous les yeux d'un client au comptoir, et le gérant les règle depuis son bureau.
 */

export type DeviceRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  locationName: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  openSession: boolean;
};

/**
 * Panneau des appareils. L'état de l'action vit dans CE composant, qui reste monté : le jeton,
 * affiché une seule fois, survit à la revalidation de la page serveur après l'enregistrement.
 */
export function DevicesPanel({
  storeId,
  devices,
  locations,
  limit,
  planName,
  canManage,
}: {
  storeId: string;
  devices: DeviceRow[];
  locations: { id: string; name: string }[];
  limit: number | null;
  planName: string;
  canManage: boolean;
}) {
  const [state, action] = useActionState(registerPosDevice, undefined);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(state);
  const token = state?.ok ? state.data?.token : null;
  const atLimit = limit != null && devices.length >= limit;

  // L'enregistrement réussi ferme la fenêtre : le jeton, affiché une seule fois, est dans le bandeau
  // de la carte, qui resterait sinon caché derrière la fenêtre modale.
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }

  return (
    <Card>
      <CardHeader
        title="Appareils de caisse"
        description={
          limit == null
            ? "Nombre d'appareils illimité sur votre plan. Chaque appareil est lié à un dépôt : c'est lui qui est décrémenté à la vente."
            : `${devices.length} sur ${limit} appareil${limit > 1 ? "s" : ""} avec le plan ${planName}. Chaque appareil est lié à un dépôt : c'est lui qui est décrémenté à la vente.`
        }
        action={
          canManage ? (
            <Button variant="accent" size="sm" className="h-11 sm:h-9" onClick={() => setOpen(true)} disabled={atLimit || locations.length === 0}>
              <Plus className="size-4" aria-hidden /> Enregistrer un appareil
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-3">
        {token && (
          <Alert tone="success" title="Jeton de l'appareil (affiché une seule fois)">
            <code className="block break-all font-mono text-xs">{token}</code>
            <span className="mt-2 block">
              Notez-le maintenant : il ne sera plus jamais affiché. Ouvrez l&apos;écran de vente sur la tablette du comptoir, puis collez ce jeton
              pour y associer l&apos;appareil.
            </span>
          </Alert>
        )}

        {canManage && atLimit && (
          <Alert tone="warning" title="Limite d'appareils atteinte">
            Votre plan {planName} permet {limit} appareil{(limit ?? 0) > 1 ? "s" : ""} de caisse. Révoquez un appareil ou changez de plan pour en
            ajouter un autre.
          </Alert>
        )}
        {canManage && locations.length === 0 && (
          <Alert tone="warning" title="Aucun dépôt actif">
            Un appareil de caisse doit être rattaché à un dépôt (c&apos;est lui dont le stock baisse à chaque vente). Créez un dépôt avant
            d&apos;enregistrer un appareil.
          </Alert>
        )}

        {devices.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {canManage
              ? "Aucun appareil enregistré. Enregistrez la tablette du comptoir pour commencer à encaisser."
              : "Aucun appareil enregistré. Demandez au gérant d'enregistrer la tablette du comptoir."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {device.name}
                    {device.openSession && <Badge tone="success">Session ouverte</Badge>}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {device.locationName} · jeton <span className="font-mono text-xs">{device.tokenPrefix}…</span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {device.lastSyncAt ? `Dernière synchronisation : ${formatDateTime(device.lastSyncAt)}` : "Jamais synchronisé"}
                  </p>
                </div>
                {canManage && <RevokeDeviceButton storeId={storeId} deviceId={device.id} name={device.name} />}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Nouvel appareil de caisse"
        description="Un jeton est généré et affiché une seule fois : vous le collerez sur l'appareil, dans l'écran de vente."
      >
        <form action={action} noValidate className="space-y-4">
          <FormMessage state={state} toastSuccess={false} />
          <input type="hidden" name="storeId" value={storeId} />
          <Field id="devname" label="Nom de l'appareil" required error={fieldError(state, "name")}>
            {(p) => <Input {...p} name="name" maxLength={60} placeholder="Tablette comptoir" />}
          </Field>
          <Field id="devloc" label="Dépôt (stock décrémenté à chaque vente)" required>
            {(p) => (
              <Select {...p} name="locationId">
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Fermer
            </Button>
            <SubmitButton>Enregistrer</SubmitButton>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

function RevokeDeviceButton({ storeId, deviceId, name }: { storeId: string; deviceId: string; name: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-11 sm:h-9"
      loading={pending}
      onClick={async () => {
        if (!window.confirm(`Révoquer « ${name} » ? Cet appareil cessera d'encaisser ; ses ventes déjà en file resteront acceptées 24 h.`)) return;
        setPending(true);
        const r = await revokePosDevice(storeId, deviceId);
        setPending(false);
        if (r.ok) toast.success(r.message ?? "Appareil révoqué");
        else toast.error(r.error);
      }}
    >
      Révoquer
    </Button>
  );
}

/**
 * Code du gérant : seule façon d'autoriser une remise au-delà du plafond d'un rôle. Conservé sous
 * forme d'empreinte, jamais réaffiché ; sa définition exige `store.settings`.
 */
export function ManagerCodeCard({ storeId, isSet, setAt, canManage }: { storeId: string; isSet: boolean; setAt: string | null; canManage: boolean }) {
  const [state, action] = useActionState(setPosManagerCode, undefined);
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Code du gérant"
        description="Quatre à six chiffres demandés au comptoir lorsqu'un caissier accorde une remise supérieure au plafond de son rôle (caissier 10 %, gérant 50 %, propriétaire 100 %)."
      />
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-muted">
          État :{" "}
          {isSet ? (
            <span className="font-medium text-ink">défini{setAt ? ` le ${formatDateTime(setAt)}` : ""}</span>
          ) : (
            <span className="font-medium text-warning">non défini, aucune remise au-delà des plafonds de rôle n&apos;est possible</span>
          )}
        </p>

        {canManage ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="h-11 sm:h-9" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                {isSet ? "Remplacer le code" : "Définir le code"}
              </Button>
              {isSet && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 sm:h-9"
                  loading={clearing}
                  onClick={async () => {
                    if (!window.confirm("Retirer le code du gérant ? Aucune remise au-delà des plafonds de rôle ne sera plus possible.")) return;
                    setClearing(true);
                    const r = await clearPosManagerCode(storeId);
                    setClearing(false);
                    if (r.ok) toast.success(r.message ?? "Code retiré");
                    else toast.error(r.error);
                  }}
                >
                  Retirer le code
                </Button>
              )}
            </div>

            {open && (
              <form action={action} noValidate className="space-y-3 border-t border-line pt-3">
                <FormMessage state={state} />
                <input type="hidden" name="storeId" value={storeId} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="mgrcode" label={`Nouveau code (${MANAGER_CODE_MIN_LENGTH} à ${MANAGER_CODE_MAX_LENGTH} chiffres)`} required error={fieldError(state, "code")}>
                    {(p) => <Input {...p} name="code" type="password" inputMode="numeric" autoComplete="new-password" maxLength={MANAGER_CODE_MAX_LENGTH} className="tabular" />}
                  </Field>
                  <Field id="mgrcode2" label="Confirmer le code" required error={fieldError(state, "confirm")}>
                    {(p) => <Input {...p} name="confirm" type="password" inputMode="numeric" autoComplete="new-password" maxLength={MANAGER_CODE_MAX_LENGTH} className="tabular" />}
                  </Field>
                </div>
                <p className="text-xs text-ink-muted">
                  Il n&apos;est jamais réaffiché. Chaque usage est journalisé (<span className="font-mono">pos.manager_override</span>) et cinq
                  essais erronés bloquent le dépassement quinze minutes.
                </p>
                <SubmitButton variant="secondary">Enregistrer le code</SubmitButton>
              </form>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-muted">Seuls le propriétaire et le gérant peuvent définir ce code.</p>
        )}
      </CardBody>
    </Card>
  );
}

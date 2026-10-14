"use client";

import { useActionState, useState, useTransition } from "react";
import { PhoneCall, MapPin, Check, X, Truck } from "lucide-react";
import { courierDeliverAction, courierFailAction, courierPickUpAction, revealPhoneAction } from "@/lib/shipping/courier-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { toast } from "@/components/ui/toast";
import { Alert } from "@/components/ui/misc";
import type { ShipmentStatusValue } from "@/lib/shipping/state";

/**
 * Actions du livreur : « Récupéré », « Livré » (code de l'acheteur ou photo de preuve) et « Échec »
 * avec motif. La géolocalisation est FACULTATIVE : rien n'est envoyé sans que le livreur l'ait
 * explicitement acceptée.
 */
export function CourierActions({
  token,
  status,
  requiresCode,
  attemptsLeft,
  hasProofPhoto,
}: {
  token: string;
  status: ShipmentStatusValue;
  requiresCode: boolean;
  attemptsLeft: number;
  /** Une photo de preuve a déjà été téléversée et enregistrée par le serveur. */
  hasProofPhoto: boolean;
}) {
  const [geo, setGeo] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoAsked, setGeoAsked] = useState(false);
  const [proofSent, setProofSent] = useState(hasProofPhoto);
  const [uploading, setUploading] = useState(false);
  const [pickupState, pickupAction] = useActionState(courierPickUpAction, undefined);
  const [deliverState, deliverAction] = useActionState(courierDeliverAction, undefined);
  const [failState, failAction] = useActionState(courierFailAction, undefined);
  const [revealing, startReveal] = useTransition();
  const [phone, setPhone] = useState<string | null>(null);

  const terminal = status === "DELIVERED" || status === "RETURNED" || status === "CANCELLED";
  const canPickUp = status === "PENDING" || status === "LABEL_CREATED";
  const canDeliver = status === "PICKED_UP" || status === "IN_TRANSIT" || status === "OUT_FOR_DELIVERY" || status === "FAILED_ATTEMPT";

  function askGeo() {
    setGeoAsked(true);
    if (!navigator.geolocation) {
      toast.error("Position non disponible sur cet appareil.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        toast.success("Position ajoutée");
      },
      () => toast.error("Position refusée : la livraison reste possible."),
      { timeout: 8000 },
    );
  }

  const geoFields = (
    <>
      {geo && <input type="hidden" name="latitude" value={geo.latitude} />}
      {geo && <input type="hidden" name="longitude" value={geo.longitude} />}
    </>
  );

  if (terminal) {
    return (
      <Alert tone="success" title="Livraison clôturée">
        Rien de plus à faire. Merci !
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            startReveal(async () => {
              const r = await revealPhoneAction(token);
              if (r.ok && r.data) {
                setPhone(r.data.phone);
                window.location.href = `tel:+${r.data.phone}`;
              } else if (!r.ok) toast.error(r.error);
            })
          }
          loading={revealing}
        >
          <PhoneCall className="size-4" aria-hidden /> Appeler le client
        </Button>
        <Button variant="ghost" onClick={askGeo} disabled={geoAsked && !!geo}>
          <MapPin className="size-4" aria-hidden /> {geo ? "Position ajoutée" : "Ajouter ma position"}
        </Button>
      </div>
      {phone && <p className="tabular text-sm text-ink-muted">+{phone}</p>}

      {canPickUp && (
        <Card>
          <CardHeader title="J'ai récupéré le colis" />
          <CardBody>
            <form action={pickupAction} className="space-y-3">
              <FormMessage state={pickupState} />
              <input type="hidden" name="token" value={token} />
              {geoFields}
              <SubmitButton className="w-full">
                <Truck className="size-4" aria-hidden /> Marquer comme récupéré
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
      )}

      {canDeliver && (
        <Card>
          <CardHeader
            title="J'ai livré"
            description={requiresCode ? `Demandez au client son code à 4 chiffres (${attemptsLeft} essai${attemptsLeft > 1 ? "s" : ""} restant${attemptsLeft > 1 ? "s" : ""}).` : "Prenez une photo de la remise : elle est envoyée au commerçant et vaut preuve de livraison."}
          />
          <CardBody className="space-y-3">
            {/* La photo part par le stockage de la plateforme AVANT la confirmation : le formulaire ne
                transporte aucune URL, et le serveur ne reconnaît que sa propre clé interne (mineur n° 5). */}
            {!requiresCode && <ProofUpload token={token} sent={proofSent} uploading={uploading} setUploading={setUploading} onSent={() => setProofSent(true)} />}
            <form action={deliverAction} className="space-y-3">
              <FormMessage state={deliverState} />
              <input type="hidden" name="token" value={token} />
              {geoFields}
              {requiresCode && (
                <Field id="code" label="Code de l'acheteur" required error={fieldError(deliverState, "code")}>
                  {(p) => <Input {...p} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={4} className="tabular text-center text-2xl tracking-[0.4em]" placeholder="0000" />}
                </Field>
              )}
              <SubmitButton className="w-full" disabled={(attemptsLeft === 0 && requiresCode) || (!requiresCode && !proofSent) || uploading}>
                <Check className="size-4" aria-hidden /> Confirmer la livraison
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
      )}

      {canDeliver && (
        <Card>
          <CardHeader title="Je n'ai pas pu livrer" />
          <CardBody>
            <form action={failAction} className="space-y-3">
              <FormMessage state={failState} />
              <input type="hidden" name="token" value={token} />
              {geoFields}
              <Field id="reason" label="Motif" required error={fieldError(failState, "reason")} hint="Client absent, adresse introuvable, refus…">
                {(p) => <Input {...p} name="reason" maxLength={200} placeholder="Client absent" />}
              </Field>
              <SubmitButton variant="secondary" className="w-full">
                <X className="size-4" aria-hidden /> Signaler l&apos;échec
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
      )}

      <p className="text-xs text-ink-muted">Vos actions sont horodatées et transmises au commerçant.</p>
    </div>
  );
}

/**
 * Téléversement de la photo de preuve de remise (mineur n° 5). Les octets partent vers
 * `POST /api/livraison/{token}/preuve`, qui vérifie le format, le quota de la boutique et enregistre la
 * CLÉ INTERNE du stockage sur l'expédition. Le livreur ne manipule donc aucune URL : impossible de faire
 * passer une image quelconque — ou celle d'une autre livraison — pour une preuve.
 */
function ProofUpload({
  token,
  sent,
  uploading,
  setUploading,
  onSent,
}: {
  token: string;
  sent: boolean;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  onSent: () => void;
}) {
  async function upload(file: File) {
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      toast.error("Envoyez une photo (JPEG, PNG, WebP).");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/livraison/${encodeURIComponent(token)}/preuve`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        toast.error(body.error?.message ?? "L'envoi de la photo a échoué.");
        return;
      }
      onSent();
      toast.success("Photo de preuve envoyée");
    } catch {
      toast.error("Réseau indisponible : réessayez l'envoi de la photo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Field id="proof" label="Photo de la remise" required hint="5 Mo maximum. Elle est jointe à l'expédition et visible par le commerçant.">
        {(p) => (
          <Input
            {...p}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        )}
      </Field>
      {uploading && <p className="text-sm text-ink-muted">Envoi de la photo…</p>}
      {sent && !uploading && <p className="text-sm text-success">Photo enregistrée : vous pouvez confirmer la livraison.</p>}
      {!sent && !uploading && <p className="text-sm text-ink-muted">La confirmation reste bloquée jusqu&apos;à l&apos;envoi de la photo.</p>}
    </div>
  );
}

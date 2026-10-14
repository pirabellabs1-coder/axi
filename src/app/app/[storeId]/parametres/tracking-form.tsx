"use client";

import { useActionState } from "react";
import { updateTracking } from "@/lib/theme/tracking-actions";
import { Field, Input } from "@/components/ui/field";
import { CardBody, CardFooter } from "@/components/ui/card";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";

export function TrackingForm({ storeId, metaPixelId, gaMeasurementId }: { storeId: string; metaPixelId: string; gaMeasurementId: string }) {
  const [state, action] = useActionState(updateTracking, undefined);
  return (
    <form action={action} noValidate>
      <input type="hidden" name="storeId" value={storeId} />
      <CardBody className="space-y-5">
        <FormMessage state={state} />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            id="metaPixelId"
            label="Identifiant du Pixel Meta"
            error={fieldError(state, "metaPixelId")}
            hint="10 à 20 chiffres. Gestionnaire d'événements Meta, rubrique Sources de données."
          >
            {(p) => (
              <Input
                {...p}
                name="metaPixelId"
                defaultValue={metaPixelId}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                pattern="[0-9 ]{10,24}"
                maxLength={24}
                placeholder="123456789012345"
                className="font-mono"
              />
            )}
          </Field>
          <Field
            id="gaMeasurementId"
            label="ID de mesure Google Analytics 4"
            error={fieldError(state, "gaMeasurementId")}
            hint="Format G-XXXXXXX. Administration, Flux de données."
          >
            {(p) => (
              <Input
                {...p}
                name="gaMeasurementId"
                defaultValue={gaMeasurementId}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={20}
                placeholder="G-AB12CD34EF"
                className="font-mono uppercase"
              />
            )}
          </Field>
        </div>
        <p className="text-[13px] text-ink-muted">Laissez un champ vide pour désactiver la mesure correspondante. Informez vos clients de l&apos;usage de ces outils dans vos mentions légales.</p>
      </CardBody>
      <CardFooter>
        <SubmitButton>Enregistrer la mesure</SubmitButton>
      </CardFooter>
    </form>
  );
}

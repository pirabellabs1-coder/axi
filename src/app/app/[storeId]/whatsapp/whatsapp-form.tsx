"use client";

import { useActionState, useState } from "react";
import { ExternalLink } from "lucide-react";
import { updateWhatsapp } from "@/lib/whatsapp/actions";
import { waLink } from "@/lib/whatsapp";
import { Field, Input, Switch, Hint } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";

export function WhatsappForm({ storeId, number, ordering, dialCode, previewMessage }: { storeId: string; number: string; ordering: boolean; dialCode: string; previewMessage: string }) {
  const [state, action] = useActionState(updateWhatsapp, undefined);
  const [value, setValue] = useState(number);
  const [on, setOn] = useState(ordering);
  const digits = value.replace(/\D/g, "");
  const testHref = digits.length >= 8 ? waLink(digits.startsWith(dialCode) ? digits : `${dialCode}${digits.replace(/^0/, "")}`, previewMessage) : null;

  return (
    <form action={action} noValidate>
      <Card>
        <CardHeader title="Numéro et commande sur WhatsApp" description="Le bouton « Commander sur WhatsApp » ouvre une conversation avec ce numéro, message prérempli." />
        <CardBody className="space-y-6">
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          <Field
            id="whatsappNumber"
            label="Numéro WhatsApp"
            required
            error={fieldError(state, "whatsappNumber")}
            hint={`Format international sans « + », par exemple ${dialCode}97000000. Le numéro local est aussi accepté.`}
          >
            {(p) => (
              <Input {...p} name="whatsappNumber" inputMode="tel" autoComplete="tel" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`${dialCode}97000000`} className="tabular sm:max-w-sm" />
            )}
          </Field>
          <div className="rounded-[var(--radius-md)] bg-surface-2/60 px-4 py-3.5 ring-1 ring-inset ring-line">
            <div className="flex min-h-11 items-center">
              <Switch name="whatsappOrdering" checked={on} onChange={setOn} label="Proposer « Commander sur WhatsApp » dans la boutique" />
            </div>
            <Hint className="mt-1">Désactivé, les clients commandent uniquement via le formulaire de la boutique.</Hint>
          </div>
        </CardBody>
        <CardFooter>
          {testHref && (
            <a href={testHref} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "outline" })}>
              <ExternalLink className="size-4" aria-hidden /> Tester le lien
              <span className="sr-only">(nouvel onglet)</span>
            </a>
          )}
          <SubmitButton variant="primary">Enregistrer</SubmitButton>
        </CardFooter>
      </Card>
    </form>
  );
}

"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2 } from "lucide-react";
import { alignWhatsappNumberWithApi, updateWhatsapp } from "@/lib/whatsapp/actions";
import { sameNumber } from "@/lib/whatsapp/phone-sync";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { waLink } from "@/lib/whatsapp";
import { Field, Input, Switch, Hint } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";

export function WhatsappForm({
  storeId,
  number,
  ordering,
  dialCode,
  previewMessage,
  apiNumber = null,
}: {
  storeId: string;
  number: string;
  ordering: boolean;
  dialCode: string;
  previewMessage: string;
  /** Numéro relié à l'API WhatsApp (E.164 sans « + »), si une connexion est active. */
  apiNumber?: string | null;
}) {
  const [state, action] = useActionState(updateWhatsapp, undefined);
  const [value, setValue] = useState(number);
  const router = useRouter();
  const [aligning, startAlign] = useTransition();
  const [alignError, setAlignError] = useState<string | null>(null);
  const mismatch = !!apiNumber && !sameNumber(number, apiNumber);
  const align = () =>
    startAlign(async () => {
      setAlignError(null);
      const r = await alignWhatsappNumberWithApi(storeId);
      if (r.ok && r.data) {
        setValue(r.data.number);
        router.refresh();
      } else if (!r.ok) setAlignError(r.error);
    });
  const [on, setOn] = useState(ordering);
  const digits = value.replace(/\D/g, "");
  const explicitIntl = /^\s*(\+|00)/.test(value);
  const testHref = digits.length >= 8 ? waLink(explicitIntl || digits.startsWith(dialCode) ? digits.replace(/^00/, "") : `${dialCode}${digits.replace(/^0/, "")}`, previewMessage) : null;

  return (
    <form action={action} noValidate>
      <Card>
        <CardHeader title="Numéro et commande sur WhatsApp" description="Le bouton « Commander sur WhatsApp » ouvre une conversation avec ce numéro, message prérempli." />
        <CardBody className="space-y-6">
          <FormMessage state={state} />
          {mismatch && (
            <Alert tone="warning" title="Ce n'est pas le numéro relié à l'API WhatsApp">
              <p>
                Vos clients écriront à {number ? `+${number.replace(/\D/g, "")}` : "aucun numéro"}, alors que le numéro connecté à Axi est le +{apiNumber}. Leurs
                messages n'arriveront pas dans vos conversations Axi.
              </p>
              <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={align} loading={aligning}>
                <Link2 className="size-4" aria-hidden /> Utiliser le numéro connecté (+{apiNumber})
              </Button>
              {alignError && <p className="mt-2 text-sm text-danger">{alignError}</p>}
            </Alert>
          )}
          <input type="hidden" name="storeId" value={storeId} />
          <Field
            id="whatsappNumber"
            label="Numéro WhatsApp"
            required
            error={fieldError(state, "whatsappNumber")}
            hint={`Format international, par exemple ${dialCode}97000000 ou +15551234567 pour un numéro d'un autre pays. Le numéro local est aussi accepté.`}
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

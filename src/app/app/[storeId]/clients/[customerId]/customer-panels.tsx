"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConsentChannel, ConsentPurpose } from "@prisma/client";
import { Trash2, Check, X } from "lucide-react";
import { updateCustomer, setConsent, deleteCustomer } from "@/lib/customers/actions";
import { formatDateTime } from "@/lib/utils";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/dialog";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { toast } from "@/components/ui/toast";

export function CustomerForm({ storeId, customer }: { storeId: string; customer: { id: string; name: string; email: string | null; address: string | null; notes: string | null; tags: string[] } }) {
  const [state, action] = useActionState(updateCustomer, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="customerId" value={customer.id} />
      <FormMessage state={state} />
      <div className="grid gap-4">
        <Field id="name" label="Nom" required error={fieldError(state, "name")}>
          {(p) => <Input {...p} name="name" defaultValue={customer.name} maxLength={80} />}
        </Field>
        <Field id="email" label="E-mail" error={fieldError(state, "email")}>
          {(p) => <Input {...p} name="email" type="email" inputMode="email" defaultValue={customer.email ?? ""} />}
        </Field>
      </div>
      <Field id="address" label="Adresse / repère" error={fieldError(state, "address")}>
        {(p) => <Input {...p} name="address" defaultValue={customer.address ?? ""} maxLength={300} />}
      </Field>
      <Field id="tags" label="Tags" hint="Séparés par des virgules : vip, grossiste, cotonou…" error={fieldError(state, "tags")}>
        {(p) => <Input {...p} name="tags" defaultValue={customer.tags.join(", ")} />}
      </Field>
      <Field id="notes" label="Notes internes" error={fieldError(state, "notes")} hint="Jamais visibles par le client.">
        {(p) => <Textarea {...p} name="notes" defaultValue={customer.notes ?? ""} rows={3} maxLength={2000} />}
      </Field>
      <SubmitButton variant="outline" className="w-full">
        Enregistrer
      </SubmitButton>
    </form>
  );
}

const CHANNEL_LABEL: Record<ConsentChannel, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "E-mail", PUSH: "Notifications push" };
const PURPOSE_LABEL: Record<ConsentPurpose, string> = { TRANSACTIONAL: "Transactionnel", MARKETING: "Marketing" };

export function ConsentPanel({
  storeId,
  customerId,
  latest,
  canManage,
}: {
  storeId: string;
  customerId: string;
  latest: { channel: ConsentChannel; purpose: ConsentPurpose; granted: boolean | null; at: string | null; source: string | null }[];
  canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (channel: ConsentChannel, purpose: ConsentPurpose, granted: boolean) =>
    start(async () => {
      const res = await setConsent(storeId, customerId, channel, purpose, granted);
      if (res.ok) {
        toast.success(res.message ?? "Enregistré");
        router.refresh();
      } else toast.error("Action impossible", res.error);
    });

  return (
    <ul className="divide-y divide-line">
      {latest.map((l) => (
        <li key={`${l.channel}-${l.purpose}`} className="flex items-center justify-between gap-2 py-2.5 text-sm">
          <span className="min-w-0">
            <span className="font-medium text-ink">{CHANNEL_LABEL[l.channel]}</span> <span className="text-ink-muted">· {PURPOSE_LABEL[l.purpose]}</span>
            {l.at && (
              <span className="block text-xs text-ink-muted">
                {formatDateTime(l.at)}, source : {l.source}
              </span>
            )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <Badge tone={l.granted === true ? "success" : l.granted === false ? "danger" : "neutral"} dot>{l.granted === true ? "Accordé" : l.granted === false ? "Retiré" : "Inconnu"}</Badge>
            {canManage && (
              <>
                {l.granted !== true && (
                  <Button size="icon" variant="ghost" className="size-11 md:size-9" disabled={pending} onClick={() => set(l.channel, l.purpose, true)} aria-label={`Enregistrer un consentement ${CHANNEL_LABEL[l.channel]} ${PURPOSE_LABEL[l.purpose]}`}>
                    <Check className="size-4 text-primary" aria-hidden />
                  </Button>
                )}
                {l.granted !== false && (
                  <Button size="icon" variant="ghost" className="size-11 md:size-9" disabled={pending} onClick={() => set(l.channel, l.purpose, false)} aria-label={`Enregistrer un retrait ${CHANNEL_LABEL[l.channel]} ${PURPOSE_LABEL[l.purpose]}`}>
                    <X className="size-4 text-danger" aria-hidden />
                  </Button>
                )}
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DeleteCustomerButton({ storeId, customerId, name }: { storeId: string; customerId: string; name: string }) {
  return (
    <ConfirmButton
      title={`Supprimer la fiche de ${name} ?`}
      description="Les commandes passées sont conservées mais anonymisées (nom et téléphone remplacés). Cette action est irréversible."
      confirmLabel="Supprimer définitivement"
      className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-danger ring-1 ring-inset ring-danger/40 transition-colors hover:bg-danger-soft"
      onConfirm={async () => {
        const res = await deleteCustomer(storeId, customerId);
        if (res && !res.ok) toast.error("Suppression impossible", res.error);
      }}
    >
      <Trash2 className="size-4" aria-hidden /> Supprimer la fiche (RGPD)
    </ConfirmButton>
  );
}

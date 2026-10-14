"use client";

import { useActionState, useState } from "react";
import { Code2, Send, XCircle } from "lucide-react";
import { inviteDeveloper, resendInvite, revokeCollaborator } from "@/lib/apps/collaborator-actions";
import { COLLAB_PERMISSIONS, COLLAB_PERMISSION_LABELS, COLLAB_INVITE_DAYS } from "@/lib/apps/collaborator-logic";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Checkbox } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";

export function InviteDeveloperDialog({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(inviteDeveloper, undefined);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok) setOpen(false);
  }
  const permError = fieldError(state, "permissions");
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)} trailing={Code2}>
        Inviter un développeur
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Inviter un développeur" description={`Il reçoit un lien par e-mail, valable ${COLLAB_INVITE_DAYS} jours.`}>
        <form action={action} noValidate className="space-y-5">
          <FormMessage state={state} toastSuccess />
          <input type="hidden" name="storeId" value={storeId} />
          <Field id="dev-email" label="Adresse e-mail du développeur" required error={fieldError(state, "email")}>
            {(p) => <Input {...p} name="email" type="email" inputMode="email" autoComplete="off" placeholder="dev@exemple.com" />}
          </Field>
          <fieldset aria-describedby={permError ? "dev-perms-error" : undefined}>
            <legend className="mb-2 text-sm font-medium text-ink">Ce qu&apos;il pourra faire</legend>
            <div className="grid gap-2">
              {COLLAB_PERMISSIONS.map((p) => (
                <Checkbox
                  key={p}
                  name="permissions[]"
                  value={p}
                  defaultChecked={p === "apps.test_install"}
                  label={COLLAB_PERMISSION_LABELS[p].title}
                  description={COLLAB_PERMISSION_LABELS[p].text}
                  className="min-h-11 rounded-[var(--radius-md)] p-3 ring-1 ring-inset ring-line hover:bg-surface-2"
                />
              ))}
            </div>
            {permError && (
              <p id="dev-perms-error" className="mt-2 text-sm text-danger">
                {permError[0]}
              </p>
            )}
          </fieldset>
          <Field id="dev-message" label="Message (facultatif)" hint="Ajouté à l'e-mail d'invitation. 500 caractères maximum." error={fieldError(state, "message")}>
            {(p) => <Textarea {...p} name="message" rows={3} maxLength={500} />}
          </Field>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton>
              <Send className="size-4" aria-hidden /> Envoyer l&apos;invitation
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function CollaboratorActions({ storeId, id, email, canResend, active }: { storeId: string; id: string; email: string; canResend: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {canResend && (
        <ActionButton variant="ghost" size="sm" className="h-11" action={() => resendInvite(storeId, id)} aria-label={`Renvoyer l'invitation à ${email}`}>
          <Send className="size-4" aria-hidden /> Renvoyer
        </ActionButton>
      )}
      <ConfirmActionButton
        title={active ? `Révoquer l'accès de ${email} ?` : "Révoquer cette invitation ?"}
        description={
          active
            ? "Le développeur perd immédiatement l'accès à votre boutique. Les applications qu'il a installées en test sont désinstallées ; celles que vous avez installées vous-même ne sont pas touchées."
            : "Le lien envoyé ne fonctionnera plus."
        }
        confirmLabel="Révoquer"
        action={() => revokeCollaborator(storeId, id)}
        className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <XCircle className="size-4" aria-hidden /> Révoquer<span className="sr-only"> {email}</span>
      </ConfirmActionButton>
    </div>
  );
}

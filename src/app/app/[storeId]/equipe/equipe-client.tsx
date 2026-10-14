"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { UserPlus, Send, XCircle, UserMinus, Check } from "lucide-react";
import type { MembershipRole } from "@prisma/client";
import { inviteMember, resendInvitation, revokeInvitation, changeMemberRole, removeMember } from "@/lib/team/actions";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const INVITE_ROLES: { role: Extract<MembershipRole, "MANAGER" | "STAFF">; text: string }[] = [
  { role: "STAFF", text: "Commandes uniquement : préparation, statut et livraison." },
  { role: "MANAGER", text: "Produits, commandes, clients, promotions et paramètres. Ni facturation ni équipe." },
];

export function InviteDialog({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"MANAGER" | "STAFF">("STAFF");
  const [state, action] = useActionState(inviteMember, undefined);
  const groupId = useId();
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok) setOpen(false);
  }
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)} trailing={UserPlus}>
        Inviter un membre
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Inviter un membre" description="La personne reçoit un lien par e-mail, valable 7 jours.">
        <form action={action} noValidate className="space-y-5">
          <FormMessage state={state} toastSuccess />
          <input type="hidden" name="storeId" value={storeId} />
          <Field id="inv-email" label="Adresse e-mail" required error={fieldError(state, "email")}>
            {(p) => <Input {...p} name="email" type="email" inputMode="email" autoComplete="off" placeholder="prenom@exemple.com" />}
          </Field>
          <fieldset>
            <legend id={groupId} className="mb-2 text-sm font-medium text-ink">
              Rôle
            </legend>
            <div className="grid gap-2">
              {INVITE_ROLES.map((r) => {
                const checked = role === r.role;
                return (
                  <label
                    key={r.role}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] p-4 ring-1 ring-inset transition-[box-shadow,background-color] duration-200 ease-spring has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                      checked ? "bg-primary-soft/50 ring-2 ring-primary" : "bg-surface ring-line-strong hover:bg-surface-2",
                    )}
                  >
                    <input type="radio" name="role" value={r.role} checked={checked} onChange={() => setRole(r.role)} className="sr-only" />
                    <span
                      className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", checked ? "bg-primary text-on-primary ring-primary" : "ring-line-strong")}
                      aria-hidden
                    >
                      {checked && <Check className="size-3" />}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-ink">{ROLE_LABELS[r.role]}</span>
                      <span className="block text-sm text-ink-muted">{r.text}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-[13px] text-ink-muted">Pour ajouter un propriétaire, invitez un gestionnaire puis changez son rôle.</p>
          </fieldset>
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

export function RoleSelect({ storeId, membershipId, role, lastOwner, name }: { storeId: string; membershipId: string; role: MembershipRole; lastOwner: boolean; name: string }) {
  const [value, setValue] = useState(role);
  const [pending, start] = useTransition();
  const hintId = useId();
  if (role === "SUPPORT") return <span className="text-sm text-ink-muted">{ROLE_LABELS.SUPPORT}</span>;
  return (
    <div>
      <Select
        aria-label={`Rôle de ${name}`}
        aria-describedby={lastOwner ? hintId : undefined}
        value={value}
        disabled={lastOwner || pending}
        className="h-11 text-sm"
        onChange={(e) => {
          const next = e.target.value as MembershipRole;
          const prev = value;
          setValue(next);
          start(async () => {
            const r = await changeMemberRole(storeId, membershipId, next);
            if (!r.ok) {
              setValue(prev);
              toast.error(r.error);
            } else toast.success(r.message ?? "Rôle mis à jour");
          });
        }}
      >
        <option value="OWNER">{ROLE_LABELS.OWNER}</option>
        <option value="MANAGER">{ROLE_LABELS.MANAGER}</option>
        <option value="STAFF">{ROLE_LABELS.STAFF}</option>
      </Select>
      {lastOwner && (
        <p id={hintId} className="mt-1 text-xs text-ink-muted">
          Seul propriétaire : nommez-en un autre avant de changer ce rôle.
        </p>
      )}
    </div>
  );
}

export function RemoveMemberButton({ storeId, membershipId, name, isSelf }: { storeId: string; membershipId: string; name: string; isSelf: boolean }) {
  return (
    <ConfirmActionButton
      title={isSelf ? "Quitter la boutique ?" : `Retirer ${name} ?`}
      description={isSelf ? "Vous perdrez l'accès à cette boutique." : "Cette personne perd immédiatement l'accès et sa place est libérée. Ses actions passées restent dans l'historique."}
      confirmLabel={isSelf ? "Quitter" : "Retirer"}
      action={() => removeMember(storeId, membershipId)}
      className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
    >
      <UserMinus className="size-4" aria-hidden />
      <span className="sr-only">{isSelf ? "Quitter la boutique" : `Retirer ${name}`}</span>
    </ConfirmActionButton>
  );
}

export function InvitationActions({ storeId, id, email }: { storeId: string; id: string; email: string }) {
  return (
    <div className="flex items-center gap-1">
      <ActionButton variant="ghost" size="sm" className="h-11" action={() => resendInvitation(storeId, id)} aria-label={`Renvoyer l'invitation à ${email}`}>
        <Send className="size-4" aria-hidden /> Renvoyer
      </ActionButton>
      <ConfirmActionButton
        title="Révoquer cette invitation ?"
        description="Le lien envoyé ne fonctionnera plus et la place est libérée."
        confirmLabel="Révoquer"
        action={() => revokeInvitation(storeId, id)}
        className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <XCircle className="size-4" aria-hidden /> Révoquer
      </ConfirmActionButton>
    </div>
  );
}

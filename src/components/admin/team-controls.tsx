"use client";

import { useState, useTransition } from "react";
import { UserPlus, UserMinus, RotateCcw } from "lucide-react";
import { addTeamMember, setTeamRole, removeTeamMember, resetMemberMfa } from "@/lib/admin/security-actions";
import { PLATFORM_ROLES, PLATFORM_ROLE_LABEL, PLATFORM_ROLE_HINT, type PlatformRole } from "@/lib/admin/roles";
import { Dialog, ConfirmButton } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";

export function AddMemberButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PlatformRole>("SUPPORT");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await addTeamMember(email, role);
      if (r.ok) {
        toast.success(r.message ?? "Ajouté");
        setOpen(false);
        setEmail("");
        setError(null);
      } else setError(r.error);
    });
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" aria-hidden /> Ajouter un membre
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Ajouter à l'équipe plateforme"
        description="La personne doit déjà avoir un compte Axi vérifié. Elle obtient l'accès à la console dès sa prochaine page."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
            <Button onClick={submit} loading={pending}>Ajouter</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field id="tm-email" label="Adresse e-mail du compte" required error={error ?? undefined}>
            {(p) => <Input {...p} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom@axi.africa" />}
          </Field>
          <Field id="tm-role" label="Rôle" hint={PLATFORM_ROLE_HINT[role]}>
            {(p) => (
              <Select {...p} value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}>
                {PLATFORM_ROLES.map((r) => <option key={r} value={r}>{PLATFORM_ROLE_LABEL[r]}</option>)}
              </Select>
            )}
          </Field>
        </div>
      </Dialog>
    </>
  );
}

export function MemberControls({ userId, name, role, mfaEnabled, self }: { userId: string; name: string; role: PlatformRole; mfaEnabled: boolean; self: boolean }) {
  const [pending, start] = useTransition();
  if (self) return <span className="text-xs text-ink-faint">Vous</span>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <label className="sr-only" htmlFor={`role-${userId}`}>Rôle de {name}</label>
      <Select
        id={`role-${userId}`}
        fieldSize="sm"
        value={role}
        disabled={pending}
        className="w-[190px]"
        onChange={(e) => {
          const next = e.target.value as PlatformRole;
          start(async () => {
            const r = await setTeamRole(userId, next);
            if (r.ok) toast.success(r.message ?? "Rôle mis à jour");
            else toast.error(r.error);
          });
        }}
      >
        {PLATFORM_ROLES.map((r) => <option key={r} value={r}>{PLATFORM_ROLE_LABEL[r]}</option>)}
      </Select>
      {mfaEnabled && (
        <ConfirmButton
          title={`Réinitialiser la double authentification de ${name} ?`}
          description="À utiliser si le téléphone est perdu. Ses sessions sont révoquées ; il devra reconfigurer la double authentification."
          confirmLabel="Réinitialiser"
          onConfirm={async () => { const r = await resetMemberMfa(userId); if (r.ok) toast.success(r.message ?? "Fait"); else toast.error(r.error); }}
          className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:size-9"
        >
          <RotateCcw className="size-4" aria-hidden />
          <span className="sr-only">Réinitialiser la double authentification de {name}</span>
        </ConfirmButton>
      )}
      <ConfirmButton
        title={`Retirer ${name} de l'équipe ?`}
        description="La personne garde son compte marchand mais perd l'accès à la console."
        confirmLabel="Retirer"
        onConfirm={async () => { const r = await removeTeamMember(userId); if (r.ok) toast.success(r.message ?? "Retiré"); else toast.error(r.error); }}
        className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger sm:size-9"
      >
        <UserMinus className="size-4" aria-hidden />
        <span className="sr-only">Retirer {name} de l&apos;équipe</span>
      </ConfirmButton>
    </div>
  );
}

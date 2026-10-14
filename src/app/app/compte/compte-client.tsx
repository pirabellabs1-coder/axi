"use client";

import { useActionState, useState } from "react";
import { LogOut, Trash2, Monitor, Smartphone } from "lucide-react";
import { updateProfile, changePassword } from "@/lib/auth/actions";
import { revokeOtherSessions, revokeSession, deleteAccount } from "@/lib/auth/account-actions";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton } from "@/components/app/action-controls";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

export function ProfileForm({ name, email, phone }: { name: string; email: string; phone: string }) {
  const [state, action] = useActionState(updateProfile, undefined);
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <Field id="name" label="Nom complet" required error={fieldError(state, "name")}>
        {(p) => <Input {...p} name="name" defaultValue={name} autoComplete="name" maxLength={80} />}
      </Field>
      <Field id="email" label="Adresse e-mail" hint="Identifiant de connexion. Contactez le support pour la modifier.">
        {(p) => <Input {...p} value={email} readOnly disabled autoComplete="email" />}
      </Field>
      <Field id="phone" label="Téléphone" error={fieldError(state, "phone")}>
        {(p) => <Input {...p} name="phone" defaultValue={phone} inputMode="tel" autoComplete="tel" maxLength={20} />}
      </Field>
      <div className="flex justify-end border-t border-line pt-4"><SubmitButton>Enregistrer le profil</SubmitButton></div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePassword, undefined);
  return (
    <form action={action} noValidate className="space-y-5" key={state?.ok ? "done" : "edit"}>
      <FormMessage state={state} />
      <Field id="current" label="Mot de passe actuel" required error={fieldError(state, "current")}>
        {(p) => <Input {...p} name="current" type="password" autoComplete="current-password" />}
      </Field>
      <Field id="password" label="Nouveau mot de passe" required error={fieldError(state, "password")} hint="8 caractères minimum, avec lettres et chiffres.">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" />}
      </Field>
      <div className="flex justify-end border-t border-line pt-4"><SubmitButton variant="secondary">Changer le mot de passe</SubmitButton></div>
    </form>
  );
}

export type SessionDTO = { id: string; userAgent: string | null; ip: string | null; createdAt: string; expiresAt: string; current: boolean };

function describeUA(ua: string | null): string {
  if (!ua) return "Appareil inconnu";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Navigateur";
  return [browser, os].filter(Boolean).join(" · ");
}

function isMobileUA(ua: string | null) {
  return !!ua && /iPhone|iPad|Android|Mobile/.test(ua);
}

export function SessionsList({ sessions }: { sessions: SessionDTO[] }) {
  return (
    <div>
      <ul className="divide-y divide-line">
        {sessions.map((s) => {
          const Icon = isMobileUA(s.userAgent) ? Smartphone : Monitor;
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3.5">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  {describeUA(s.userAgent)} {s.current && <Badge tone="success" dot>Cet appareil</Badge>}
                </p>
                <p className="text-[13px] text-ink-muted">
                  {s.ip ? `IP ${s.ip} · ` : ""}Connecté le {formatDateTime(s.createdAt)}
                </p>
                <p className="text-xs text-ink-faint">Session valable jusqu&apos;au {formatDateTime(s.expiresAt)}</p>
              </div>
              {!s.current && (
                <ActionButton variant="ghost" size="sm" className="h-11" action={() => revokeSession(s.id)} aria-label={`Déconnecter ${describeUA(s.userAgent)}`}>
                  <LogOut className="size-4" aria-hidden /> Déconnecter
                </ActionButton>
              )}
            </li>
          );
        })}
      </ul>
      {sessions.length > 1 && (
        <div className="mt-2 flex justify-end border-t border-line pt-4">
          <ActionButton variant="outline" action={() => revokeOtherSessions()}>
            <LogOut className="size-4" aria-hidden /> Déconnecter les autres appareils
          </ActionButton>
        </div>
      )}
    </div>
  );
}

export function DeleteAccount({ blockedReason }: { blockedReason: string | null }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-danger">Supprimer mon compte</p>
        <p className="text-sm text-ink-muted">{blockedReason ?? "Définitif : vos accès aux boutiques sont retirés. Les boutiques dont vous n'êtes pas propriétaire ne sont pas affectées."}</p>
      </div>
      <Button variant="danger" disabled={!!blockedReason} onClick={() => setOpen(true)}><Trash2 className="size-4" aria-hidden /> Supprimer</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Supprimer définitivement votre compte ?" description="Saisissez votre mot de passe pour confirmer." size="sm" footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
          <Button variant="danger" loading={pending} disabled={password.length < 1} onClick={async () => {
            setPending(true);
            const r = await deleteAccount(password);
            setPending(false);
            if (r && !r.ok) toast.error(r.error);
          }}>Supprimer mon compte</Button>
        </>
      }>
        <Field id="del-password" label="Mot de passe">
          {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
      </Dialog>
    </div>
  );
}

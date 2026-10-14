"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, ShieldAlert, Copy, Check, KeyRound, Smartphone } from "lucide-react";
import * as adminActions from "@/lib/admin/security-actions";
import * as accountActions from "@/lib/auth/mfa-actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

/** Clé lisible par groupes de 4 (pas d'import de src/lib/auth/mfa : node:crypto côté serveur uniquement). */
const groupKey = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          toast.error("Copie impossible : sélectionnez le texte manuellement.");
        }
      }}
    >
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {done ? "Copié" : label}
    </Button>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-surface-2 p-4 ring-1 ring-line">
      <p className="text-sm font-medium text-ink">Codes de secours</p>
      <p className="mt-0.5 text-[13px] text-ink-muted">Affichés une seule fois. Conservez-les dans un gestionnaire de mots de passe : chacun remplace un code de l&apos;application, une fois.</p>
      <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-ink sm:grid-cols-4">
        {codes.map((c) => (
          <li key={c} className="rounded-[10px] bg-surface px-2.5 py-1.5 text-center ring-1 ring-line">{c}</li>
        ))}
      </ul>
      <div className="mt-3">
        <CopyButton value={codes.join("\n")} label="Copier les codes" />
      </div>
    </div>
  );
}

/** Section « Sécurité » : inscription TOTP en deux étapes, codes de secours, désactivation. */
export function MfaPanel({
  enabled,
  pendingEnrollment,
  email,
  scope = "admin",
}: {
  enabled: boolean;
  pendingEnrollment: boolean;
  email: string;
  /** "admin" : console plateforme ; "account" : compte marchand (page Mon compte). */
  scope?: "admin" | "account";
}) {
  const startMfaEnrollment = scope === "account" ? accountActions.startAccountMfaEnrollment : adminActions.startMfaEnrollment;
  const confirmMfaEnrollment = scope === "account" ? accountActions.confirmAccountMfaEnrollment : adminActions.confirmMfaEnrollment;
  const cancelMfaEnrollment = scope === "account" ? accountActions.cancelAccountMfaEnrollment : adminActions.cancelMfaEnrollment;
  const regenerateBackupCodes = scope === "account" ? accountActions.regenerateAccountBackupCodes : adminActions.regenerateBackupCodes;
  const disableMfa = scope === "account" ? accountActions.disableAccountMfa : adminActions.disableMfa;
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<null | "regen" | "disable">(null);
  const [dCode, setDCode] = useState("");
  const [dError, setDError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const begin = () =>
    start(async () => {
      const r = await startMfaEnrollment();
      if (r.ok && r.data) {
        setEnroll(r.data);
        setCode("");
        setError(null);
      } else if (!r.ok) toast.error(r.error);
    });

  const confirm = () =>
    start(async () => {
      const r = await confirmMfaEnrollment(code);
      if (r.ok && r.data) {
        setCodes(r.data.backupCodes);
        setEnroll(null);
        toast.success(r.message ?? "Double authentification activée");
      } else if (!r.ok) setError(r.error);
    });

  const cancel = () =>
    start(async () => {
      await cancelMfaEnrollment();
      setEnroll(null);
    });

  const runDialog = () =>
    start(async () => {
      if (dialog === "regen") {
        const r = await regenerateBackupCodes(dCode);
        if (r.ok && r.data) {
          setCodes(r.data.backupCodes);
          setDialog(null);
          setDCode("");
          toast.success(r.message ?? "Codes régénérés");
        } else if (!r.ok) setDError(r.error);
      } else if (dialog === "disable") {
        const r = await disableMfa(dCode);
        if (r.ok) {
          setDialog(null);
          setDCode("");
          setCodes(null);
          toast.success(r.message ?? "Désactivée");
        } else setDError(r.error);
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className={enabled ? "inline-flex size-10 items-center justify-center rounded-2xl bg-primary-soft text-primary" : "inline-flex size-10 items-center justify-center rounded-2xl bg-warning-soft text-warning"}>
          {enabled ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldAlert className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
            Double authentification (TOTP)
            {enabled ? <Badge tone="success" dot>Activée</Badge> : <Badge tone="warning">Désactivée</Badge>}
          </p>
          <p className="mt-0.5 max-w-[60ch] text-sm text-ink-muted">
            {enabled
              ? `Un code de votre application est demandé après le mot de passe pour ${email}.`
              : "Après le mot de passe, un code à 6 chiffres de votre application (Google Authenticator, 1Password, Aegis…) sera demandé."}
          </p>
        </div>
        {!enabled && !enroll && (
          <Button onClick={begin} loading={pending} size="sm">
            <Smartphone className="size-4" aria-hidden /> {pendingEnrollment ? "Reprendre l'activation" : "Activer"}
          </Button>
        )}
        {enabled && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => { setDialog("regen"); setDError(null); }}>
              <KeyRound className="size-4" aria-hidden /> Nouveaux codes de secours
            </Button>
            <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft" onClick={() => { setDialog("disable"); setDError(null); }}>
              Désactiver
            </Button>
          </div>
        )}
      </div>

      {enroll && (
        <div className="grid grid-cols-1 gap-5 rounded-[var(--radius-md)] bg-surface-2/60 p-4 ring-1 ring-line lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <p className="text-sm font-medium text-ink">1. Ajoutez le compte dans votre application</p>
            <p className="text-[13px] text-ink-muted">Saisissez la clé manuellement (type « basée sur l&apos;heure »), ou collez le lien de configuration dans une application qui l&apos;accepte.</p>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">Clé</p>
              <p className="mt-1 select-all break-all rounded-[10px] bg-surface px-3 py-2 font-mono text-[15px] tracking-wider text-ink ring-1 ring-line">{groupKey(enroll.secret)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">Lien de configuration</p>
              <p className="mt-1 select-all break-all rounded-[10px] bg-surface px-3 py-2 font-mono text-xs text-ink-muted ring-1 ring-line">{enroll.uri}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyButton value={enroll.secret} label="Copier la clé" />
              <CopyButton value={enroll.uri} label="Copier le lien" />
            </div>
          </div>
          <div className="min-w-0 space-y-3">
            <p className="text-sm font-medium text-ink">2. Confirmez avec le code affiché</p>
            <Field id="mfa-code" label="Code à 6 chiffres" error={error ?? undefined}>
              {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="max-w-[220px] text-center font-mono text-xl tracking-[0.4em]" />}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={confirm} loading={pending} disabled={code.length !== 6}>Activer la double authentification</Button>
              <Button variant="ghost" onClick={cancel} disabled={pending}>Annuler</Button>
            </div>
          </div>
        </div>
      )}

      {codes && <BackupCodes codes={codes} />}
      {!enabled && !enroll && pendingEnrollment && <Alert tone="info">Une activation a été commencée sans être confirmée. Reprenez-la : une nouvelle clé sera générée.</Alert>}

      <Dialog
        open={dialog != null}
        onClose={() => setDialog(null)}
        size="sm"
        title={dialog === "disable" ? "Désactiver la double authentification" : "Régénérer les codes de secours"}
        description={dialog === "disable" ? "Votre compte ne sera plus protégé par un second facteur. Confirmez avec un code de l'application ou un code de secours." : "Les anciens codes deviennent inutilisables. Confirmez avec un code de l'application."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={pending}>Annuler</Button>
            <Button variant={dialog === "disable" ? "danger" : "primary"} loading={pending} onClick={runDialog}>{dialog === "disable" ? "Désactiver" : "Régénérer"}</Button>
          </>
        }
      >
        <Field id="mfa-confirm" label="Code" error={dError ?? undefined}>
          {(p) => <Input {...p} value={dCode} onChange={(e) => setDCode(e.target.value.slice(0, 20))} autoComplete="one-time-code" className="font-mono" placeholder="000000" />}
        </Field>
      </Dialog>
    </div>
  );
}

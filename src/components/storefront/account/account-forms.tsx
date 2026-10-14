"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, MonitorSmartphone, Trash2 } from "lucide-react";
import { logoutAllDevices, logoutBuyer, requestAccountDeletion, updateBuyerConsent, updateBuyerName, verifyBuyerEmail } from "@/lib/buyer/actions";
import type { ActionResult } from "@/lib/action";
import { btnClass } from "@/components/storefront/ui";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SfField, SfFormError, SfSubmit, sfFieldError } from "./sf-form";

function useSuccessToast(state: ActionResult<unknown> | undefined, onOk?: () => void) {
  useEffect(() => {
    if (state?.ok) {
      if (state.message) toast.success(state.message);
      onOk?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

/** Nom demandé après la première connexion (la fiche est créée avec le numéro). */
export function NameForm({ slug, defaultName, disabled }: { slug: string; defaultName: string; disabled?: boolean }) {
  const [state, action] = useActionState(updateBuyerName, undefined);
  const router = useRouter();
  useSuccessToast(state, () => router.refresh());
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
      <input type="hidden" name="slug" value={slug} />
      <div className="flex-1">
        <SfField id="buyer-name" label="Votre nom" hint="Il apparaîtra sur vos commandes." error={sfFieldError(state, "name")}>
          {(p) => <input {...p} name="name" autoComplete="name" required minLength={2} maxLength={80} defaultValue={defaultName} disabled={disabled} className="sf-input" />}
        </SfField>
      </div>
      <SfSubmit className="sm:mb-[26px]" disabled={disabled}>
        Enregistrer
      </SfSubmit>
      <div className="sm:hidden">
        <SfFormError state={state} />
      </div>
    </form>
  );
}

/** Consentement marketing WhatsApp (journalisé côté serveur, source « account »). Mise à jour optimiste. */
export function ConsentForm({ slug, granted, storeName, disabled }: { slug: string; granted: boolean; storeName: string; disabled?: boolean }) {
  const [checked, setChecked] = useState(granted);
  const [pending, start] = useTransition();
  return (
    <label className="flex min-h-11 cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-ink">Offres et nouveautés sur WhatsApp</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-muted">Recevoir les promotions de {storeName}. Vous pouvez changer d&apos;avis à tout moment.</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled || pending}
        onChange={(e) => {
          const v = e.currentTarget.checked;
          setChecked(v);
          const fd = new FormData();
          fd.set("slug", slug);
          fd.set("marketing", v ? "true" : "false");
          start(async () => {
            const r = await updateBuyerConsent(undefined, fd);
            if (r.ok) toast.success(r.message ?? "Préférence enregistrée");
            else {
              setChecked(!v);
              toast.error(r.error);
            }
          });
        }}
        className="relative mt-0.5 h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full bg-line-strong transition-colors duration-200 before:absolute before:left-1 before:top-1 before:size-5 before:rounded-full before:bg-white before:shadow before:transition-transform before:duration-200 checked:bg-[var(--store-primary)] checked:before:translate-x-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--store-primary)] disabled:opacity-50 motion-reduce:before:transition-none"
      />
    </label>
  );
}

/** Vérification de l'e-mail par code (permet la connexion par e-mail). */
export function EmailVerifyForm({ slug, email, verified, disabled }: { slug: string; email: string | null; verified: boolean; disabled?: boolean }) {
  const [state, action] = useActionState(verifyBuyerEmail, undefined);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const step = state?.ok ? state.data?.step : undefined;
  const pendingEmail = state?.ok ? state.data?.email : undefined;
  useSuccessToast(state, () => {
    if (step === "done") {
      setOpen(false);
      router.refresh();
    }
  });

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">
          {email ? email : <span className="text-ink-muted">Aucun e-mail</span>}
          {email && (
            <span className={cn("ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold", verified ? "bg-[#e8f6ef] text-[#0b5a3f]" : "bg-surface-2 text-ink-muted")}>{verified ? "Vérifié" : "Non vérifié"}</span>
          )}
        </p>
        {!disabled && (
          <button type="button" onClick={() => setOpen(true)} className={btnClass("outline", "sm")}>
            {email ? (verified ? "Changer" : "Vérifier") : "Ajouter"}
          </button>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="slug" value={slug} />
      {step === "code" ? (
        <>
          <input type="hidden" name="email" value={pendingEmail ?? ""} />
          <p role="status" className="text-sm text-ink-muted">
            {state?.ok ? state.message : null}
          </p>
          <SfField id="email-code" label="Code reçu par e-mail" error={sfFieldError(state, "code")}>
            {(p) => <input {...p} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required className="sf-input font-mono tracking-[0.3em]" autoFocus />}
          </SfField>
        </>
      ) : (
        <SfField id="email" label="Adresse e-mail" error={sfFieldError(state, "email")}>
          {(p) => <input {...p} name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} defaultValue={pendingEmail ?? email ?? ""} className="sf-input" autoFocus />}
        </SfField>
      )}
      <SfFormError state={state} />
      <div className="flex flex-wrap gap-2">
        <SfSubmit size="sm">{step === "code" ? "Vérifier" : "Recevoir un code"}</SfSubmit>
        <button type="button" onClick={() => setOpen(false)} className={btnClass("soft", "sm")}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/** Déconnexion, déconnexion de tous les appareils, demande de suppression (avec confirmation). */
export function SecurityActions({ slug, storeName }: { slug: string; storeName: string }) {
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r && !r.ok) toast.error(r.error);
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" disabled={pending} onClick={() => run(() => logoutBuyer(slug))} className={cn(btnClass("outline", "md"), "w-full sm:w-auto")}>
          <LogOut className="size-4" aria-hidden /> Me déconnecter
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => logoutAllDevices(slug))} className={cn(btnClass("soft", "md"), "w-full sm:w-auto")}>
          <MonitorSmartphone className="size-4" aria-hidden /> Déconnecter tous mes appareils
        </button>
      </div>
      {!confirmDelete ? (
        <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-sm font-semibold text-danger underline-offset-4 hover:underline">
          <Trash2 className="size-4" aria-hidden /> Supprimer mon compte
        </button>
      ) : (
        <div role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-text" className="rounded-[14px] bg-danger-soft p-4">
          <p id="delete-title" className="text-sm font-semibold text-ink">
            Supprimer votre compte ?
          </p>
          <p id="delete-text" className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            Vous serez déconnecté de tous vos appareils et ne recevrez plus d&apos;offres. {storeName} recevra votre demande et anonymisera vos données. Vos commandes en cours ne sont pas annulées.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => run(() => requestAccountDeletion(slug))} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-danger px-4 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60">
              Confirmer la suppression
            </button>
            <button type="button" autoFocus onClick={() => setConfirmDelete(false)} className={btnClass("soft", "sm")}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

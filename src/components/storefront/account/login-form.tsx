"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { ArrowRight, MessageCircle, ShieldCheck } from "lucide-react";
import { requestOtp, verifyOtp, type OtpRequestData } from "@/lib/buyer/actions";
import type { ActionResult } from "@/lib/action";
import { SfField, SfFormError, SfSubmit, sfFieldError } from "./sf-form";

const RESEND_SECONDS = 45;
/** Défi anti-robot (point d'intégration Turnstile) : widget rendu uniquement si la clé de site est définie. */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/**
 * Connexion par code en deux étapes : numéro (ou e-mail vérifié), puis code à 6 chiffres.
 * L'étape « code » s'affiche dans tous les cas (anti-énumération : même message, même parcours).
 */
export function LoginForm({ slug, dialCode, next }: { slug: string; dialCode: string; next?: string }) {
  const [editing, setEditing] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const [sent, setSent] = useState<OtpRequestData | null>(null);
  const [notice, setNotice] = useState<string>("");
  // L'étape suivante est décidée dans l'action elle-même (pas d'effet qui recopie l'état).
  const [reqState, requestAction] = useActionState<ActionResult<OtpRequestData> | undefined, FormData>(async (prev, fd) => {
    const r = await requestOtp(prev, fd);
    if (r.ok && r.data) {
      setSent(r.data);
      setNotice(r.message ?? "");
      setEditing(false);
      setCooldown(RESEND_SECONDS);
    }
    return r;
  }, undefined);
  const [verifyState, verifyAction] = useActionState<ActionResult | undefined, FormData>(verifyOtp, undefined);

  // Focus sur le code au changement d'étape (clavier et lecteurs d'écran).
  useEffect(() => {
    if (!editing && sent) codeRef.current?.focus();
  }, [editing, sent]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (editing || !sent) {
    return (
      <form action={requestAction} className="space-y-4" noValidate>
        <input type="hidden" name="slug" value={slug} />
        <SfField id="identifier" label="Numéro de téléphone ou e-mail" hint={`Numéro au format local ou +${dialCode}. L'e-mail fonctionne s'il a été vérifié depuis votre compte.`} error={sfFieldError(reqState, "identifier")}>
          {(p) => (
            <input
              {...p}
              name="identifier"
              type="text"
              inputMode="tel"
              autoComplete="tel"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={254}
              defaultValue={sent?.identifier ?? ""}
              placeholder={dialCode === "229" ? "01 97 00 00 00" : `+${dialCode}`}
              className="sf-input"
              onChange={(e) => {
                // Bascule du clavier : e-mail dès qu'un « @ » apparaît.
                e.currentTarget.inputMode = e.currentTarget.value.includes("@") ? "email" : "tel";
              }}
            />
          )}
        </SfField>
        {TURNSTILE_SITE_KEY && (
          <>
            <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
            <div className="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} data-size="flexible" data-language="fr" />
          </>
        )}
        <SfFormError state={reqState} />
        <SfSubmit size="lg" className="w-full">
          Recevoir un code <ArrowRight className="size-4" aria-hidden />
        </SfSubmit>
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-muted">
          <MessageCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Le code arrive par WhatsApp (ou par e-mail). Aucun mot de passe à retenir.
        </p>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <div role="status" className="flex items-start gap-3 rounded-[14px] bg-[var(--store-primary-soft,var(--c-surface-2))] px-4 py-3.5 text-sm text-ink">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--store-primary)]" aria-hidden />
        <p>
          {notice}
          <span className="mt-0.5 block font-medium">{sent.masked}</span>
        </p>
      </div>

      <form action={verifyAction} className="space-y-4" noValidate>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="identifier" value={sent.identifier} />
        {next && <input type="hidden" name="next" value={next} />}
        <SfField id="code" label="Code reçu (6 chiffres)" hint="Valable 10 minutes, 5 essais." error={sfFieldError(verifyState, "code")}>
          {(p) => (
            <input
              {...p}
              ref={codeRef}
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={8}
              required
              placeholder="000000"
              className="sf-input text-center font-mono text-[22px] tracking-[0.5em]"
            />
          )}
        </SfField>
        <SfFormError state={verifyState} />
        <SfSubmit size="lg" className="w-full">
          Me connecter
        </SfSubmit>
      </form>

      {reqState && !reqState.ok && <SfFormError state={reqState} />}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-11 items-center rounded-full px-1 font-semibold text-ink underline-offset-4 hover:underline">
          {sent.kind === "email" ? "Modifier l'adresse" : "Modifier le numéro"}
        </button>
        <form action={requestAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="identifier" value={sent.identifier} />
          <button type="submit" disabled={cooldown > 0} className="inline-flex min-h-11 items-center rounded-full px-1 font-semibold text-ink underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline">
            {cooldown > 0 ? `Renvoyer le code (${cooldown} s)` : "Renvoyer le code"}
          </button>
        </form>
      </div>
    </div>
  );
}

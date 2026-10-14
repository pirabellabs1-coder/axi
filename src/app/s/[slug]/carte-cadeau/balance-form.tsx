"use client";

import { useActionState, useState } from "react";
import { checkGiftCardBalance } from "@/lib/giftcards/actions";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";

/** Groupe la saisie par 4 caractères (affichage uniquement ; la normalisation réelle est faite côté serveur). */
function group(v: string): string {
  const raw = v.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 16);
  return (raw.match(/.{1,4}/g) ?? []).join("-");
}

export function BalanceForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(checkGiftCardBalance, undefined);
  const [code, setCode] = useState("");
  const result = state?.ok ? state.data : undefined;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <div>
        <label htmlFor="gc-code" className="mb-1.5 block text-sm font-medium text-ink">
          Code de la carte
        </label>
        <input
          id="gc-code"
          name="code"
          value={code}
          onChange={(e) => setCode(group(e.target.value))}
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={19}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          aria-describedby={state && !state.ok ? "gc-error" : undefined}
          aria-invalid={state && !state.ok ? true : undefined}
          className="h-12 w-full rounded-[12px] border-0 bg-surface px-4 font-mono text-lg tracking-[0.08em] text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-[var(--store-primary)]"
        />
      </div>
      {state && !state.ok && (
        <p id="gc-error" role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--store-primary)] px-6 text-[15px] font-semibold text-[var(--store-primary-contrast)] transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Vérification…" : "Vérifier le solde"}
      </button>
      <div aria-live="polite">
        {result && (
          <div className="rounded-[12px] bg-surface-2 px-4 py-4 text-center ring-1 ring-line">
            <p className="text-sm text-ink-muted">Carte •••• {result.last4}</p>
            <p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-ink">{formatMoney(result.balance, result.currency)}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {result.balance === 0 ? "Cette carte a été entièrement utilisée." : result.expiresAt ? `Valable jusqu'au ${formatDate(result.expiresAt, { month: "long" })}` : "Sans date d'expiration"}
            </p>
          </div>
        )}
      </div>
    </form>
  );
}

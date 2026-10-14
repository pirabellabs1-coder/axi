"use client";

import { useId, useState } from "react";
import { Gift, X, ChevronDown } from "lucide-react";
import { formatMoney } from "@/lib/money";

/**
 * Champ « Carte cadeau » du checkout (équipe C ; intégré par l'équipe E dans /s/[slug]/commander).
 * Composant contrôlé et autonome : il ne connaît pas `previewTotals`. Le parent :
 *  - conserve `codes` (au plus `max`, 3 par défaut) et les envoie à previewTotals puis à placeOrder ;
 *  - appelle previewTotals dans `onCodesChange(codes)` et renvoie le résultat via `applied` / `error`.
 * `applied` = `[{ last4, applied, remainingAfter }]` (forme renvoyée par previewTotals, §3).
 * Les codes sont normalisés pour l'affichage uniquement ; la validation réelle est faite côté serveur.
 */
export type AppliedGiftCard = { last4: string; applied: number; remainingAfter: number };

function normalize(v: string): string {
  return v.toUpperCase().replace(/[\s\-_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}
function group(raw: string): string {
  return (raw.match(/.{1,4}/g) ?? []).join("-");
}

export function GiftCardInput({
  codes,
  onCodesChange,
  applied = [],
  error,
  currency,
  pending = false,
  disabled = false,
  max = 3,
  defaultOpen,
}: {
  codes: string[];
  onCodesChange: (codes: string[]) => void | Promise<void>;
  applied?: AppliedGiftCard[];
  error?: string | null;
  currency: string;
  pending?: boolean;
  disabled?: boolean;
  max?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? codes.length > 0);
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const id = useId();
  const inputId = `${id}-code`;
  const errId = `${id}-error`;
  const shownError = localError ?? error ?? null;

  const add = async () => {
    const code = normalize(draft);
    if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(code)) {
      setLocalError("Carte cadeau invalide");
      return;
    }
    if (codes.includes(code)) {
      setLocalError("Cette carte est déjà ajoutée.");
      return;
    }
    if (codes.length >= max) {
      setLocalError(`${max} cartes cadeaux maximum par commande.`);
      return;
    }
    setLocalError(null);
    setDraft("");
    await onCodesChange([...codes, code]);
  };
  const remove = async (code: string) => {
    setLocalError(null);
    await onCodesChange(codes.filter((c) => c !== code));
  };

  return (
    <div className="rounded-[var(--store-card-radius,16px)] ring-1 ring-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-[15px] font-medium text-ink"
      >
        <span className="inline-flex items-center gap-2">
          <Gift className="size-4 text-ink-muted" aria-hidden /> Carte cadeau
          {codes.length > 0 && <span className="text-sm font-normal text-ink-muted">({codes.length})</span>}
        </span>
        <ChevronDown className={`size-4 text-ink-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div id={`${id}-panel`} className="space-y-3 border-t border-line px-4 pb-4 pt-3">
          {codes.length > 0 && (
            <ul className="space-y-2" aria-label="Cartes cadeaux appliquées">
              {codes.map((code) => {
                const a = applied.find((x) => x.last4 === code.slice(-4));
                return (
                  <li key={code} className="flex items-center justify-between gap-3 rounded-[12px] bg-surface-2 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-mono text-ink">•••• {code.slice(-4)}</span>
                      {a && (
                        <span className="block text-xs text-ink-muted">
                          −{formatMoney(a.applied, currency)} · reste {formatMoney(a.remainingAfter, currency)}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(code)}
                      disabled={pending || disabled}
                      aria-label={`Retirer la carte se terminant par ${code.slice(-4)}`}
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-50"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {codes.length < max && (
            <div className="flex gap-2">
              <label htmlFor={inputId} className="sr-only">
                Code de la carte cadeau
              </label>
              <input
                id={inputId}
                value={draft}
                onChange={(e) => {
                  setLocalError(null);
                  setDraft(group(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 16)));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void add();
                  }
                }}
                disabled={pending || disabled}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={19}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                aria-invalid={shownError ? true : undefined}
                aria-describedby={shownError ? errId : undefined}
                className="h-11 min-w-0 flex-1 rounded-[12px] border-0 bg-surface px-3 font-mono text-[15px] tracking-[0.06em] text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-[var(--store-primary)]"
              />
              <button
                type="button"
                onClick={() => void add()}
                disabled={pending || disabled || draft.length === 0}
                className="h-11 shrink-0 rounded-full bg-[var(--store-primary)] px-5 text-sm font-semibold text-[var(--store-primary-contrast)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "…" : "Appliquer"}
              </button>
            </div>
          )}
          {shownError && (
            <p id={errId} role="alert" className="text-sm font-medium text-danger">
              {shownError}
            </p>
          )}
          <p className="text-xs text-ink-muted">Une carte cadeau ne peut pas servir à acheter une autre carte cadeau.</p>
        </div>
      )}
    </div>
  );
}

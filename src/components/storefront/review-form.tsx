"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Star, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { submitReview } from "@/lib/storefront/review-actions";
import type { ActionResult } from "@/lib/action";

const LABELS = ["", "Décevant", "Moyen", "Bien", "Très bien", "Excellent"];

/**
 * « Laisser un avis » sur un produit d'une commande livrée.
 * Note en boutons radio natifs (clavier : flèches), texte libre, erreurs liées aux champs.
 */
export function ReviewForm({ token, productId, productName }: { token: string; productId: string; productName: string }) {
  const [state, action] = useActionState<ActionResult | undefined, FormData>(submitReview, undefined);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  // Champ contrôlé : React 19 réinitialise les champs non contrôlés après l'action, on garde la saisie en cas d'erreur.
  const [body, setBody] = useState("");
  const id = productId.slice(-8);

  if (state?.ok) {
    return (
      <div className="sf-pop flex items-start gap-3 rounded-[14px] bg-[#e8f6ef] px-4 py-3.5 text-sm text-[#0b5a3f]" role="status">
        <Check className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p>{state.message}</p>
      </div>
    );
  }

  const ratingError = state && !state.ok ? state.fieldErrors?.rating?.[0] : undefined;
  const bodyError = state && !state.ok ? state.fieldErrors?.body?.[0] : undefined;
  const formError = state && !state.ok && !ratingError && !bodyError ? state.error : undefined;
  const shown = hover || rating;

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="productId" value={productId} />
      <fieldset aria-describedby={ratingError ? `rating-err-${id}` : undefined}>
        <legend className="mb-2 text-sm font-medium text-ink">
          Votre note pour {productName} <span className="text-danger" aria-hidden>*</span>
        </legend>
        <div className="flex items-center gap-3">
          <div className="flex" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="relative inline-flex size-11 cursor-pointer items-center justify-center" onMouseEnter={() => setHover(n)}>
                <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="peer sr-only" aria-label={`${n} sur 5, ${LABELS[n]}`} />
                <Star
                  className={cn("size-7 transition-transform duration-150 ease-out peer-focus-visible:scale-110 peer-active:scale-90", n <= shown ? "text-[#E8A317]" : "text-line-strong")}
                  fill="currentColor"
                  strokeWidth={0}
                  aria-hidden
                />
                <span className="pointer-events-none absolute inset-1 rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--store-primary)]" aria-hidden />
              </label>
            ))}
          </div>
          <span className="text-sm text-ink-muted" aria-hidden>
            {shown ? LABELS[shown] : ""}
          </span>
        </div>
        {ratingError && (
          <p id={`rating-err-${id}`} role="alert" className="mt-1 text-[13px] font-medium text-danger">
            {ratingError}
          </p>
        )}
      </fieldset>
      <div>
        <label htmlFor={`body-${id}`} className="mb-1.5 block text-sm font-medium text-ink">
          Votre avis <span className="text-danger" aria-hidden>*</span>
        </label>
        <textarea
          id={`body-${id}`}
          name="body"
          rows={3}
          maxLength={1000}
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? `body-err-${id}` : `body-hint-${id}`}
          className="block min-h-24 w-full rounded-[var(--radius-md)] bg-surface px-4 py-3 text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-[var(--store-primary)] aria-invalid:ring-2 aria-invalid:ring-danger"
          placeholder="Qualité, goût, délai, accueil…"
        />
        {bodyError ? (
          <p id={`body-err-${id}`} role="alert" className="mt-1.5 text-[13px] font-medium text-danger">
            {bodyError}
          </p>
        ) : (
          <p id={`body-hint-${id}`} className="mt-1.5 text-[13px] text-ink-muted">
            Publié avec votre prénom après validation par la boutique.
          </p>
        )}
      </div>
      {formError && (
        <p role="alert" className="rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {formError}
        </p>
      )}
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--store-primary)] px-6 text-sm font-semibold text-[var(--store-primary-contrast)] transition-transform duration-150 active:scale-[0.97] disabled:opacity-60">
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending ? "Envoi…" : "Publier mon avis"}
    </button>
  );
}

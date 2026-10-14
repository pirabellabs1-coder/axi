"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Camera, Loader2, X } from "lucide-react";
import { requestReturn } from "@/lib/returns/actions";
import { RETURN_REASONS, RESOLUTION_LABELS } from "@/lib/returns/policy";
import { compressPhoto } from "@/lib/storage/client";
import { ACCEPTED_IMAGE_TYPES } from "@/lib/storage/limits";
import { formatMoney } from "@/lib/money";
import { FormMessage, fieldError } from "@/components/forms/form-message";

export type FormItem = { id: string; name: string; variantName: string | null; unitPrice: number; remaining: number; returnable: boolean; image: string | null; variants: { id: string; name: string }[] };

type Proof = { kind: "token"; token: string } | { kind: "session"; reference: string };

const input = "h-12 w-full rounded-[12px] bg-surface px-3.5 text-[15px] text-ink ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-[var(--store-primary)]";
const label = "mb-1.5 block text-sm font-medium text-ink";

/** Formulaire de demande de retour (suivi par jeton et compte client). Le serveur revérifie tout. */
export function ReturnRequestForm({
  slug,
  proof,
  items,
  currency,
  resolutions,
  requirePhotos,
  afterSuccessHref,
}: {
  slug: string;
  proof: Proof;
  items: FormItem[];
  currency: string;
  resolutions: ("REFUND" | "STORE_CREDIT" | "EXCHANGE")[];
  requirePhotos: boolean;
  /** Redirection après succès (`{reference}` remplacé) ; sinon rafraîchissement de la page. */
  afterSuccessHref?: string;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [exchange, setExchange] = useState<Record<string, string>>({});
  const [resolution, setResolution] = useState(resolutions[0] ?? "STORE_CREDIT");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, action] = useActionState(requestReturn, undefined);

  useEffect(() => {
    if (state?.ok) {
      if (afterSuccessHref && state.data?.reference) router.push(afterSuccessHref.replace("{reference}", state.data.reference));
      else router.refresh();
    }
  }, [state, router, afterSuccessHref]);

  const selectable = items.filter((i) => i.returnable && i.remaining > 0);
  const chosen = selectable.filter((i) => (qty[i.id] ?? 0) > 0);
  const payload = chosen.map((i) => ({ orderItemId: i.id, quantity: qty[i.id], exchangeVariantId: resolution === "EXCHANGE" ? exchange[i.id] || null : null }));

  async function addPhoto(file: File) {
    setPhotoError(null);
    setUploading(true);
    try {
      const blob = await compressPhoto(file).catch(() => file);
      const url = `/api/s/${encodeURIComponent(slug)}/returns/photos${proof.kind === "session" ? `?commande=${encodeURIComponent(proof.reference)}` : ""}`;
      const res = await fetch(url, {
        method: "POST",
        body: blob,
        headers: { "Content-Type": blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg", ...(proof.kind === "token" ? { "x-return-token": proof.token } : {}) },
      });
      const body = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
      if (!res.ok || !body?.url) throw new Error(body?.error?.message ?? "L'envoi de la photo a échoué. Réessayez.");
      setPhotos((p) => [...p, body.url!].slice(0, 3));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "L'envoi de la photo a échoué.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (selectable.length === 0) return <p className="text-sm text-ink-muted">Tous les articles de cette commande ont déjà fait l'objet d'une demande.</p>;

  return (
    <form action={action} className="space-y-6">
      {proof.kind === "token" ? <input type="hidden" name="token" value={proof.token} /> : <input type="hidden" name="reference" value={proof.reference} />}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />
      <input type="hidden" name="photos" value={JSON.stringify(photos)} />
      <input type="hidden" name="resolution" value={resolution} />
      <FormMessage state={state} />

      <fieldset>
        <legend className={label}>Quels articles souhaitez-vous retourner ?</legend>
        <ul className="divide-y divide-line rounded-[12px] ring-1 ring-line">
          {items.map((it) => {
            const disabled = !it.returnable || it.remaining === 0;
            const q = qty[it.id] ?? 0;
            return (
              <li key={it.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-ink">{it.name}</p>
                  <p className="text-ink-muted">
                    {it.variantName ? `${it.variantName} · ` : ""}
                    {formatMoney(it.unitPrice, currency)}
                    {disabled && <span> · {it.returnable ? "déjà demandé" : "non retournable"}</span>}
                  </p>
                </div>
                {!disabled && (
                  <label className="flex items-center gap-2 text-sm text-ink-muted">
                    Quantité
                    <select
                      className="h-11 rounded-[10px] bg-surface px-3 text-ink ring-1 ring-inset ring-line-strong"
                      value={q}
                      onChange={(e) => setQty((s) => ({ ...s, [it.id]: Number(e.target.value) }))}
                      aria-label={`Quantité à retourner pour ${it.name}`}
                    >
                      {Array.from({ length: it.remaining + 1 }, (_, n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!disabled && q > 0 && resolution === "EXCHANGE" && it.variants.length > 0 && (
                  <label className="w-full text-sm text-ink-muted">
                    Échanger contre
                    <select className={`${input} mt-1`} value={exchange[it.id] ?? ""} onChange={(e) => setExchange((s) => ({ ...s, [it.id]: e.target.value }))}>
                      <option value="">Le même article</option>
                      {it.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        {fieldError(state, "items") && <p className="mt-2 text-sm text-danger">{fieldError(state, "items")}</p>}
      </fieldset>

      <div>
        <label htmlFor="rr-reason" className={label}>
          Motif
        </label>
        <select id="rr-reason" name="reason" className={input} defaultValue="size" required>
          {Object.entries(RETURN_REASONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className={label}>Vous préférez</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {resolutions.map((r) => (
            <label
              key={r}
              className={`flex min-h-12 cursor-pointer items-center justify-center rounded-[12px] px-3 text-sm font-medium ring-1 ring-inset ${resolution === r ? "bg-[var(--store-primary)] text-[var(--store-primary-contrast)] ring-[var(--store-primary)]" : "bg-surface text-ink ring-line-strong"}`}
            >
              <input type="radio" className="sr-only" name="resolutionChoice" value={r} checked={resolution === r} onChange={() => setResolution(r)} />
              {RESOLUTION_LABELS[r]}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink-muted">La boutique confirme la solution après réception des articles.</p>
      </fieldset>

      <div>
        <label htmlFor="rr-note" className={label}>
          Précisions (facultatif)
        </label>
        <textarea id="rr-note" name="note" rows={3} maxLength={1000} className={`${input} h-auto py-3`} placeholder="Ex. la taille M est trop petite" />
      </div>

      <div>
        <p className={label}>
          Photos {requirePhotos ? "(au moins une)" : "(facultatif)"}, 3 maximum
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((u, i) => (
            <span key={u} className="relative size-20 overflow-hidden rounded-[12px] ring-1 ring-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Photo ${i + 1}`} className="size-full object-cover" />
              <button
                type="button"
                onClick={() => setPhotos((p) => p.filter((x) => x !== u))}
                className="absolute right-0.5 top-0.5 inline-flex size-7 items-center justify-center rounded-full bg-ink/70 text-white"
                aria-label={`Retirer la photo ${i + 1}`}
              >
                <X className="size-4" aria-hidden />
              </button>
            </span>
          ))}
          {photos.length < 3 && (
            <label className="inline-flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-[12px] bg-surface text-xs text-ink-muted ring-1 ring-dashed ring-line-strong">
              {uploading ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Camera className="size-5" aria-hidden />}
              {uploading ? "Envoi…" : "Ajouter"}
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void addPhoto(f);
                }}
              />
            </label>
          )}
        </div>
        {(photoError || fieldError(state, "photos")) && (
          <p className="mt-2 text-sm text-danger" role="alert">
            {photoError ?? fieldError(state, "photos")}
          </p>
        )}
      </div>

      <PendingButton disabled={chosen.length === 0 || uploading || (requirePhotos && photos.length === 0)} />
    </form>
  );
}

/** Bouton d'envoi aux couleurs de la boutique (useFormStatus). */
function PendingButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--store-primary)] px-6 text-sm font-semibold text-[var(--store-primary-contrast)] transition-transform active:scale-[0.98] disabled:opacity-50 sm:w-auto"
    >
      {pending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
      Envoyer la demande
    </button>
  );
}

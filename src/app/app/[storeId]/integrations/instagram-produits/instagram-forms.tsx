"use client";

import { useActionState, useState } from "react";
import { Tag } from "lucide-react";
import { saveInstagramAccount, tagInstagramMedia } from "@/lib/social/instagram-actions";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton } from "@/components/app/action-controls";
import { cn } from "@/lib/utils";

export function InstagramAccountForm({ storeId, igUserId, disabled }: { storeId: string; igUserId: string; disabled?: boolean }) {
  const [state, action] = useActionState(saveInstagramAccount, undefined);
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <Field
        id="igUserId"
        label="Identifiant du compte Instagram professionnel"
        required
        error={fieldError(state, "igUserId")}
        hint="Meta Business Suite, Paramètres, Comptes Instagram : identifiant numérique du compte (pas le @nom)."
      >
        {(p) => <Input {...p} name="igUserId" defaultValue={igUserId} inputMode="numeric" autoComplete="off" spellCheck={false} className="font-mono text-sm" disabled={disabled} />}
      </Field>
      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton disabled={disabled}>Vérifier et enregistrer</SubmitButton>
      </div>
    </form>
  );
}

export type MediaOption = { id: string; caption: string; thumbnail: string | null; permalink: string | null; kind: string };
export type ProductOption = { id: string; name: string };

/** Choix d'une publication récente puis de 1 à 5 produits ; envoi par l'action serveur (contrôles côté serveur). */
export function TagMediaForm({ storeId, media, products, max, disabled }: { storeId: string; media: MediaOption[]; products: ProductOption[]; max: number; disabled?: boolean }) {
  const [mediaId, setMediaId] = useState<string>("");
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= max ? cur : [...cur, id]));
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-ink">1. Publication ou Reel</legend>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((m) => (
            <li key={m.id}>
              <label
                className={cn(
                  "flex h-full cursor-pointer flex-col gap-2 rounded-[var(--radius-md)] p-2 ring-1 ring-inset focus-within:ring-2 focus-within:ring-primary",
                  mediaId === m.id ? "ring-2 ring-primary" : "ring-line",
                )}
              >
                <input type="radio" name="mediaId" value={m.id} checked={mediaId === m.id} onChange={() => setMediaId(m.id)} className="sr-only" disabled={disabled} />
                {m.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- miniature Instagram (CDN Meta, URL signée temporaire)
                  <img src={m.thumbnail} alt="" className="aspect-square w-full rounded-[8px] object-cover" loading="lazy" />
                ) : (
                  <span className="flex aspect-square w-full items-center justify-center rounded-[8px] bg-surface-2 text-xs text-ink-muted">{m.kind}</span>
                )}
                <span className="line-clamp-2 text-xs text-ink">{m.caption || "Sans légende"}</span>
                <span className="text-[11px] text-ink-muted">{m.kind}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-ink">
          2. Produits ({picked.length}/{max})
        </legend>
        <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto rounded-[var(--radius-md)] p-3 ring-1 ring-inset ring-line sm:grid-cols-2">
          {products.map((p) => (
            <Checkbox key={p.id} label={p.name} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} disabled={disabled || (!picked.includes(p.id) && picked.length >= max)} className="min-h-11 items-center" />
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end border-t border-line pt-4">
        <ActionButton
          action={() => tagInstagramMedia(storeId, mediaId, picked)}
          disabled={disabled || !mediaId || picked.length === 0}
          onDone={(r) => {
            if (r.ok) setPicked([]);
          }}
          className="min-h-11"
        >
          <Tag className="size-4" aria-hidden /> Identifier les produits
        </ActionButton>
      </div>
    </div>
  );
}

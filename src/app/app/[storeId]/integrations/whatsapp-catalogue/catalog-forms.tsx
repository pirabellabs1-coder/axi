"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { saveCatalogOptions, saveCatalogSync, triggerCatalogSyncNow } from "@/lib/social/actions";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, CopyButton } from "@/components/app/action-controls";

/** URL de flux à copier dans Commerce Manager, Merchant Center ou TikTok. */
export function FeedUrl({ url, label }: { url: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] bg-surface-2 p-2 ring-1 ring-inset ring-line">
      <code className="min-w-0 flex-1 truncate px-1.5 font-mono text-[12.5px] text-ink" title={url}>
        {url}
      </code>
      <CopyButton value={url} label="Copier" className="h-11" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function CatalogOptionsForm({
  storeId, brand, includeOutOfStock, googleProductCategory, storeName, disabled,
}: { storeId: string; brand: string; includeOutOfStock: boolean; googleProductCategory: string; storeName: string; disabled?: boolean }) {
  const [state, action] = useActionState(saveCatalogOptions, undefined);
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <Field id="brand" label="Marque affichée" error={fieldError(state, "brand")} hint={`Laissez vide pour utiliser la marque du produit, sinon « ${storeName} ».`}>
        {(p) => <Input {...p} name="brand" defaultValue={brand} maxLength={70} autoComplete="off" disabled={disabled} />}
      </Field>
      <Field
        id="googleProductCategory"
        label="Catégorie Google (facultatif)"
        error={fieldError(state, "googleProductCategory")}
        hint="Numéro ou chemin de la taxonomie Google, par exemple 2271 ou « Apparel & Accessories > Clothing ». Aide Google Shopping, YouTube, Meta et TikTok à classer vos produits."
      >
        {(p) => <Input {...p} name="googleProductCategory" defaultValue={googleProductCategory} maxLength={250} autoComplete="off" spellCheck={false} disabled={disabled} />}
      </Field>
      <Checkbox
        name="includeOutOfStock"
        defaultChecked={includeOutOfStock}
        disabled={disabled}
        label="Publier aussi les articles en rupture"
        description="Recommandé par Meta : l'article reste visible avec la mention « en rupture » au lieu de disparaître du catalogue."
      />
      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton disabled={disabled}>Enregistrer les options</SubmitButton>
      </div>
    </form>
  );
}

export function CatalogSyncForm({ storeId, catalogId, enabled, disabled }: { storeId: string; catalogId: string; enabled: boolean; disabled?: boolean }) {
  const [state, action] = useActionState(saveCatalogSync, undefined);
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <Field
        id="externalCatalogId"
        label="Identifiant du catalogue Meta"
        required
        error={fieldError(state, "externalCatalogId")}
        hint="Commerce Manager, Catalogue, Paramètres : « ID du catalogue » (chiffres uniquement)."
      >
        {(p) => <Input {...p} name="externalCatalogId" defaultValue={catalogId} inputMode="numeric" autoComplete="off" spellCheck={false} className="font-mono text-sm" disabled={disabled} />}
      </Field>
      <Checkbox
        name="enabled"
        defaultChecked={enabled}
        disabled={disabled}
        label="Synchroniser automatiquement"
        description="Les modifications de prix, de stock et de photos partent vers WhatsApp au plus tard une heure après."
      />
      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton disabled={disabled}>Enregistrer</SubmitButton>
      </div>
    </form>
  );
}

export function SyncNowButton({ storeId, disabled }: { storeId: string; disabled?: boolean }) {
  return (
    <ActionButton action={() => triggerCatalogSyncNow(storeId)} variant="outline" size="md" disabled={disabled} className="min-h-11">
      <RefreshCw className="size-4" aria-hidden /> Synchroniser maintenant
    </ActionButton>
  );
}

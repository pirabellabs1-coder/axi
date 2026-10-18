"use client";

import { useActionState } from "react";
import { RefreshCw, Send, Unlink } from "lucide-react";
import { publishTiktokProduct, saveTiktokAttributes, saveTiktokSettings, selectTiktokShop, setTiktokCategory, syncTiktokNow, disconnectTiktokShop, unlinkTiktokProduct } from "@/lib/tiktok-shop/actions";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, ConfirmActionButton } from "@/components/app/action-controls";

export function SelectShopForm({ storeId, shops }: { storeId: string; shops: { id: string; label: string }[] }) {
  const [state, action] = useActionState(selectTiktokShop, undefined);
  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <Field id="shopId" label="Boutique TikTok Shop à relier" required error={fieldError(state, "shopId")}>
        {(p) => (
          <Select {...p} name="shopId" defaultValue={shops[0]?.id}>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex justify-end">
        <SubmitButton>Relier cette boutique</SubmitButton>
      </div>
    </form>
  );
}

export type SettingsValues = { markupPercent: number; defaultWeightGrams: number; lengthCm: number; widthCm: number; heightCm: number; untrackedQuantity: number; enabled: boolean };

export function SettingsForm({ storeId, values, disabled }: { storeId: string; values: SettingsValues; disabled?: boolean }) {
  const [state, action] = useActionState(saveTiktokSettings, undefined);
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <Field id="markupPercent" label="Majoration du prix sur TikTok (%)" error={fieldError(state, "markupPercent")} hint="Couvre la commission TikTok et le change. 0 = prix converti au taux du jour.">
        {(p) => <Input {...p} name="markupPercent" type="number" inputMode="decimal" min={0} max={50} step="0.5" defaultValue={values.markupPercent} disabled={disabled} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="defaultWeightGrams" label="Poids du colis par défaut (g)" error={fieldError(state, "defaultWeightGrams")} hint="Utilisé si le produit n'a pas de poids.">
          {(p) => <Input {...p} name="defaultWeightGrams" type="number" inputMode="numeric" min={1} defaultValue={values.defaultWeightGrams} disabled={disabled} />}
        </Field>
        <Field id="untrackedQuantity" label="Quantité annoncée sans suivi de stock" error={fieldError(state, "untrackedQuantity")}>
          {(p) => <Input {...p} name="untrackedQuantity" type="number" inputMode="numeric" min={0} defaultValue={values.untrackedQuantity} disabled={disabled} />}
        </Field>
      </div>
      <fieldset className="grid grid-cols-3 gap-3">
        <legend className="mb-2 text-sm font-medium text-ink">Dimensions du colis par défaut (cm)</legend>
        <Field id="lengthCm" label="Longueur">
          {(p) => <Input {...p} name="lengthCm" type="number" inputMode="numeric" min={1} defaultValue={values.lengthCm} disabled={disabled} />}
        </Field>
        <Field id="widthCm" label="Largeur">
          {(p) => <Input {...p} name="widthCm" type="number" inputMode="numeric" min={1} defaultValue={values.widthCm} disabled={disabled} />}
        </Field>
        <Field id="heightCm" label="Hauteur">
          {(p) => <Input {...p} name="heightCm" type="number" inputMode="numeric" min={1} defaultValue={values.heightCm} disabled={disabled} />}
        </Field>
      </fieldset>
      <Checkbox name="enabled" defaultChecked={values.enabled} disabled={disabled} label="Synchronisation automatique" description="Commandes, stock et expéditions toutes les 10 minutes environ." />
      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton disabled={disabled}>Enregistrer</SubmitButton>
      </div>
    </form>
  );
}

export function SyncNowButton({ storeId, disabled }: { storeId: string; disabled?: boolean }) {
  return (
    <ActionButton action={() => syncTiktokNow(storeId)} variant="outline" disabled={disabled} className="min-h-11">
      <RefreshCw className="size-4" aria-hidden /> Synchroniser maintenant
    </ActionButton>
  );
}

export function DisconnectButton({ storeId }: { storeId: string }) {
  return (
    <ConfirmActionButton
      action={() => disconnectTiktokShop(storeId)}
      title="Déconnecter TikTok Shop ?"
      description="Les commandes ne seront plus importées et le stock ne sera plus synchronisé. Les produits restent visibles sur TikTok tant que vous ne les retirez pas dans Seller Center."
      confirmLabel="Déconnecter"
    >
      Déconnecter
    </ConfirmActionButton>
  );
}

export function PublishButton({ storeId, productId, label, disabled }: { storeId: string; productId: string; label: string; disabled?: boolean }) {
  return (
    <ActionButton action={() => publishTiktokProduct(storeId, productId)} size="sm" disabled={disabled} className="min-h-11">
      <Send className="size-4" aria-hidden /> {label}
    </ActionButton>
  );
}

export function UnlinkButton({ storeId, productId }: { storeId: string; productId: string }) {
  return (
    <ConfirmActionButton
      action={() => unlinkTiktokProduct(storeId, productId)}
      title="Retirer ce produit de TikTok Shop ?"
      description="Son stock passe à zéro sur TikTok (il n'est plus achetable) et le lien avec Axi est supprimé."
      confirmLabel="Retirer"
    >
      <Unlink className="size-4" aria-hidden /> Retirer
    </ConfirmActionButton>
  );
}

export function CategoryChoiceForm({ storeId, productId, categories, current }: { storeId: string; productId: string; categories: { id: string; label: string }[]; current: string | null }) {
  const [state, action] = useActionState(setTiktokCategory, undefined);
  return (
    <form action={action} noValidate className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="productId" value={productId} />
      <fieldset className="max-h-80 space-y-1 overflow-y-auto rounded-[var(--radius-md)] ring-1 ring-inset ring-line p-2">
        <legend className="sr-only">Catégories TikTok</legend>
        {categories.map((c) => (
          <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2 text-sm text-ink hover:bg-surface-2">
            <input
              type="radio"
              name="categoryId"
              value={c.id}
              defaultChecked={c.id === current}
              required
              onChange={(e) => {
                const hidden = e.currentTarget.form?.elements.namedItem("categoryName") as HTMLInputElement | null;
                if (hidden) hidden.value = c.label;
              }}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </fieldset>
      <input type="hidden" name="categoryName" defaultValue={categories.find((c) => c.id === current)?.label ?? categories[0]?.label ?? ""} />
      <div className="flex justify-end">
        <SubmitButton>Choisir cette catégorie</SubmitButton>
      </div>
    </form>
  );
}

export type AttributeField = { id: string; name: string; required: boolean; multiple: boolean; customizable: boolean; values: { id: string; name: string }[]; selected: string[]; custom: string };

export function AttributesForm({ storeId, productId, attributes }: { storeId: string; productId: string; attributes: AttributeField[] }) {
  const [state, action] = useActionState(saveTiktokAttributes, undefined);
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="productId" value={productId} />
      {attributes.map((a) => (
        <Field key={a.id} id={`attr_${a.id}`} label={a.name} required={a.required} error={fieldError(state, `attr_${a.id}`)} hint={a.customizable ? "Choisissez une valeur ou saisissez la vôtre." : undefined}>
          {(p) => (
            <div className="space-y-2">
              {a.values.length > 0 && (
                <Select {...p} name={`attr_${a.id}`} multiple={a.multiple} defaultValue={a.multiple ? a.selected : (a.selected[0] ?? "")} className={a.multiple ? "min-h-28" : undefined}>
                  {!a.multiple && <option value="">Aucune</option>}
                  {a.values.slice(0, 300).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              )}
              {a.customizable && <Input name={`attr_${a.id}_custom`} defaultValue={a.custom} maxLength={120} placeholder="Valeur libre" aria-label={`${a.name} (valeur libre)`} id={a.values.length ? undefined : p.id} />}
            </div>
          )}
        </Field>
      ))}
      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton>Enregistrer les attributs</SubmitButton>
      </div>
    </form>
  );
}

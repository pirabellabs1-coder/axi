"use client";

import { useActionState, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { upsertCoupon, toggleCoupon, deleteCoupon } from "@/lib/coupons/actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Hint } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { AsyncSwitch, ConfirmActionButton } from "@/components/app/action-controls";
import { MultiPicker } from "./_components/multi-picker";
import type { PromoPickOptions } from "./_components/pick-options";

export type CouponDTO = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED" | "FREE_DELIVERY";
  value: number;
  minSubtotal: number;
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  usesCount: number;
  redemptions: number;
  // Lot 1
  combinesWithAutomatic: boolean;
  firstOrderOnly: boolean;
  appliesToProductIds: string[];
  appliesToCollectionIds: string[];
};

type PickProps = Pick<PromoPickOptions, "products" | "collections">;

/** Valeur pour <input type="datetime-local"> en heure locale (et non UTC). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function CouponDialog({ storeId, coupon, currency, trigger, options }: { storeId: string; coupon?: CouponDTO; currency: string; trigger?: "icon"; options: PickProps }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(upsertCoupon, undefined);
  const [type, setType] = useState<CouponDTO["type"]>(coupon?.type ?? "PERCENT");
  const [code, setCode] = useState(coupon?.code ?? "");
  const [active, setActive] = useState(coupon?.active ?? true);
  const [combines, setCombines] = useState(coupon?.combinesWithAutomatic ?? true);
  const [firstOrder, setFirstOrder] = useState(coupon?.firstOrderOnly ?? false);
  const [scope, setScope] = useState<"all" | "products" | "collections">(coupon?.appliesToProductIds.length ? "products" : coupon?.appliesToCollectionIds.length ? "collections" : "all");
  const [productIds, setProductIds] = useState<string[]>(coupon?.appliesToProductIds ?? []);
  const [collectionIds, setCollectionIds] = useState<string[]>(coupon?.appliesToCollectionIds ?? []);

  // Ferme la fenêtre au succès (comparaison pendant le rendu, sans effet).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }

  return (
    <>
      {trigger === "icon" ? (
        <Button variant="ghost" size="icon" aria-label={`Modifier ${coupon?.code}`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button variant="accent" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Nouveau code
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={coupon ? `Modifier ${coupon.code}` : "Nouveau code promo"} description="Le client saisit ce code au panier. Vous pouvez le désactiver à tout moment." sheet>
        <form action={action} noValidate className="space-y-4" key={open ? "open" : "closed"}>
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={storeId} />
          {coupon && <input type="hidden" name="id" value={coupon.id} />}
          <Field id="code" label="Code" required error={fieldError(state, "code")} hint="3 à 24 caractères, majuscules automatiques. Par exemple BIENVENUE10.">
            {(p) => <Input {...p} name="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} maxLength={24} autoComplete="off" className="font-mono uppercase" />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="type" label="Type de remise" required>
              {(p) => (
                <Select {...p} name="type" value={type} onChange={(e) => setType(e.target.value as CouponDTO["type"])}>
                  <option value="PERCENT">Pourcentage</option>
                  <option value="FIXED">Montant fixe</option>
                  <option value="FREE_DELIVERY">Livraison offerte</option>
                </Select>
              )}
            </Field>
            {type !== "FREE_DELIVERY" && (
              <Field id="value" label={type === "PERCENT" ? "Pourcentage (%)" : `Montant (${currency})`} required error={fieldError(state, "value")}>
                {(p) => <Input {...p} name="value" type="number" inputMode="numeric" min={type === "PERCENT" ? 1 : 0} max={type === "PERCENT" ? 100 : undefined} defaultValue={coupon?.value || ""} />}
              </Field>
            )}
          </div>
          <Field id="minSubtotal" label={`Minimum de commande (${currency})`} error={fieldError(state, "minSubtotal")} hint="0 = pas de minimum.">
            {(p) => <Input {...p} name="minSubtotal" type="number" inputMode="numeric" min={0} defaultValue={coupon?.minSubtotal ?? 0} />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="maxUses" label="Limite d'utilisations (total)" error={fieldError(state, "maxUses")} hint="Vide = illimité.">
              {(p) => <Input {...p} name="maxUses" type="number" inputMode="numeric" min={0} defaultValue={coupon?.maxUses ?? ""} />}
            </Field>
            <Field id="maxUsesPerCustomer" label="Limite par client" error={fieldError(state, "maxUsesPerCustomer")} hint="Par numéro de téléphone.">
              {(p) => <Input {...p} name="maxUsesPerCustomer" type="number" inputMode="numeric" min={0} defaultValue={coupon?.maxUsesPerCustomer ?? 1} />}
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="startsAt" label="Début" error={fieldError(state, "startsAt")}>
              {(p) => <Input {...p} name="startsAt" type="datetime-local" defaultValue={toLocalInput(coupon?.startsAt ?? null)} />}
            </Field>
            <Field id="endsAt" label="Fin" error={fieldError(state, "endsAt")}>
              {(p) => <Input {...p} name="endsAt" type="datetime-local" defaultValue={toLocalInput(coupon?.endsAt ?? null)} />}
            </Field>
          </div>
          <Field id="scope" label="S'applique à" hint="Les cartes cadeaux ne sont jamais remisées.">
            {(p) => (
              <Select {...p} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                <option value="all">Tout le panier</option>
                <option value="products">Certains produits</option>
                <option value="collections">Certaines collections</option>
              </Select>
            )}
          </Field>
          {scope === "products" && (
            <MultiPicker name="appliesToProductIds" label="Produits concernés" options={options.products} value={productIds} onChange={setProductIds} max={200} error={fieldError(state, "appliesTo")} emptyText="Aucun produit" />
          )}
          {scope === "collections" && (
            <MultiPicker name="appliesToCollectionIds" label="Collections concernées" options={options.collections} value={collectionIds} onChange={setCollectionIds} error={fieldError(state, "appliesTo")} emptyText="Aucune collection" />
          )}
          <div>
            <Switch name="combinesWithAutomatic" checked={combines} onChange={setCombines} label="Cumulable avec les remises automatiques" />
            <Hint>Sinon, le client obtient la meilleure des deux offres (le code ou les remises automatiques).</Hint>
          </div>
          <div>
            <Switch name="firstOrderOnly" checked={firstOrder} onChange={setFirstOrder} label="Première commande uniquement" />
            <Hint>Contrôlé par numéro de téléphone : refusé si ce numéro a déjà une commande non annulée.</Hint>
          </div>
          <div>
            <Switch name="active" checked={active} onChange={setActive} label="Code actif" />
            <Hint>Un code inactif est refusé au panier, même dans sa période de validité.</Hint>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <SubmitButton>{coupon ? "Enregistrer" : "Créer le code"}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function CouponRowActions({ storeId, coupon, currency, options }: { storeId: string; coupon: CouponDTO; currency: string; options: PickProps }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <AsyncSwitch checked={coupon.active} label="Actif" action={(v) => toggleCoupon(storeId, coupon.id, v)} />
      <CouponDialog storeId={storeId} coupon={coupon} currency={currency} trigger="icon" options={options} />
      <ConfirmActionButton
        title={`Supprimer ${coupon.code} ?`}
        description={coupon.redemptions > 0 ? "Ce code a déjà été utilisé : la suppression sera refusée, désactivez-le plutôt." : "Cette action est définitive."}
        confirmLabel="Supprimer"
        action={() => deleteCoupon(storeId, coupon.id)}
        className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">Supprimer {coupon.code}</span>
      </ConfirmActionButton>
    </div>
  );
}

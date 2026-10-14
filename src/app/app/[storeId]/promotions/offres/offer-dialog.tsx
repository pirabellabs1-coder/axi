"use client";

import { useActionState, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { upsertCartOffer, toggleCartOffer, deleteCartOffer } from "@/lib/discounts/actions";
import { PLACEMENT_LABELS, type CartOfferMode, type CartOfferPlacement } from "@/lib/discounts/schema";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Hint, Checkbox } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { AsyncSwitch, ConfirmActionButton } from "@/components/app/action-controls";
import { MultiPicker, type PickOption } from "../_components/multi-picker";

export type OfferDTO = {
  id: string;
  title: string;
  placement: CartOfferPlacement;
  mode: CartOfferMode;
  triggerProductIds: string[];
  triggerCollectionIds: string[];
  offerProductIds: string[];
  automaticDiscountId: string | null;
  /** La remise liée ne s'applique que si un produit déclencheur est au panier. */
  discountRequiresTrigger: boolean;
  position: number;
  active: boolean;
  conversions: number;
};

type Ctx = { storeId: string; products: PickOption[]; collections: PickOption[]; discounts: PickOption[] };

export function OfferDialog({ ctx, offer, trigger }: { ctx: Ctx; offer?: OfferDTO; trigger?: "icon" }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(upsertCartOffer, undefined);
  const [placement, setPlacement] = useState<CartOfferPlacement>(offer?.placement ?? "CART");
  const [mode, setMode] = useState<CartOfferMode>(offer?.mode ?? "add");
  const [triggers, setTriggers] = useState<string[]>(offer?.triggerProductIds ?? []);
  const [triggerCols, setTriggerCols] = useState<string[]>(offer?.triggerCollectionIds ?? []);
  const [offered, setOffered] = useState<string[]>(offer?.offerProductIds ?? []);
  const [active, setActive] = useState(offer?.active ?? true);
  const [discountId, setDiscountId] = useState(offer?.automaticDiscountId ?? "");
  const [requiresTrigger, setRequiresTrigger] = useState(offer?.discountRequiresTrigger ?? false);

  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }

  return (
    <>
      {trigger === "icon" ? (
        <Button variant="ghost" size="icon" aria-label={`Modifier ${offer?.title}`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button variant="accent" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Nouvelle offre
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={offer ? `Modifier « ${offer.title} »` : "Nouvelle offre au panier"} description="Proposez des produits complémentaires (vente croisée) ou une version supérieure (montée en gamme)." sheet>
        <form action={action} noValidate className="space-y-5" key={open ? "open" : "closed"}>
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={ctx.storeId} />
          {offer && <input type="hidden" name="id" value={offer.id} />}
          <Field id="offer-title" label="Titre affiché au client" required error={fieldError(state, "title")} hint="Par exemple « Souvent achetés ensemble ».">
            {(p) => <Input {...p} name="title" defaultValue={offer?.title ?? ""} maxLength={80} />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="offer-placement" label="Emplacement">
              {(p) => (
                <Select {...p} name="placement" value={placement} onChange={(e) => setPlacement(e.target.value as CartOfferPlacement)}>
                  {(Object.keys(PLACEMENT_LABELS) as CartOfferPlacement[]).map((k) => (
                    <option key={k} value={k}>
                      {PLACEMENT_LABELS[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              id="offer-mode"
              label="Type d'offre"
              hint={
                mode === "replace"
                  ? "Le bouton remplace dans le panier l’article déclencheur par le produit proposé, avec la même quantité, les mêmes valeurs d’options (même nom d’option, même valeur, ex. Taille : M) et les mêmes suppléments. Si l’une de ces options manque, si la quantité n’est pas disponible ou sort du minimum ou du maximum du produit proposé, rien n’est modifié : la fiche du produit proposé s’ouvre pour que le client choisisse."
                  : "Le produit proposé s’ajoute au panier en un clic (la fiche s’ouvre s’il a des variantes ou des options à choisir)."
              }
            >
              {(p) => (
                <Select {...p} name="mode" value={mode} onChange={(e) => setMode(e.target.value as CartOfferMode)}>
                  <option value="add">Vente croisée (ajout en un clic)</option>
                  <option value="replace">Montée en gamme (remplace l’article)</option>
                </Select>
              )}
            </Field>
          </div>
          <MultiPicker name="triggerProductIds" label="Déclencheurs : produits" options={ctx.products} value={triggers} onChange={setTriggers} hint="L’offre apparaît quand l’un de ces produits est au panier (ou sur sa fiche)." error={fieldError(state, "triggerProductIds")} emptyText="Aucun produit" />
          <MultiPicker name="triggerCollectionIds" label="Déclencheurs : collections" options={ctx.collections} value={triggerCols} onChange={setTriggerCols} max={20} emptyText="Aucune collection" />
          <MultiPicker name="offerProductIds" label="Produits proposés" options={ctx.products} value={offered} onChange={setOffered} max={10} hint="4 produits au plus sont affichés, dans cet ordre ; un produit déjà au panier ou indisponible est masqué." error={fieldError(state, "offerProductIds")} emptyText="Aucun produit" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="offer-discount" label="Remise liée (facultatif)" hint="Une remise « sur des produits » déjà créée." error={fieldError(state, "automaticDiscountId")}>
              {(p) => (
                <Select {...p} name="automaticDiscountId" value={discountId} onChange={(e) => setDiscountId(e.target.value)}>
                  <option value="">Aucune</option>
                  {ctx.discounts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="offer-position" label="Ordre d’affichage" hint="Les plus petits d’abord.">
              {(p) => <Input {...p} name="position" type="number" inputMode="numeric" min={0} max={1000} defaultValue={offer?.position ?? 0} />}
            </Field>
          </div>
          {discountId && (
            <div>
              <Checkbox
                id="offer-discount-requires"
                name="discountRequiresTrigger"
                checked={requiresTrigger}
                onChange={(e) => setRequiresTrigger(e.target.checked)}
                label="Appliquer la remise seulement si un produit déclencheur est au panier"
                description="Les collections déclencheuses ne comptent pas pour cette condition. Réglage enregistré sur la remise : il vaut pour toutes les offres qui l’utilisent."
              />
              {fieldError(state, "discountRequiresTrigger") && (
                <p role="alert" className="mt-1.5 text-[13px] font-medium text-danger">
                  {fieldError(state, "discountRequiresTrigger")}
                </p>
              )}
            </div>
          )}
          <div>
            <Switch name="active" checked={active} onChange={setActive} label="Offre active" />
            <Hint>Les ventes issues de l’offre sont mesurées à la commande (conversions et chiffre d’affaires).</Hint>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton>{offer ? "Enregistrer" : "Créer l’offre"}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function OfferRowActions({ ctx, offer }: { ctx: Ctx; offer: OfferDTO }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <AsyncSwitch checked={offer.active} label="Active" action={(v) => toggleCartOffer(ctx.storeId, offer.id, v)} />
      <OfferDialog ctx={ctx} offer={offer} trigger="icon" />
      <ConfirmActionButton
        title={`Supprimer « ${offer.title} » ?`}
        description={offer.conversions > 0 ? "Cette offre a déjà généré des ventes : la suppression sera refusée, désactivez-la plutôt." : "Cette action est définitive."}
        confirmLabel="Supprimer"
        action={() => deleteCartOffer(ctx.storeId, offer.id)}
        className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">Supprimer {offer.title}</span>
      </ConfirmActionButton>
    </div>
  );
}

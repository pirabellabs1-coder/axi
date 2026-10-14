"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Copy, X } from "lucide-react";
import { upsertAutomaticDiscount, toggleAutomaticDiscount, deleteAutomaticDiscount, duplicateAutomaticDiscount } from "@/lib/discounts/actions";
import { parseDiscountConfig, KIND_LABELS, type DiscountKind } from "@/lib/discounts/schema";
import { describeDiscount } from "@/lib/discounts/summary";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Hint, Checkbox } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { ActionButton, AsyncSwitch, ConfirmActionButton } from "@/components/app/action-controls";
import { MultiPicker } from "../_components/multi-picker";
import type { PromoPickOptions } from "../_components/pick-options";

export type DiscountDTO = {
  id: string;
  title: string;
  kind: DiscountKind;
  config: unknown;
  priority: number;
  combinesWithCoupons: boolean;
  combinesWithOtherAutomatic: boolean;
  /** AAAA-MM-JJ dans le fuseau de la boutique. */
  startsOn: string | null;
  endsOn: string | null;
  maxUses: number | null;
  active: boolean;
  applications: number;
};

type Ctx = { storeId: string; currency: string; timeZone: string; options: PromoPickOptions; allowedKinds: DiscountKind[] };

/* ───────────────────────── État du formulaire ───────────────────────── */

type TargetState = { mode: "all" | "products" | "collections"; productIds: string[]; collectionIds: string[] };
type ValueType = "PERCENT" | "FIXED_AMOUNT";
type Tier = { minSubtotal: string; type: ValueType | "FREE_DELIVERY"; amount: string };
type BundleItem = { productId: string; variantId: string; quantity: string };

type FormState = {
  // PRODUCT_AMOUNT
  target: TargetState;
  valueType: ValueType;
  amount: string;
  perUnit: boolean;
  minQuantity: string;
  excludeOnSale: boolean;
  // BUY_X_GET_Y
  buyMode: "quantity" | "amount";
  buyTarget: TargetState;
  buyQty: string;
  buyMin: string;
  sameTarget: boolean;
  getTarget: TargetState;
  getQty: string;
  getValue: "FREE" | ValueType;
  getAmount: string;
  maxApps: string;
  // CART_TIER
  tiers: Tier[];
  // BUNDLE
  items: BundleItem[];
  bundlePriceType: "FIXED_PRICE" | "PERCENT";
  bundleAmount: string;
  maxSets: string;
};

const ALL: TargetState = { mode: "all", productIds: [], collectionIds: [] };

function readTarget(t: unknown): TargetState {
  const o = (t && typeof t === "object" ? t : {}) as { productIds?: string[]; collectionIds?: string[] };
  if (o.productIds?.length) return { mode: "products", productIds: o.productIds, collectionIds: [] };
  if (o.collectionIds?.length) return { mode: "collections", productIds: [], collectionIds: o.collectionIds };
  return ALL;
}

function writeTarget(t: TargetState) {
  if (t.mode === "products") return { productIds: t.productIds };
  if (t.mode === "collections") return { collectionIds: t.collectionIds };
  return { all: true as const };
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/\s/g, "")));
const str = (n: unknown) => (typeof n === "number" ? String(n) : "");

function initialState(kind: DiscountKind, raw: unknown): FormState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (raw && typeof raw === "object" ? raw : {}) as any;
  const base: FormState = {
    target: ALL,
    valueType: "PERCENT",
    amount: "",
    perUnit: false,
    minQuantity: "",
    excludeOnSale: true,
    buyMode: "quantity",
    buyTarget: ALL,
    buyQty: "2",
    buyMin: "",
    sameTarget: true,
    getTarget: ALL,
    getQty: "1",
    getValue: "FREE",
    getAmount: "",
    maxApps: "1",
    tiers: [{ minSubtotal: "", type: "PERCENT", amount: "" }],
    items: [
      { productId: "", variantId: "", quantity: "1" },
      { productId: "", variantId: "", quantity: "1" },
    ],
    bundlePriceType: "FIXED_PRICE",
    bundleAmount: "",
    maxSets: "1",
  };
  if (kind === "PRODUCT_AMOUNT" && c.value) {
    Object.assign(base, { target: readTarget(c.target), valueType: c.value.type, amount: str(c.value.amount), perUnit: !!c.perUnit, minQuantity: str(c.minQuantity), excludeOnSale: c.excludeOnSale !== false });
  }
  if (kind === "BUY_X_GET_Y" && c.buy && c.get) {
    const free = c.get.value?.type === "PERCENT" && c.get.value?.amount === 100;
    Object.assign(base, {
      buyMode: "minAmount" in c.buy ? "amount" : "quantity",
      buyTarget: readTarget(c.buy.target),
      buyQty: str(c.buy.quantity) || "2",
      buyMin: str(c.buy.minAmount),
      sameTarget: JSON.stringify(c.buy.target) === JSON.stringify(c.get.target),
      getTarget: readTarget(c.get.target),
      getQty: str(c.get.quantity) || "1",
      getValue: free ? "FREE" : c.get.value?.type,
      getAmount: free ? "" : str(c.get.value?.amount),
      maxApps: str(c.maxApplicationsPerOrder) || "1",
      excludeOnSale: c.excludeOnSale !== false,
    });
  }
  if (kind === "CART_TIER" && Array.isArray(c.tiers)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    base.tiers = c.tiers.map((t: any) => ({ minSubtotal: str(t.minSubtotal), type: t.value?.type ?? "PERCENT", amount: str(t.value?.amount) }));
    base.target = readTarget(c.target);
  }
  if (kind === "BUNDLE" && Array.isArray(c.items)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    base.items = c.items.map((i: any) => ({ productId: i.productId ?? "", variantId: i.variantId ?? "", quantity: str(i.quantity) || "1" }));
    Object.assign(base, { bundlePriceType: c.price?.type ?? "FIXED_PRICE", bundleAmount: str(c.price?.amount), maxSets: str(c.maxSets) || "1", excludeOnSale: c.excludeOnSale !== false });
  }
  return base;
}

function buildConfig(kind: DiscountKind, f: FormState): unknown {
  switch (kind) {
    case "PRODUCT_AMOUNT":
      return {
        target: writeTarget(f.target),
        value: { type: f.valueType, amount: num(f.amount) },
        perUnit: f.valueType === "FIXED_AMOUNT" ? f.perUnit : false,
        ...(f.minQuantity.trim() ? { minQuantity: num(f.minQuantity) } : {}),
        excludeOnSale: f.excludeOnSale,
      };
    case "BUY_X_GET_Y": {
      const buyTarget = writeTarget(f.buyTarget);
      return {
        buy: f.buyMode === "quantity" ? { target: buyTarget, quantity: num(f.buyQty) } : { target: buyTarget, minAmount: num(f.buyMin) },
        get: {
          target: f.sameTarget ? buyTarget : writeTarget(f.getTarget),
          quantity: num(f.getQty),
          value: f.getValue === "FREE" ? { type: "PERCENT", amount: 100 } : { type: f.getValue, amount: num(f.getAmount) },
        },
        maxApplicationsPerOrder: num(f.maxApps),
        excludeOnSale: f.excludeOnSale,
      };
    }
    case "CART_TIER":
      return {
        tiers: f.tiers.map((t) => ({ minSubtotal: num(t.minSubtotal), value: t.type === "FREE_DELIVERY" ? { type: "FREE_DELIVERY" } : { type: t.type, amount: num(t.amount) } })),
        ...(f.target.mode !== "all" ? { target: writeTarget(f.target) } : {}),
      };
    case "BUNDLE":
      return {
        items: f.items.map((i) => ({ productId: i.productId, ...(i.variantId ? { variantId: i.variantId } : {}), quantity: num(i.quantity) })),
        price: { type: f.bundlePriceType, amount: num(f.bundleAmount) },
        maxSets: num(f.maxSets),
        excludeOnSale: f.excludeOnSale,
      };
  }
}

/* ───────────────────────── Sous-formulaires ───────────────────────── */

function TargetEditor({ id, label, value, onChange, options, allowAll = true }: { id: string; label: string; value: TargetState; onChange: (t: TargetState) => void; options: PromoPickOptions; allowAll?: boolean }) {
  return (
    <div className="space-y-3">
      <Field id={id} label={label}>
        {(p) => (
          <Select {...p} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as TargetState["mode"] })}>
            {allowAll && <option value="all">Tous les produits</option>}
            <option value="products">Certains produits</option>
            <option value="collections">Certaines collections</option>
          </Select>
        )}
      </Field>
      {value.mode === "products" && <MultiPicker label="Produits" options={options.products} value={value.productIds} onChange={(ids) => onChange({ ...value, productIds: ids })} max={200} emptyText="Aucun produit" />}
      {value.mode === "collections" && <MultiPicker label="Collections" options={options.collections} value={value.collectionIds} onChange={(ids) => onChange({ ...value, collectionIds: ids })} emptyText="Aucune collection" />}
    </div>
  );
}

function NumberField({ id, label, value, onChange, hint, suffix, min = 0 }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; suffix?: string; min?: number }) {
  return (
    <Field id={id} label={suffix ? `${label} (${suffix})` : label} hint={hint}>
      {(p) => <Input {...p} type="number" inputMode="numeric" min={min} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/* ───────────────────────── Dialogue ───────────────────────── */

export function DiscountDialog({ ctx, discount, trigger }: { ctx: Ctx; discount?: DiscountDTO; trigger?: "icon" }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(upsertAutomaticDiscount, undefined);
  const firstKind = discount?.kind ?? ctx.allowedKinds[0] ?? "PRODUCT_AMOUNT";
  const [kind, setKind] = useState<DiscountKind>(firstKind);
  const [title, setTitle] = useState(discount?.title ?? "");
  const [f, setF] = useState<FormState>(() => initialState(firstKind, discount?.config));
  const [active, setActive] = useState(discount?.active ?? true);
  const [withCoupons, setWithCoupons] = useState(discount?.combinesWithCoupons ?? true);
  const [withOthers, setWithOthers] = useState(discount?.combinesWithOtherAutomatic ?? true);
  const [startsOn, setStartsOn] = useState(discount?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(discount?.endsOn ?? "");
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));

  // Ferme la fenêtre au succès (comparaison pendant le rendu, sans effet).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setOpen(false);
  }

  const config = useMemo(() => buildConfig(kind, f), [kind, f]);
  const parsed = useMemo(() => parseDiscountConfig(kind, config), [kind, config]);
  const names = useMemo(() => {
    const p = new Map(ctx.options.products.map((o) => [o.id, o.label]));
    const c = new Map(ctx.options.collections.map((o) => [o.id, o.label]));
    return { currency: ctx.currency, timeZone: ctx.timeZone, productName: (id: string) => p.get(id), collectionName: (id: string) => c.get(id) };
  }, [ctx]);
  const summary = parsed.ok ? describeDiscount(parsed.value, names, { startsAt: startsOn ? `${startsOn}T12:00:00Z` : null, endsAt: endsOn ? `${endsOn}T12:00:00Z` : null }) : null;
  const locked = !ctx.allowedKinds.includes(kind);
  const cur = ctx.currency;

  return (
    <>
      {trigger === "icon" ? (
        <Button variant="ghost" size="icon" aria-label={`Modifier ${discount?.title}`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button variant="accent" onClick={() => setOpen(true)} disabled={ctx.allowedKinds.length === 0}>
          <Plus className="size-4" aria-hidden /> Nouvelle remise
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={discount ? `Modifier « ${discount.title} »` : "Nouvelle remise automatique"} description="Appliquée sans code, au panier et au paiement, quand les conditions sont réunies." sheet>
        <form action={action} noValidate className="space-y-5" key={open ? "open" : "closed"}>
          <FormMessage state={state} />
          <input type="hidden" name="storeId" value={ctx.storeId} />
          {discount && <input type="hidden" name="id" value={discount.id} />}
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="config" value={JSON.stringify(config ?? {})} />

          <Field id="title" label="Titre affiché au client" required error={fieldError(state, "title")} hint="Par exemple « 2 accessoires achetés = 1 offert ».">
            {(p) => <Input {...p} name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />}
          </Field>

          <Field id="kind" label="Type de remise" hint={discount && discount.applications > 0 ? "Remise déjà appliquée : son type ne peut plus changer." : undefined}>
            {(p) => (
              <Select
                {...p}
                value={kind}
                disabled={!!discount && discount.applications > 0}
                onChange={(e) => {
                  const k = e.target.value as DiscountKind;
                  setKind(k);
                  setF(initialState(k, null));
                }}
              >
                {(["PRODUCT_AMOUNT", "CART_TIER", "BUY_X_GET_Y", "BUNDLE"] as const).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                    {ctx.allowedKinds.includes(k) ? "" : " (plan supérieur)"}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {locked && <Alert tone="warning" title="Type non inclus dans votre plan">Les lots et « X achetés = Y offerts » sont inclus à partir du plan Business. Vous pouvez préparer la remise, mais elle ne pourra pas être enregistrée.</Alert>}

          {kind === "PRODUCT_AMOUNT" && (
            <fieldset className="space-y-4">
              <legend className="sr-only">Remise sur des produits</legend>
              <TargetEditor id="pa-target" label="Produits concernés" value={f.target} onChange={(t) => set({ target: t })} options={ctx.options} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="pa-type" label="Remise">
                  {(p) => (
                    <Select {...p} value={f.valueType} onChange={(e) => set({ valueType: e.target.value as ValueType })}>
                      <option value="PERCENT">Pourcentage</option>
                      <option value="FIXED_AMOUNT">Montant fixe</option>
                    </Select>
                  )}
                </Field>
                <NumberField id="pa-amount" label="Valeur" suffix={f.valueType === "PERCENT" ? "%" : cur} value={f.amount} onChange={(v) => set({ amount: v })} />
              </div>
              {f.valueType === "FIXED_AMOUNT" && <Checkbox label="Par article" description="Sinon, le montant est déduit une fois sur l'ensemble des articles concernés." checked={f.perUnit} onChange={(e) => set({ perUnit: e.target.checked })} />}
              <NumberField id="pa-min" label="Quantité minimale" hint="Vide = dès 1 article." value={f.minQuantity} onChange={(v) => set({ minQuantity: v })} min={1} />
            </fieldset>
          )}

          {kind === "BUY_X_GET_Y" && (
            <fieldset className="space-y-4">
              <legend className="sr-only">X achetés = Y offerts</legend>
              <Field id="bx-mode" label="Condition d'achat">
                {(p) => (
                  <Select {...p} value={f.buyMode} onChange={(e) => set({ buyMode: e.target.value as FormState["buyMode"] })}>
                    <option value="quantity">Nombre d'articles achetés</option>
                    <option value="amount">Montant acheté</option>
                  </Select>
                )}
              </Field>
              <TargetEditor id="bx-buy" label="Articles achetés" value={f.buyTarget} onChange={(t) => set({ buyTarget: t })} options={ctx.options} />
              {f.buyMode === "quantity" ? <NumberField id="bx-qty" label="Articles à acheter" value={f.buyQty} onChange={(v) => set({ buyQty: v })} min={1} /> : <NumberField id="bx-minamount" label="Montant minimum" suffix={cur} value={f.buyMin} onChange={(v) => set({ buyMin: v })} />}
              <Checkbox label="Articles offerts parmi les mêmes produits" description="Il faut alors que le panier contienne les articles achetés plus les articles offerts." checked={f.sameTarget} onChange={(e) => set({ sameTarget: e.target.checked })} />
              {!f.sameTarget && <TargetEditor id="bx-get" label="Articles offerts parmi" value={f.getTarget} onChange={(t) => set({ getTarget: t })} options={ctx.options} />}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NumberField id="bx-getqty" label="Articles offerts ou remisés" value={f.getQty} onChange={(v) => set({ getQty: v })} min={1} hint="Les moins chers sont choisis." />
                <Field id="bx-getvalue" label="Avantage">
                  {(p) => (
                    <Select {...p} value={f.getValue} onChange={(e) => set({ getValue: e.target.value as FormState["getValue"] })}>
                      <option value="FREE">Offert</option>
                      <option value="PERCENT">Pourcentage</option>
                      <option value="FIXED_AMOUNT">Montant fixe</option>
                    </Select>
                  )}
                </Field>
              </div>
              {f.getValue !== "FREE" && <NumberField id="bx-getamount" label="Valeur" suffix={f.getValue === "PERCENT" ? "%" : cur} value={f.getAmount} onChange={(v) => set({ getAmount: v })} />}
              <NumberField id="bx-max" label="Applications maximum par commande" hint="De 1 à 20." value={f.maxApps} onChange={(v) => set({ maxApps: v })} min={1} />
            </fieldset>
          )}

          {kind === "CART_TIER" && (
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-ink">Paliers (5 maximum, seuils croissants)</legend>
              <ul className="space-y-3">
                {f.tiers.map((t, i) => (
                  <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                    <NumberField id={`tier-${i}-min`} label="Dès" suffix={cur} value={t.minSubtotal} onChange={(v) => set({ tiers: f.tiers.map((x, j) => (j === i ? { ...x, minSubtotal: v } : x)) })} />
                    <Field id={`tier-${i}-type`} label="Avantage">
                      {(p) => (
                        <Select {...p} value={t.type} onChange={(e) => set({ tiers: f.tiers.map((x, j) => (j === i ? { ...x, type: e.target.value as Tier["type"] } : x)) })}>
                          <option value="PERCENT">Pourcentage</option>
                          <option value="FIXED_AMOUNT">Montant fixe</option>
                          <option value="FREE_DELIVERY">Livraison offerte</option>
                        </Select>
                      )}
                    </Field>
                    {t.type !== "FREE_DELIVERY" ? (
                      <NumberField id={`tier-${i}-amount`} label="Valeur" suffix={t.type === "PERCENT" ? "%" : cur} value={t.amount} onChange={(v) => set({ tiers: f.tiers.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} />
                    ) : (
                      <span className="hidden sm:block" />
                    )}
                    <Button variant="ghost" size="icon" aria-label={`Retirer le palier ${i + 1}`} disabled={f.tiers.length <= 1} onClick={() => set({ tiers: f.tiers.filter((_, j) => j !== i) })}>
                      <X className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
              {f.tiers.length < 5 && (
                <Button variant="outline" size="sm" onClick={() => set({ tiers: [...f.tiers, { minSubtotal: "", type: "PERCENT", amount: "" }] })}>
                  <Plus className="size-4" aria-hidden /> Ajouter un palier
                </Button>
              )}
              <TargetEditor id="tier-target" label="Montant calculé sur" value={f.target} onChange={(t) => set({ target: t })} options={ctx.options} />
              <Hint>Calculé sur le panier après les remises sur les produits, hors cartes cadeaux. Seul le meilleur palier atteint s'applique.</Hint>
            </fieldset>
          )}

          {kind === "BUNDLE" && (
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-ink">Produits du lot (2 à 6)</legend>
              <ul className="space-y-3">
                {f.items.map((it, i) => {
                  const variants = ctx.options.variants[it.productId] ?? [];
                  const patch = (p: Partial<BundleItem>) => set({ items: f.items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  return (
                    <li key={i} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-md)] border border-line p-3 sm:grid-cols-[2fr_1.5fr_1fr_auto]">
                      <Field id={`b-${i}-p`} label="Produit">
                        {(p) => (
                          <Select {...p} value={it.productId} onChange={(e) => patch({ productId: e.target.value, variantId: "" })}>
                            <option value="">Choisir…</option>
                            {ctx.options.products.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field id={`b-${i}-v`} label="Variante">
                        {(p) => (
                          <Select {...p} value={it.variantId} disabled={variants.length === 0} onChange={(e) => patch({ variantId: e.target.value })}>
                            <option value="">{variants.length ? "Toutes" : "Sans variante"}</option>
                            {variants.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.label}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <NumberField id={`b-${i}-q`} label="Quantité" value={it.quantity} onChange={(v) => patch({ quantity: v })} min={1} />
                      <Button variant="ghost" size="icon" aria-label={`Retirer le produit ${i + 1} du lot`} disabled={f.items.length <= 2} onClick={() => set({ items: f.items.filter((_, j) => j !== i) })}>
                        <X className="size-4" aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {f.items.length < 6 && (
                <Button variant="outline" size="sm" onClick={() => set({ items: [...f.items, { productId: "", variantId: "", quantity: "1" }] })}>
                  <Plus className="size-4" aria-hidden /> Ajouter un produit
                </Button>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field id="b-price" label="Prix du lot">
                  {(p) => (
                    <Select {...p} value={f.bundlePriceType} onChange={(e) => set({ bundlePriceType: e.target.value as FormState["bundlePriceType"] })}>
                      <option value="FIXED_PRICE">Prix fixe</option>
                      <option value="PERCENT">Remise en %</option>
                    </Select>
                  )}
                </Field>
                <NumberField id="b-amount" label="Valeur" suffix={f.bundlePriceType === "PERCENT" ? "%" : cur} value={f.bundleAmount} onChange={(v) => set({ bundleAmount: v })} />
                <NumberField id="b-sets" label="Lots max. par commande" value={f.maxSets} onChange={(v) => set({ maxSets: v })} min={1} />
              </div>
            </fieldset>
          )}

          {kind !== "CART_TIER" && <Checkbox label="Exclure les articles déjà en promotion" description="Recommandé : évite de cumuler cette remise avec un prix promotionnel daté." checked={f.excludeOnSale} onChange={(e) => set({ excludeOnSale: e.target.checked })} />}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="startsOn" label="Début" hint="Jour entier, fuseau de la boutique." error={fieldError(state, "startsOn")}>
              {(p) => <Input {...p} name="startsOn" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
            </Field>
            <Field id="endsOn" label="Fin (incluse)" error={fieldError(state, "endsOn")}>
              {(p) => <Input {...p} name="endsOn" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="maxUses" label="Commandes maximum" hint="Vide = illimité." error={fieldError(state, "maxUses")}>
              {(p) => <Input {...p} name="maxUses" type="number" inputMode="numeric" min={1} defaultValue={discount?.maxUses ?? ""} />}
            </Field>
            <Field id="priority" label="Priorité" hint="La plus haute s'applique d'abord (−100 à 100)." error={fieldError(state, "priority")}>
              {(p) => <Input {...p} name="priority" type="number" inputMode="numeric" min={-100} max={100} defaultValue={discount?.priority ?? 0} />}
            </Field>
          </div>
          <div className="space-y-3">
            <div>
              <Switch name="combinesWithCoupons" checked={withCoupons} onChange={setWithCoupons} label="Cumulable avec les codes promo" />
              <Hint>Sinon, le client obtient la meilleure des deux offres.</Hint>
            </div>
            <Switch name="combinesWithOtherAutomatic" checked={withOthers} onChange={setWithOthers} label="Cumulable avec les autres remises automatiques" />
            <Switch name="active" checked={active} onChange={setActive} label="Remise active" />
          </div>

          <div aria-live="polite" className="rounded-[var(--radius-md)] border border-line bg-surface-2 px-4 py-3 text-sm">
            {summary ? (
              <p className="text-ink">
                <span className="font-semibold">Résumé : </span>
                {summary}
              </p>
            ) : (
              <p className="text-ink-muted">À compléter : {!parsed.ok ? parsed.error : ""}</p>
            )}
          </div>
          {fieldError(state, "config") && <Alert tone="danger">{fieldError(state, "config")}</Alert>}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton disabled={locked}>{discount ? "Enregistrer" : "Créer la remise"}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function DiscountRowActions({ ctx, discount }: { ctx: Ctx; discount: DiscountDTO }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <AsyncSwitch checked={discount.active} label="Active" action={(v) => toggleAutomaticDiscount(ctx.storeId, discount.id, v)} />
      <DiscountDialog ctx={ctx} discount={discount} trigger="icon" />
      <ActionButton variant="ghost" size="icon" aria-label={`Dupliquer ${discount.title}`} action={() => duplicateAutomaticDiscount(ctx.storeId, discount.id)}>
        <Copy className="size-4" aria-hidden />
      </ActionButton>
      <ConfirmActionButton
        title={`Supprimer « ${discount.title} » ?`}
        description={discount.applications > 0 ? "Cette remise a déjà été appliquée : la suppression sera refusée, désactivez-la plutôt." : "Cette action est définitive."}
        confirmLabel="Supprimer"
        action={() => deleteAutomaticDiscount(ctx.storeId, discount.id)}
        className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">Supprimer {discount.title}</span>
      </ConfirmActionButton>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Power, Trash2 } from "lucide-react";
import { saveCoupon, toggleCoupon, deleteCoupon, type CouponInput } from "@/lib/admin/pricing-actions";
import { currencyDecimals, parseMoneyInput } from "@/lib/money";
import { Dialog, ConfirmButton } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";

export type CouponDTO = {
  id: string;
  code: string;
  description: string | null;
  percentOff: number | null;
  amountOff: number | null;
  zone: string | null;
  plans: string[];
  durationMonths: number;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: string | null;
  active: boolean;
};

const PLAN_CHOICES = [
  { id: "STARTER", name: "Starter" },
  { id: "BUSINESS", name: "Business" },
  { id: "SCALE", name: "Scale" },
  { id: "ENTERPRISE", name: "Enterprise" },
] as const;

type FormState = { code: string; description: string; kind: "percent" | "amount"; value: string; zone: "" | "WORLD" | "AFRICA"; plans: string[]; durationMonths: string; maxRedemptions: string; expiresAt: string };

function initial(c?: CouponDTO): FormState {
  if (!c) return { code: "", description: "", kind: "percent", value: "20", zone: "", plans: [], durationMonths: "1", maxRedemptions: "", expiresAt: "" };
  const currency = c.zone === "AFRICA" ? "XOF" : "EUR";
  return {
    code: c.code,
    description: c.description ?? "",
    kind: c.percentOff ? "percent" : "amount",
    value: c.percentOff ? String(c.percentOff) : c.amountOff != null ? (currencyDecimals(currency) ? (c.amountOff / 100).toFixed(2).replace(".", ",") : String(c.amountOff)) : "",
    zone: (c.zone as FormState["zone"]) ?? "",
    plans: c.plans,
    durationMonths: String(c.durationMonths),
    maxRedemptions: c.maxRedemptions != null ? String(c.maxRedemptions) : "",
    expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : "",
  };
}

/** Création / modification d'un code promo SaaS (dialogue). */
export function CouponDialogButton({ coupon, canEdit }: { coupon?: CouponDTO; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FormState>(() => initial(coupon));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const err = (k: string) => errors[k]?.[0];

  const submit = () =>
    start(async () => {
      let value: number | null = null;
      if (f.kind === "percent") value = Number(f.value);
      else {
        if (!f.zone) {
          setErrors({ zone: ["Une remise en montant exige une zone (devise)"] });
          return;
        }
        value = parseMoneyInput(f.value, f.zone === "AFRICA" ? "XOF" : "EUR");
      }
      if (value == null || !Number.isFinite(value)) {
        setErrors({ value: ["Valeur invalide"] });
        return;
      }
      const input: CouponInput = {
        code: f.code,
        description: f.description || undefined,
        kind: f.kind,
        value,
        zone: f.zone,
        plans: f.plans as CouponInput["plans"],
        durationMonths: Number(f.durationMonths),
        maxRedemptions: f.maxRedemptions === "" ? null : Number(f.maxRedemptions),
        expiresAt: f.expiresAt ? `${f.expiresAt}T23:59:59Z` : null,
      };
      const r = await saveCoupon(coupon?.id ?? null, input);
      if (r.ok) {
        toast.success(r.message ?? "Enregistré");
        setOpen(false);
        setErrors({});
        setError(null);
        if (!coupon) setF(initial());
      } else {
        setError(r.error);
        setErrors(r.fieldErrors ?? {});
      }
    });

  const currencyLabel = f.zone === "AFRICA" ? "FCFA" : f.zone === "WORLD" ? "€" : "";

  return (
    <>
      {coupon ? (
        <button type="button" onClick={() => { setF(initial(coupon)); setOpen(true); }} className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:size-9" aria-label={`Modifier le code ${coupon.code}`}>
          <Pencil className="size-4" aria-hidden />
        </button>
      ) : (
        <Button onClick={() => setOpen(true)} size="sm">
          <Plus className="size-4" aria-hidden /> Nouveau code
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={coupon ? `Modifier ${coupon.code}` : "Nouveau code promo"}
        description="Remise appliquée aux factures de plan (souscription, montée en gamme, puis renouvellements selon la durée). Un code ne sert qu'une fois par boutique."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
            <Button onClick={submit} loading={pending}>{coupon ? "Enregistrer" : "Créer le code"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && Object.keys(errors).length === 0 && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="c-code" label="Code" required error={err("code")} hint="Lettres, chiffres, - ou _">
              {(p) => <Input {...p} value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s+/g, ""))} maxLength={32} autoCapitalize="characters" autoComplete="off" spellCheck={false} className="font-mono uppercase" placeholder="LANCEMENT20" />}
            </Field>
            <Field id="c-zone" label="Zone" error={err("zone")}>
              {(p) => (
                <Select {...p} value={f.zone} onChange={(e) => set("zone", e.target.value as FormState["zone"])}>
                  <option value="">Toutes les zones</option>
                  <option value="WORLD">Monde (EUR)</option>
                  <option value="AFRICA">Afrique (FCFA)</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="c-kind" label="Type de remise">
              {(p) => (
                <Select {...p} value={f.kind} onChange={(e) => set("kind", e.target.value as FormState["kind"])}>
                  <option value="percent">Pourcentage</option>
                  <option value="amount">Montant fixe</option>
                </Select>
              )}
            </Field>
            <Field id="c-value" label={f.kind === "percent" ? "Remise (%)" : `Montant${currencyLabel ? ` (${currencyLabel})` : ""}`} required error={err("value")}>
              {(p) => <Input {...p} value={f.value} onChange={(e) => set("value", e.target.value)} inputMode="decimal" className="tabular" />}
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Plans concernés</legend>
            <p className="mb-2 text-[13px] text-ink-muted">Aucun coché : tous les plans payants.</p>
            <div className="grid grid-cols-2 gap-2">
              {PLAN_CHOICES.map((pl) => (
                <Checkbox
                  key={pl.id}
                  label={pl.name}
                  checked={f.plans.includes(pl.id)}
                  onChange={(e) => set("plans", e.target.checked ? [...f.plans, pl.id] : f.plans.filter((x) => x !== pl.id))}
                  className="min-h-11 items-center rounded-[12px] px-3 ring-1 ring-line"
                />
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field id="c-duration" label="Durée (factures)" required error={err("durationMonths")} hint="1 = première facture">
              {(p) => <Input {...p} type="number" min={1} max={36} value={f.durationMonths} onChange={(e) => set("durationMonths", e.target.value)} className="tabular" />}
            </Field>
            <Field id="c-max" label="Limite d'usages" error={err("maxRedemptions")} hint="Vide = illimité">
              {(p) => <Input {...p} type="number" min={1} value={f.maxRedemptions} onChange={(e) => set("maxRedemptions", e.target.value)} className="tabular" />}
            </Field>
            <Field id="c-exp" label="Expire le" error={err("expiresAt")} hint="Vide = sans fin">
              {(p) => <Input {...p} type="date" value={f.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />}
            </Field>
          </div>
          <Field id="c-desc" label="Description interne" error={err("description")}>
            {(p) => <Textarea {...p} value={f.description} maxLength={200} onChange={(e) => set("description", e.target.value)} className="min-h-20" placeholder="Ex. : lancement Cotonou, partenaires incubateur" />}
          </Field>
        </div>
      </Dialog>
    </>
  );
}

export function CouponRowActions({ coupon, canEdit }: { coupon: CouponDTO; canEdit: boolean }) {
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  const run = (fn: () => ReturnType<typeof toggleCoupon>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Fait");
      else toast.error(r.error);
    });
  return (
    <div className="flex items-center justify-end gap-0.5">
      <CouponDialogButton coupon={coupon} canEdit={canEdit} />
      <button type="button" disabled={pending} onClick={() => run(() => toggleCoupon(coupon.id))} className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50 sm:size-9" aria-label={coupon.active ? `Désactiver ${coupon.code}` : `Réactiver ${coupon.code}`} title={coupon.active ? "Désactiver" : "Réactiver"}>
        <Power className="size-4" aria-hidden />
      </button>
      {coupon.redemptions === 0 && (
        <ConfirmButton
          title={`Supprimer ${coupon.code} ?`}
          description="Le code n'a jamais été utilisé : il sera supprimé définitivement."
          confirmLabel="Supprimer"
          onConfirm={async () => {
            const r = await deleteCoupon(coupon.id);
            if (r.ok) toast.success(r.message ?? "Supprimé");
            else toast.error(r.error);
          }}
          className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger sm:size-9"
        >
          <Trash2 className="size-4" aria-hidden />
          <span className="sr-only">Supprimer {coupon.code}</span>
        </ConfirmButton>
      )}
    </div>
  );
}

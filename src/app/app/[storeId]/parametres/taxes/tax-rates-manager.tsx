"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { upsertTaxRate, deleteTaxRate, applyTaxPreset } from "@/lib/tax/actions";
import { formatRateBps } from "@/lib/tax/compute";
import { TAX_CATEGORY_LABELS } from "@/config/taxes";
import { Field, Input, Select, Checkbox } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/misc";
import { Table, THead, TH, TBody, TR, TD } from "@/components/ui/table";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { toast } from "@/components/ui/toast";

export type RateRow = { id: string; name: string; country: string; taxCategory: string; rateBps: number; appliesToShipping: boolean; active: boolean };

export function TaxRatesManager({ storeId, storeCountry, rates, preset, locked }: { storeId: string; storeCountry: string; rates: RateRow[]; preset: { label: string } | null; locked: boolean }) {
  const [editing, setEditing] = useState<RateRow | "new" | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message ?? "Enregistré");
        router.refresh();
      } else toast.error(r.error ?? "Une erreur est survenue");
    });

  return (
    <div className="space-y-5">
      {rates.length === 0 ? (
        <EmptyState compact title="Aucun taux" description="Ajoutez le taux de votre pays pour calculer la TVA de vos ventes." />
      ) : (
        <Table minWidth={560}>
          <THead>
            <TR>
              <TH>Taux</TH>
              <TH>Pays</TH>
              <TH>Catégorie</TH>
              <TH>Livraison</TH>
              <TH align="right">
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rates.map((r) => (
              <TR key={r.id}>
                <TD>
                  <span className="font-medium">{r.name}</span> <span className="font-mono tabular">{formatRateBps(r.rateBps)}</span>
                  {!r.active && (
                    <Badge tone="neutral" className="ml-2">
                      Inactif
                    </Badge>
                  )}
                </TD>
                <TD>{r.country}</TD>
                <TD>{TAX_CATEGORY_LABELS[r.taxCategory] ?? r.taxCategory}</TD>
                <TD>{r.appliesToShipping ? "Taxée" : "Non taxée"}</TD>
                <TD align="right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Modifier ${r.name} ${r.country}`} onClick={() => setEditing(r)} disabled={locked}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <ConfirmButton
                      title="Supprimer ce taux ?"
                      description="Les commandes et factures déjà émises ne changent pas."
                      confirmLabel="Supprimer"
                      onConfirm={() => run(() => deleteTaxRate(storeId, r.id))}
                      className="inline-flex size-11 items-center justify-center rounded-full text-danger hover:bg-danger-soft"
                    >
                      <Trash2 className="size-4" aria-hidden />
                      <span className="sr-only">Supprimer {r.name} {r.country}</span>
                    </ConfirmButton>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {!locked && (
        <div className="flex flex-wrap gap-2">
          {preset && (
            <Button variant="outline" className="h-11" disabled={pending} onClick={() => run(() => applyTaxPreset(storeId))}>
              <Sparkles className="size-4" aria-hidden /> Ajouter {preset.label}
            </Button>
          )}
          <Button variant="secondary" className="h-11" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> Nouveau taux
          </Button>
        </div>
      )}

      {editing && !locked && <RateForm key={editing === "new" ? "new" : editing.id} storeId={storeId} storeCountry={storeCountry} rate={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
    </div>
  );
}

function RateForm({ storeId, storeCountry, rate, onDone }: { storeId: string; storeCountry: string; rate: RateRow | null; onDone: () => void }) {
  const [state, action] = useActionState(upsertTaxRate, undefined);
  const [category, setCategory] = useState(rate?.taxCategory ?? "standard");
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onDone();
    }
  }, [state, router, onDone]);

  return (
    <form action={action} className="space-y-4 rounded-[var(--radius-md)] bg-surface-2/50 p-4 ring-1 ring-inset ring-line">
      <h3 className="text-sm font-semibold text-ink">{rate ? "Modifier le taux" : "Nouveau taux"}</h3>
      <input type="hidden" name="storeId" value={storeId} />
      {rate && <input type="hidden" name="rateId" value={rate.id} />}
      <FormMessage state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Field id="rate-name" label="Nom" required error={fieldError(state, "name")}>
          {(p) => <Input {...p} name="name" defaultValue={rate?.name ?? "TVA"} maxLength={40} />}
        </Field>
        <Field id="rate-country" label="Pays" hint="Code à 2 lettres" required error={fieldError(state, "country")}>
          {(p) => <Input {...p} name="country" defaultValue={rate?.country ?? storeCountry} maxLength={2} autoCapitalize="characters" className="uppercase" />}
        </Field>
        <Field id="rate-category" label="Catégorie" error={fieldError(state, "taxCategory")}>
          {(p) => (
            <Select {...p} name="taxCategory" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(TAX_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="rate-value" label="Taux (%)" hint="Ex. 18 ou 19,25" required={category !== "exempt"} error={fieldError(state, "rate")}>
          {(p) => <Input {...p} name="rate" inputMode="decimal" defaultValue={rate ? String(rate.rateBps / 100).replace(".", ",") : "18"} disabled={category === "exempt"} />}
        </Field>
      </div>
      {category === "exempt" && <input type="hidden" name="rate" value="0" />}
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Checkbox name="appliesToShipping" defaultChecked={rate?.appliesToShipping ?? true} label="Taxer aussi la livraison" description="Appliqué avec le taux normal." />
        <Checkbox name="active" defaultChecked={rate?.active ?? true} label="Actif" />
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="h-11">Enregistrer le taux</SubmitButton>
        <Button type="button" variant="ghost" className="h-11" onClick={onDone}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

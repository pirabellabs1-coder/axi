"use client";

import { Plus, Trash2, X, ChevronUp, ChevronDown, ListPlus } from "lucide-react";
import type { DetailInput, OptionGroupInput } from "@/lib/products/schemas";
import { Field, Input, Textarea, Checkbox } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MoneyCell } from "./variants-editor";

const iconBtn =
  "inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-[background-color,color,transform] hover:bg-surface-2 hover:text-ink active:scale-[0.96] disabled:opacity-30 disabled:hover:bg-transparent sm:size-9";

export type GroupRow = OptionGroupInput & { key: string };

/** Suppléments (OptionGroup) : choix payants ou non, obligatoires ou non. */
export function SupplementsEditor({ groups, onChange, currency, error }: { groups: GroupRow[]; onChange: (g: GroupRow[]) => void; currency: string; error?: string }) {
  const set = (gi: number, p: Partial<GroupRow>) => onChange(groups.map((x, j) => (j === gi ? { ...x, ...p } : x)));
  return (
    <div className="space-y-4">
      {groups.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <ListPlus className="size-4 text-ink-faint" aria-hidden /> Aucun supplément. Ex. : sauce au choix, emballage cadeau, broderie du prénom.
        </p>
      )}
      {groups.map((g, gi) => (
        <fieldset key={g.key} className="rounded-[var(--radius-md)] bg-surface-2/40 p-4 ring-1 ring-inset ring-line">
          <legend className="sr-only">Groupe de suppléments {gi + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_80px_80px_auto] sm:items-end">
            <Field id={`g-name-${gi}`} label="Nom du groupe">
              {(p) => <Input {...p} value={g.name} onChange={(e) => set(gi, { name: e.target.value })} maxLength={60} placeholder="Emballage" className="h-11" />}
            </Field>
            <div className="pb-3">
              <Checkbox label="Obligatoire" checked={g.required} onChange={(e) => set(gi, { required: e.target.checked, minSelect: e.target.checked ? Math.max(1, g.minSelect) : g.minSelect })} />
            </div>
            <Field id={`g-min-${gi}`} label="Min">
              {(p) => <Input {...p} type="number" inputMode="numeric" min={0} max={20} value={g.minSelect} onChange={(e) => set(gi, { minSelect: Math.max(0, Number(e.target.value) || 0) })} className="h-11" />}
            </Field>
            <Field id={`g-max-${gi}`} label="Max">
              {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={20} value={g.maxSelect} onChange={(e) => set(gi, { maxSelect: Math.max(1, Number(e.target.value) || 1) })} className="h-11" />}
            </Field>
            <button type="button" onClick={() => onChange(groups.filter((_, j) => j !== gi))} className={cn(iconBtn, "mb-0.5 hover:bg-danger-soft hover:text-danger")} aria-label={`Supprimer le groupe ${g.name || gi + 1}`}>
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {g.options.map((o, oi) => (
              <li key={oi} className="grid grid-cols-[1fr_120px_auto] items-center gap-2 sm:grid-cols-[1fr_160px_auto]">
                <Input aria-label="Nom du choix" value={o.name} onChange={(e) => set(gi, { options: g.options.map((y, k) => (k === oi ? { ...y, name: e.target.value } : y)) })} placeholder="Papier cadeau" maxLength={60} className="h-11 px-3 text-sm" />
                <MoneyCell
                  label="Supplément de prix"
                  allowNegative
                  value={o.priceDelta === 0 ? null : o.priceDelta}
                  currency={currency}
                  onChange={(v) => set(gi, { options: g.options.map((y, k) => (k === oi ? { ...y, priceDelta: v ?? 0 } : y)) })}
                  placeholder={`+ 0 ${currency}`}
                  className="h-11 px-3 text-sm"
                />
                <button type="button" onClick={() => set(gi, { options: g.options.filter((_, k) => k !== oi) })} className={cn(iconBtn, "hover:bg-danger-soft hover:text-danger")} aria-label={`Supprimer le choix ${o.name || oi + 1}`}>
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => set(gi, { options: [...g.options, { name: "", priceDelta: 0 }] })} disabled={g.options.length >= 30}>
            <Plus className="size-4" aria-hidden /> Ajouter un choix
          </Button>
        </fieldset>
      ))}
      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...groups, { key: `g${Date.now()}`, name: "", required: false, minSelect: 0, maxSelect: 1, options: [{ name: "", priceDelta: 0 }] }])} disabled={groups.length >= 10}>
        <Plus className="size-4" aria-hidden /> Ajouter un groupe de suppléments
      </Button>
    </div>
  );
}

const DETAIL_PRESETS = ["Composition", "Guide des tailles", "Entretien", "Livraison et retours"];

/** Onglets repliables de la fiche (`Product.details`). */
export function DetailsEditor({ details, onChange, error }: { details: DetailInput[]; onChange: (d: DetailInput[]) => void; error?: string }) {
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= details.length) return;
    const n = [...details];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  const add = (title = "") => onChange([...details, { title, body: "" }]);
  return (
    <div className="space-y-3">
      {details.map((d, i) => (
        <details key={i} open={!d.body} className="group rounded-[var(--radius-md)] bg-surface ring-1 ring-inset ring-line">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 [&::-webkit-details-marker]:hidden">
            <span className="truncate text-sm font-medium text-ink">{d.title || `Onglet ${i + 1}`}</span>
            <ChevronDown className="size-4 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-3 border-t border-line px-4 py-3">
            <Field id={`d-title-${i}`} label="Titre de l'onglet">
              {(p) => <Input {...p} value={d.title} onChange={(e) => onChange(details.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} maxLength={60} className="h-11" />}
            </Field>
            <Field id={`d-body-${i}`} label="Contenu" hint="Texte simple ; les retours à la ligne sont conservés.">
              {(p) => <Textarea {...p} value={d.body} onChange={(e) => onChange(details.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} rows={4} maxLength={5000} />}
            </Field>
            <div className="flex justify-end gap-1">
              <button type="button" className={iconBtn} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Monter l'onglet ${d.title}`}>
                <ChevronUp className="size-4" aria-hidden />
              </button>
              <button type="button" className={iconBtn} onClick={() => move(i, 1)} disabled={i === details.length - 1} aria-label={`Descendre l'onglet ${d.title}`}>
                <ChevronDown className="size-4" aria-hidden />
              </button>
              <button type="button" className={cn(iconBtn, "hover:bg-danger-soft hover:text-danger")} onClick={() => onChange(details.filter((_, j) => j !== i))} aria-label={`Supprimer l'onglet ${d.title}`}>
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </details>
      ))}
      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      {details.length < 10 && (
        <div className="flex flex-wrap gap-2">
          {DETAIL_PRESETS.filter((t) => !details.some((d) => d.title === t)).map((t) => (
            <Button key={t} type="button" variant="outline" size="sm" onClick={() => add(t)}>
              <Plus className="size-4" aria-hidden /> {t}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => add()}>
            <Plus className="size-4" aria-hidden /> Onglet libre
          </Button>
        </div>
      )}
    </div>
  );
}

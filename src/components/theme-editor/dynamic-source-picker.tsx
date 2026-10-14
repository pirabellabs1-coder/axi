"use client";

import * as React from "react";
import { Check, Database, Link2Off, Search, Unplug } from "lucide-react";
import { isDynamicSource, type SettingField, type TemplateId } from "@/lib/theme-engine/types";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { checkBinding, compatibleSources, isDynamicFieldType, parseSource, type MetafieldDefinitionLike, type SourceOption } from "@/lib/theme-engine/dynamic-sources";

export type DynamicContext = {
  template: TemplateId;
  metafields: MetafieldDefinitionLike[];
  samples: Record<string, string>;
  sampleProductName: string | null;
};

/**
 * Enveloppe d'un réglage compatible avec les sources dynamiques (lot 4 §5) :
 *  - valeur fixe : le champ habituel + bouton « Connecter une donnée » ;
 *  - valeur `{ $source }` : carte de la source, valeur d'exemple, « Changer » et « Déconnecter ».
 */
export function DynamicSourceControl({
  id,
  field,
  value,
  ctx,
  onChange,
  onUnbind,
  children,
}: {
  id: string;
  field: SettingField;
  value: unknown;
  ctx: DynamicContext | undefined;
  onChange: (v: { $source: string }) => void;
  onUnbind: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  if (!ctx || !("id" in field) || !isDynamicFieldType(field.type)) return <>{children}</>;
  const options = compatibleSources(field.type, ctx.template, ctx.metafields);
  const bound = isDynamicSource(value) ? value.$source : null;
  if (!bound && !options.length) return <>{children}</>;
  const label = "label" in field ? field.label : "";

  return (
    <div>
      {bound ? (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink" id={`${id}-label`}>
            {label}
          </span>
          <div className="rounded-[var(--radius-md)] bg-primary-soft/60 p-3 ring-1 ring-inset ring-primary/30" role="group" aria-labelledby={`${id}-label`}>
            <p className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
              <Database className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 truncate">{boundLabel(bound, options)}</span>
            </p>
            {checkBinding(field.type, bound, { definitions: ctx.metafields, template: ctx.template }).ok ? (
              <SampleLine path={bound} ctx={ctx} />
            ) : (
              <p className="mt-1 text-[12.5px] leading-relaxed text-warning">Donnée indisponible sur ce modèle (champ supprimé, rendu privé ou d&apos;une autre page) : la valeur par défaut s&apos;affiche.</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex h-11 items-center rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink ring-1 ring-line transition-colors hover:bg-surface-2 sm:h-8"
              >
                Changer
              </button>
              <button type="button" onClick={onUnbind} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:h-8">
                <Unplug className="size-3.5" aria-hidden /> Déconnecter
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {children}
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label={`Connecter une donnée au réglage « ${label} »`}
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-[12.5px] font-medium text-primary transition-colors hover:bg-primary-soft sm:min-h-8"
          >
            <Database className="size-3.5" aria-hidden /> Connecter une donnée
          </button>
        </>
      )}
      <SourcePickerDialog
        open={open}
        onClose={() => {
          setOpen(false);
          requestAnimationFrame(() => triggerRef.current?.focus());
        }}
        fieldLabel={label}
        options={options}
        current={bound}
        ctx={ctx}
        onPick={(path) => {
          onChange({ $source: path });
          setOpen(false);
        }}
      />
    </div>
  );
}

function boundLabel(source: string, options: SourceOption[]): string {
  const o = options.find((x) => x.source === source);
  if (o) return `${o.group} · ${o.label}`;
  const p = parseSource(source);
  return p?.kind === "metafield" ? `Champ personnalisé ${p.namespace}.${p.key}` : source;
}

function SampleLine({ path, ctx }: { path: string; ctx: DynamicContext }) {
  const sample = ctx.samples[path];
  const owner = path.split(".")[0];
  const who = owner === "product" || owner === "variant" ? (ctx.sampleProductName ? `« ${ctx.sampleProductName} »` : "le produit exemple") : "l'exemple";
  return sample ? (
    <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-muted">
      Avec {who} : <span className="text-ink">{sample}</span>
    </p>
  ) : (
    <p className="mt-1 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-ink-muted">
      <Link2Off className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      Pas de valeur pour {who} : la valeur par défaut du réglage s&apos;affiche.
    </p>
  );
}

function SourcePickerDialog({
  open,
  onClose,
  fieldLabel,
  options,
  current,
  ctx,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  fieldLabel: string;
  options: SourceOption[];
  current: string | null;
  ctx: DynamicContext;
  onPick: (path: string) => void;
}) {
  const [q, setQ] = React.useState("");
  const query = q.trim().toLowerCase();
  const list = query ? options.filter((o) => `${o.label} ${o.group}`.toLowerCase().includes(query)) : options;
  const groups = new Map<string, SourceOption[]>();
  for (const o of list) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
  return (
    <Dialog open={open} onClose={onClose} sheet title="Connecter une donnée" description={`« ${fieldLabel} » affichera automatiquement la donnée choisie, différente pour chaque produit ou page.`}>
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input fieldSize="sm" className="pl-10" placeholder="Rechercher une donnée" aria-label="Rechercher une donnée" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {ctx.sampleProductName && (ctx.template === "product") && (
          <p className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-[12.5px] leading-relaxed text-ink-muted">
            Exemples tirés du produit « <span className="font-medium text-ink">{ctx.sampleProductName}</span> ».
          </p>
        )}
        {[...groups.entries()].map(([group, items]) => (
          <div key={group}>
            <h3 className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{group}</h3>
            <ul className="space-y-1" role="radiogroup" aria-label={group}>
              {items.map((o) => {
                const on = current === o.source;
                const sample = ctx.samples[o.source];
                return (
                  <li key={o.source}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => onPick(o.source)}
                      className={cn(
                        "flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left ring-1 transition-[background-color,box-shadow] duration-150",
                        on ? "bg-primary-soft ring-2 ring-primary" : "ring-line hover:bg-surface-2",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{o.label}</span>
                        <span className="block truncate text-[12px] text-ink-muted">{sample ? sample : "Aucune valeur d'exemple"}</span>
                      </span>
                      {on && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!list.length && <p className="py-6 text-center text-sm text-ink-muted">{options.length ? `Aucune donnée ne correspond à « ${q} ».` : "Aucune donnée compatible avec ce réglage sur ce modèle."}</p>}
        <p className="text-[12px] leading-relaxed text-ink-faint">Seuls les champs personnalisés marqués « visibles en boutique » sont proposés. Les données des clients et des commandes ne sont jamais affichées.</p>
      </div>
    </Dialog>
  );
}


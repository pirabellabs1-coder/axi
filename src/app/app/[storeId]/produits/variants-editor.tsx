"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X, ChevronUp, ChevronDown, ImagePlus, ImageOff, Check, Layers } from "lucide-react";
import { MAX_OPTIONS, MAX_OPTION_VALUES, MAX_VARIANTS, OPTION_PRESETS, attrKey, guessType, variantName, type OptionType, type ProductOption, type VariantDraft } from "@/lib/products/variants";
import { HEX_COLOR, type ImageInput } from "@/lib/products/schemas";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { currencyDecimals, formatMoney, minorToInput, parseMoneyInput, sanitizeMoneyInput } from "@/lib/money";

export type OptionsChange = { valueRenames?: Record<string, Record<string, string>>; optionRename?: { from: string; to: string } };

const TYPE_LABEL: Record<OptionType, string> = { color: "Couleur (pastille)", size: "Taille", text: "Texte libre" };
const DEFAULT_SWATCH: Record<string, string> = {
  rouge: "#C62828", jaune: "#F9C80E", bleu: "#1E5AA8", vert: "#2E7D32", noir: "#111111", blanc: "#FFFFFF", orange: "#EF6C00", rose: "#E91E63",
  violet: "#6A1B9A", marron: "#6D4C41", gris: "#9E9E9E", beige: "#D7C4A3", bordeaux: "#7B1E2B", doré: "#C9A227", or: "#C9A227", argent: "#BDBDBD",
};

const iconBtn =
  "inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-[background-color,color,transform] hover:bg-surface-2 hover:text-ink active:scale-[0.96] disabled:opacity-30 disabled:hover:bg-transparent sm:size-9";

/* ───────────────────────── Éditeur d'options ───────────────────────── */

export function OptionsEditor({
  options,
  onChange,
  images,
  error,
}: {
  options: ProductOption[];
  onChange: (next: ProductOption[], change?: OptionsChange) => void;
  images: ImageInput[];
  error?: string;
}) {
  const used = new Set(options.map((o) => o.name.toLowerCase()));
  const addOption = (name?: string, type?: OptionType) => {
    if (options.length >= MAX_OPTIONS) return;
    let n = name ?? OPTION_PRESETS.find((p) => !used.has(p.name.toLowerCase()))?.name ?? `Option ${options.length + 1}`;
    if (used.has(n.toLowerCase())) n = `${n} ${options.length + 1}`;
    onChange([...options, { name: n, type: type ?? guessType(n), values: [] }]);
  };
  const update = (i: number, o: ProductOption, change?: OptionsChange) => onChange(options.map((x, j) => (j === i ? o : x)), change);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= options.length) return;
    const next = [...options];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {options.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Layers className="size-4 text-ink-faint" aria-hidden /> Ce produit n&apos;a pas de déclinaison. Ajoutez une option si vous le vendez en plusieurs couleurs, tailles ou matières.
        </p>
      )}
      {options.map((o, i) => (
        <OptionCard
          key={i}
          index={i}
          option={o}
          total={options.length}
          taken={options.filter((_, j) => j !== i).map((x) => x.name.toLowerCase())}
          images={images}
          onChange={(next, change) => update(i, next, change)}
          onMove={(d) => move(i, d)}
          onRemove={() => onChange(options.filter((_, j) => j !== i))}
        />
      ))}
      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      {options.length < MAX_OPTIONS && (
        <div className="flex flex-wrap items-center gap-2">
          {OPTION_PRESETS.filter((p) => !used.has(p.name.toLowerCase())).map((p) => (
            <Button key={p.name} type="button" variant="outline" size="sm" onClick={() => addOption(p.name, p.type)}>
              <Plus className="size-4" aria-hidden /> {p.name}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => addOption("Option " + (options.length + 1), "text")}>
            <Plus className="size-4" aria-hidden /> Option libre
          </Button>
          <span className="text-xs text-ink-faint">{MAX_OPTIONS - options.length} restante{MAX_OPTIONS - options.length > 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}

function OptionCard({
  index,
  option,
  total,
  taken,
  images,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  option: ProductOption;
  total: number;
  taken: string[];
  images: ImageInput[];
  onChange: (o: ProductOption, change?: OptionsChange) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  // Le nom est validé à la sortie du champ : une saisie intermédiaire ne régénère pas la matrice.
  const [name, setName] = useState(option.name);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setName(option.name), [option.name]);
  const nameId = `opt-name-${index}`;

  const commitName = () => {
    const n = name.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!n || taken.includes(n.toLowerCase())) {
      setMsg(!n ? "Le nom de l'option est requis" : "Ce nom est déjà utilisé");
      setName(option.name);
      return;
    }
    setMsg(null);
    if (n !== option.name) onChange({ ...option, name: n, type: option.values.length ? option.type : guessType(n) }, { optionRename: { from: option.name, to: n } });
  };

  const addValues = (raw: string) => {
    const parts = raw.split(",").map((v) => v.replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean);
    if (!parts.length) return;
    const values = [...option.values];
    for (const p of parts) {
      if (values.length >= MAX_OPTION_VALUES) {
        setMsg(`${MAX_OPTION_VALUES} valeurs maximum`);
        break;
      }
      if (values.some((v) => v.value.toLowerCase() === p.toLowerCase())) {
        setMsg(`« ${p} » existe déjà`);
        continue;
      }
      values.push(option.type === "color" ? { value: p, swatch: DEFAULT_SWATCH[p.toLowerCase()] ?? "#9E9E9E" } : { value: p });
    }
    setDraft("");
    onChange({ ...option, values });
  };

  const moveValue = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= option.values.length) return;
    const values = [...option.values];
    [values[i], values[j]] = [values[j], values[i]];
    onChange({ ...option, values });
  };

  return (
    <fieldset className="rounded-[var(--radius-md)] bg-surface-2/40 p-3 ring-1 ring-inset ring-line sm:p-4">
      <legend className="sr-only">Option {index + 1}</legend>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
        <div>
          <label htmlFor={nameId} className="mb-1.5 block text-sm font-medium text-ink">
            Nom de l&apos;option
          </label>
          <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitName())} maxLength={40} list="option-presets" className="h-11" />
        </div>
        <div>
          <label htmlFor={`opt-type-${index}`} className="mb-1.5 block text-sm font-medium text-ink">
            Affichage
          </label>
          <Select
            id={`opt-type-${index}`}
            value={option.type}
            onChange={(e) => {
              const type = e.target.value as OptionType;
              onChange({ ...option, type, values: option.values.map((v) => (type === "color" ? { ...v, swatch: v.swatch ?? DEFAULT_SWATCH[v.value.toLowerCase()] ?? "#9E9E9E" } : { value: v.value, image: v.image })) });
            }}
            className="h-11"
          >
            {(Object.keys(TYPE_LABEL) as OptionType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" className={iconBtn} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Monter l'option ${option.name}`}>
            <ChevronUp className="size-4" aria-hidden />
          </button>
          <button type="button" className={iconBtn} onClick={() => onMove(1)} disabled={index === total - 1} aria-label={`Descendre l'option ${option.name}`}>
            <ChevronDown className="size-4" aria-hidden />
          </button>
          <button type="button" className={cn(iconBtn, "hover:bg-danger-soft hover:text-danger")} onClick={onRemove} aria-label={`Supprimer l'option ${option.name}`}>
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <p className="mb-2 mt-3 text-sm font-medium text-ink" id={`opt-values-${index}`}>
        Valeurs <span className="font-normal text-ink-muted">({option.values.length})</span>
      </p>
      {option.type === "color" ? (
        <ul className="space-y-2" aria-labelledby={`opt-values-${index}`}>
          {option.values.map((v, vi) => (
            <ColorValueRow
              key={v.value + vi}
              index={vi}
              value={v}
              total={option.values.length}
              images={images}
              taken={option.values.filter((_, j) => j !== vi).map((x) => x.value.toLowerCase())}
              onChange={(nv, rename) =>
                onChange({ ...option, values: option.values.map((x, j) => (j === vi ? nv : x)) }, rename ? { valueRenames: { [option.name]: { [rename.from]: rename.to } } } : undefined)
              }
              onMove={(d) => moveValue(vi, d)}
              onRemove={() => onChange({ ...option, values: option.values.filter((_, j) => j !== vi) })}
            />
          ))}
        </ul>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-labelledby={`opt-values-${index}`}>
          {option.values.map((v, vi) => (
            <li key={v.value} className="inline-flex items-center rounded-full bg-surface py-0.5 pl-1 pr-0.5 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong">
              <button
                type="button"
                className="inline-flex min-h-9 items-center rounded-full px-2 focus-visible:outline-2 focus-visible:outline-primary"
                aria-label={`${v.value}, position ${vi + 1} sur ${option.values.length}. Alt + flèches pour déplacer.`}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowUp")) {
                    e.preventDefault();
                    moveValue(vi, -1);
                  } else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    moveValue(vi, 1);
                  }
                }}
              >
                {v.value}
              </button>
              <button type="button" onClick={() => moveValue(vi, -1)} disabled={vi === 0} className="hidden size-7 items-center justify-center rounded-full text-ink-faint hover:text-ink disabled:opacity-30 sm:inline-flex" aria-label={`Déplacer ${v.value} avant`}>
                <ChevronUp className="size-3 -rotate-90" aria-hidden />
              </button>
              <button type="button" onClick={() => onChange({ ...option, values: option.values.filter((_, j) => j !== vi) })} className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-danger-soft hover:text-danger" aria-label={`Retirer ${v.value}`}>
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <label htmlFor={`opt-add-${index}`} className="sr-only">
          Ajouter une valeur à {option.name}
        </label>
        <Input
          id={`opt-add-${index}`}
          value={draft}
          onChange={(e) => (e.target.value.includes(",") ? addValues(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValues(draft);
            }
          }}
          placeholder={option.type === "color" ? "Ajouter une couleur (Rouge, Jaune…)" : option.type === "size" ? "Ajouter une taille (S, M, L…)" : "Ajouter une valeur"}
          className="h-11 text-sm"
          aria-describedby={`opt-hint-${index}`}
        />
        <Button type="button" variant="outline" onClick={() => addValues(draft)} disabled={!draft.trim()}>
          Ajouter
        </Button>
      </div>
      <p id={`opt-hint-${index}`} className={cn("mt-1.5 text-[13px]", msg ? "font-medium text-danger" : "text-ink-muted")} role={msg ? "alert" : undefined}>
        {msg ?? "Entrée ou virgule pour ajouter plusieurs valeurs."}
      </p>
    </fieldset>
  );
}

function ColorValueRow({
  index,
  value,
  total,
  images,
  taken,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  value: ProductOption["values"][number];
  total: number;
  images: ImageInput[];
  taken: string[];
  onChange: (v: ProductOption["values"][number], rename?: { from: string; to: string }) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(value.value);
  const [hex, setHex] = useState(value.swatch ?? "#9E9E9E");
  useEffect(() => setName(value.value), [value.value]);
  useEffect(() => setHex(value.swatch ?? "#9E9E9E"), [value.swatch]);
  const commit = () => {
    const n = name.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!n || taken.includes(n.toLowerCase())) return setName(value.value);
    if (n !== value.value) onChange({ ...value, value: n }, { from: value.value, to: n });
  };
  const hexValid = HEX_COLOR.test(hex);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-surface p-2 ring-1 ring-inset ring-line">
      <label className="relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full ring-1 ring-inset ring-line-strong focus-within:ring-2 focus-within:ring-primary" title="Choisir la couleur">
        <span className="size-7 rounded-full ring-1 ring-black/10" style={{ background: value.swatch ?? "#9E9E9E" }} aria-hidden />
        <input type="color" value={(value.swatch ?? "#9E9E9E").toLowerCase()} onChange={(e) => onChange({ ...value, swatch: e.target.value.toUpperCase() })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`Couleur de la pastille ${value.value}`} />
      </label>
      <div className="min-w-0 flex-1 basis-28">
        <label htmlFor={`cv-name-${value.value}`} className="sr-only">
          Nom de la couleur
        </label>
        <Input id={`cv-name-${value.value}`} value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} className="h-11 text-sm" maxLength={40} />
      </div>
      <div className="w-28">
        <label htmlFor={`cv-hex-${value.value}`} className="sr-only">
          Code couleur de {value.value}
        </label>
        <Input
          id={`cv-hex-${value.value}`}
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => (hexValid ? onChange({ ...value, swatch: hex.toUpperCase() }) : setHex(value.swatch ?? "#9E9E9E"))}
          invalid={!hexValid}
          className="h-11 font-mono text-xs uppercase"
          maxLength={7}
          spellCheck={false}
        />
      </div>
      <ImagePickerButton images={images} value={value.image ?? null} onChange={(url) => onChange({ ...value, image: url })} label={`Image de la couleur ${value.value}`} />
      <div className="ml-auto flex items-center">
        <button type="button" className={iconBtn} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Monter ${value.value}`}>
          <ChevronUp className="size-4" aria-hidden />
        </button>
        <button type="button" className={iconBtn} onClick={() => onMove(1)} disabled={index === total - 1} aria-label={`Descendre ${value.value}`}>
          <ChevronDown className="size-4" aria-hidden />
        </button>
        <button type="button" className={cn(iconBtn, "hover:bg-danger-soft hover:text-danger")} onClick={onRemove} aria-label={`Retirer ${value.value}`}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}

/* ───────────────────────── Choix d'une image parmi les médias ───────────────────────── */

export function ImagePickerButton({ images, value, onChange, label, size = 44, fallback = null }: { images: ImageInput[]; value: string | null; onChange: (url: string | null) => void; label: string; size?: number; fallback?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-surface-2 text-ink-faint ring-1 ring-inset ring-line-strong transition-[transform,box-shadow] hover:ring-primary active:scale-[0.96]"
        style={{ width: size, height: size }}
        aria-label={value ? `${label} (modifier)` : fallback ? `${label} (image de la couleur, choisir une autre)` : `${label} (choisir)`}
        title={label}
      >
        {value || fallback ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={(value || fallback)!} alt="" className={cn("size-full object-cover", !value && "opacity-60")} />
        ) : (
          <ImagePlus className="size-4" aria-hidden />
        )}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label} description="Choisissez parmi les médias du produit." size="md">
        {images.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <ImageOff className="size-4" aria-hidden /> Ajoutez d&apos;abord des photos dans la section Médias.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="listbox" aria-label="Médias">
            {images.map((img, i) => {
              const selected = img.url === value;
              return (
                <li key={img.url.slice(-40) + i} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(img.url);
                      setOpen(false);
                    }}
                    className={cn("relative block w-full overflow-hidden rounded-[var(--radius-md)] ring-1 ring-line transition-[box-shadow,transform] active:scale-[0.98]", selected && "ring-2 ring-primary")}
                    aria-label={`Photo ${i + 1}${img.alt ? ` : ${img.alt}` : ""}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="aspect-square w-full object-cover" />
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-full bg-primary text-on-primary">
                        <Check className="size-3.5" aria-hidden />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
          {value && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Retirer l&apos;image
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Fermer
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/* ───────────────────────── Tableau des variantes ───────────────────────── */

const cellInput = "h-11 px-2.5 text-sm sm:h-9";

export function VariantsTable({
  options,
  variants,
  onChange,
  images,
  trackStock,
  basePrice,
  currency,
}: {
  options: ProductOption[];
  variants: VariantDraft[];
  onChange: (next: VariantDraft[]) => void;
  images: ImageInput[];
  trackStock: boolean;
  basePrice: number;
  currency: string;
}) {
  const keyOf = (v: VariantDraft) => attrKey(v.attributes, options);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkCompare, setBulkCompare] = useState("");
  const [bulkStock, setBulkStock] = useState("");
  const keys = useMemo(() => variants.map(keyOf), [variants, options]); // eslint-disable-line react-hooks/exhaustive-deps

  // Purge de la sélection quand la matrice change
  useEffect(() => {
    setSelected((s) => new Set([...s].filter((k) => keys.includes(k))));
  }, [keys]);

  const patch = (i: number, p: Partial<VariantDraft>) => onChange(variants.map((v, j) => (j === i ? { ...v, ...p } : v)));
  const patchSelected = (p: Partial<VariantDraft>) => onChange(variants.map((v) => (selected.has(keyOf(v)) ? { ...v, ...p } : v)));
  const allSelected = selected.size > 0 && selected.size === variants.length;
  const toggleValue = (opt: string, val: string) => {
    const ks = variants.filter((v) => v.attributes[opt] === val).map(keyOf);
    const every = ks.every((k) => selected.has(k));
    setSelected((s) => {
      const n = new Set(s);
      for (const k of ks) every ? n.delete(k) : n.add(k);
      return n;
    });
  };
  const numeric = (s: string) => s.replace(/[^\d]/g, "");
  const total = variants.reduce((s, v) => s + (v.stock || 0), 0);
  const continueCount = variants.filter((v) => v.inventoryPolicy === "CONTINUE").length;

  if (variants.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sélection rapide des variantes">
        <span className="mr-1 text-sm text-ink-muted">Sélectionner :</span>
        <FilterChip pressed={allSelected} onClick={() => setSelected(allSelected ? new Set() : new Set(keys))}>
          Tout
        </FilterChip>
        {options.map((o) =>
          o.values.map((v) => {
            const ks = variants.filter((x) => x.attributes[o.name] === v.value).map(keyOf);
            const pressed = ks.length > 0 && ks.every((k) => selected.has(k));
            return (
              <FilterChip key={o.name + v.value} pressed={pressed} onClick={() => toggleValue(o.name, v.value)} title={`${o.name} : ${v.value}`}>
                {o.type === "color" && v.swatch && <span className="size-3 rounded-full ring-1 ring-black/10" style={{ background: v.swatch }} aria-hidden />}
                {v.value}
              </FilterChip>
            );
          }),
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] bg-primary-soft/50 p-3 ring-1 ring-inset ring-primary/15" role="region" aria-label="Édition groupée">
          <p className="w-full text-sm font-medium text-ink" aria-live="polite">
            {selected.size} variante{selected.size > 1 ? "s" : ""} sélectionnée{selected.size > 1 ? "s" : ""}
          </p>
          <BulkField id="bulk-price" label="Prix" value={bulkPrice} onChange={setBulkPrice} filter={(x) => sanitizeMoneyInput(x, currency)} decimal={currencyDecimals(currency) > 0} onApply={() => (patchSelected({ price: bulkPrice === "" ? null : parseMoneyInput(bulkPrice, currency) }), setBulkPrice(""))} placeholder={basePrice ? minorToInput(basePrice, currency) : ""} />
          <BulkField id="bulk-compare" label="Prix barré" value={bulkCompare} onChange={setBulkCompare} filter={(x) => sanitizeMoneyInput(x, currency)} decimal={currencyDecimals(currency) > 0} onApply={() => (patchSelected({ compareAtPrice: bulkCompare === "" ? null : parseMoneyInput(bulkCompare, currency) }), setBulkCompare(""))} />
          {trackStock && <BulkField id="bulk-stock" label="Stock" value={bulkStock} onChange={setBulkStock} onApply={() => bulkStock !== "" && (patchSelected({ stock: Number(bulkStock) }), setBulkStock(""))} />}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => patchSelected({ available: true })}>
              Disponibles
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => patchSelected({ available: false })}>
              Indisponibles
            </Button>
            {trackStock && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => patchSelected({ inventoryPolicy: "CONTINUE" })}>
                  Vendre en rupture
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => patchSelected({ inventoryPolicy: "DENY" })}>
                  Bloquer à zéro
                </Button>
              </>
            )}
            <ImagePickerButton images={images} value={null} onChange={(url) => patchSelected({ imageUrl: url })} label="Image des variantes sélectionnées" size={36} />
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Désélectionner
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-[var(--radius-md)] ring-1 ring-line">
        <table className={cn("w-full text-sm", trackStock ? "min-w-[960px]" : "min-w-[860px]")}>
          <caption className="sr-only">Variantes du produit</caption>
          <thead className="border-b border-line bg-surface-2/50 text-left text-[12px] text-ink-muted">
            <tr>
              <th scope="col" className="h-10 w-12 px-3">
                <input type="checkbox" className="size-5 accent-[var(--c-primary)]" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(keys))} aria-label="Sélectionner toutes les variantes" />
              </th>
              <th scope="col" className="w-14 px-1 font-medium">
                Image
              </th>
              <th scope="col" className="px-3 font-medium">
                Variante
              </th>
              <th scope="col" className="w-32 px-2 font-medium">
                Prix
              </th>
              <th scope="col" className="w-32 px-2 font-medium">
                Prix barré
              </th>
              {trackStock && (
                <th scope="col" className="w-24 px-2 font-medium">
                  Stock
                </th>
              )}
              <th scope="col" className="w-36 px-2 font-medium">
                SKU
              </th>
              <th scope="col" className="w-36 px-2 font-medium">
                Code-barres
              </th>
              <th scope="col" className="w-24 px-2 text-center font-medium">
                Disponible
              </th>
              {trackStock && (
                <th scope="col" className="w-28 px-2 text-center font-medium" title="Continuer à vendre en cas de rupture (précommande)">
                  Vendre en rupture
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {variants.map((v, i) => {
              const k = keys[i];
              const name = variantName(v.attributes, options);
              const swatch = options.find((o) => o.type === "color");
              const sw = swatch?.values.find((x) => x.value === v.attributes[swatch.name])?.swatch;
              const effective = v.price ?? basePrice;
              return (
                <tr key={v.id ?? k} className={cn("transition-colors", selected.has(k) ? "bg-primary-soft/30" : "hover:bg-surface-2/40", !v.available && "text-ink-muted")}>
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--c-primary)]"
                      checked={selected.has(k)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          n.has(k) ? n.delete(k) : n.add(k);
                          return n;
                        })
                      }
                      aria-label={`Sélectionner ${name}`}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <ImagePickerButton
                      images={images}
                      value={v.imageUrl}
                      fallback={options.map((o) => o.values.find((x) => x.value === v.attributes[o.name])?.image).find(Boolean) ?? null}
                      onChange={(url) => patch(i, { imageUrl: url })}
                      label={`Image de ${name}`}
                      size={40}
                    />
                  </td>
                  <th scope="row" className="px-3 py-1.5 text-left font-medium text-ink">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      {sw && <span className="size-3.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: sw }} aria-hidden />}
                      {name}
                      {!v.id && <Badge tone="info">Nouvelle</Badge>}
                    </span>
                  </th>
                  <td className="px-2 py-1.5">
                    <MoneyCell
                      label={`Prix de ${name}`}
                      value={v.price}
                      currency={currency}
                      placeholder={basePrice ? minorToInput(basePrice, currency) : "Prix de base"}
                      onChange={(price) => patch(i, { price })}
                      className={cellInput}
                      title={`Prix effectif : ${formatMoney(effective, currency)}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <MoneyCell label={`Prix barré de ${name}`} value={v.compareAtPrice ?? null} currency={currency} onChange={(compareAtPrice) => patch(i, { compareAtPrice })} className={cellInput} />
                  </td>
                  {trackStock && (
                    <td className="px-2 py-1.5">
                      <Input aria-label={`Stock de ${name}`} inputMode="numeric" value={String(v.stock)} onChange={(e) => patch(i, { stock: Number(numeric(e.target.value) || 0) })} className={cn(cellInput, v.stock <= 0 && "text-danger")} title={v.stock < 0 ? `Survente : ${-v.stock} à réapprovisionner` : undefined} />
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <Input aria-label={`SKU de ${name}`} value={v.sku ?? ""} onChange={(e) => patch(i, { sku: e.target.value || null })} maxLength={60} className={cn(cellInput, "font-mono text-xs")} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input aria-label={`Code-barres de ${name}`} value={v.barcode ?? ""} onChange={(e) => patch(i, { barcode: e.target.value || null })} maxLength={60} inputMode="numeric" className={cn(cellInput, "font-mono text-xs")} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" className="size-5 accent-[var(--c-primary)]" checked={v.available} onChange={(e) => patch(i, { available: e.target.checked })} aria-label={`${name} disponible à la vente`} />
                  </td>
                  {trackStock && (
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        className="size-5 accent-[var(--c-primary)]"
                        checked={v.inventoryPolicy === "CONTINUE"}
                        onChange={(e) => patch(i, { inventoryPolicy: e.target.checked ? "CONTINUE" : "DENY" })}
                        aria-label={`${name} : continuer à vendre en cas de rupture`}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">
        {variants.length} variante{variants.length > 1 ? "s" : ""} sur {MAX_VARIANTS} maximum.
        {trackStock && ` Stock total : ${total.toLocaleString("fr-FR")}.`}
        {trackStock && continueCount > 0 && ` ${continueCount} variante${continueCount > 1 ? "s" : ""} vendue${continueCount > 1 ? "s" : ""} aussi en rupture (précommande).`} Prix vide : prix de base ({basePrice ? formatMoney(basePrice, currency) : "à définir"}).
      </p>
    </div>
  );
}

function FilterChip({ pressed, onClick, children, title }: { pressed: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ring-1 ring-inset transition-[background-color,color,transform] active:scale-[0.97] sm:min-h-8",
        pressed ? "bg-primary text-on-primary ring-primary" : "bg-surface text-ink ring-line-strong hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Cellule de prix : saisie en unités majeures (« 12.50 »), valeur en unités mineures. Un brouillon texte conserve la
 * frappe en cours (« 12. ») ; il est resynchronisé quand la valeur change de l'extérieur (édition groupée).
 */
export function MoneyCell({ label, value, currency, onChange, placeholder, className, title, allowNegative = false }: { label: string; value: number | null; currency: string; onChange: (v: number | null) => void; placeholder?: string; className?: string; title?: string; allowNegative?: boolean }) {
  const [draft, setDraft] = useState(() => minorToInput(value, currency));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    const abs = draft.replace("-", "");
    const current = abs === "" ? null : (parseMoneyInput(abs, currency) ?? 0) * (draft.startsWith("-") ? -1 : 1);
    if (current !== value) setDraft(minorToInput(value, currency));
  }
  return (
    <Input
      aria-label={label}
      inputMode={currencyDecimals(currency) === 0 ? "numeric" : "decimal"}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        const neg = allowNegative && e.target.value.trim().startsWith("-");
        const abs = sanitizeMoneyInput(e.target.value, currency);
        setDraft(neg ? `-${abs}` : abs);
        const parsed = abs === "" ? null : parseMoneyInput(abs, currency);
        onChange(parsed == null ? null : neg ? -parsed : parsed);
      }}
      className={className}
      title={title}
    />
  );
}

function BulkField({ id, label, value, onChange, onApply, placeholder, filter, decimal }: { id: string; label: string; value: string; onChange: (v: string) => void; onApply: () => void; placeholder?: string; filter?: (v: string) => string; decimal?: boolean }) {
  return (
    <div className="flex items-end gap-1.5">
      <div>
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-muted">
          {label}
        </label>
        <Input
          id={id}
          inputMode={decimal ? "decimal" : "numeric"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(filter ? filter(e.target.value) : e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onApply();
            }
          }}
          className="h-11 w-28 px-3 text-sm sm:h-9"
        />
      </div>
      <Button type="button" size="sm" onClick={onApply}>
        Appliquer
      </Button>
    </div>
  );
}

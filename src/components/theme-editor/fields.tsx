"use client";

import * as React from "react";
import { AlertTriangle, Bold, Check, Italic, Link2, List, Search, X } from "lucide-react";
import { Input, Label, Select, Textarea, Hint, FieldError, Switch } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { FONT_OPTIONS } from "@/lib/theme-engine/editor-defaults";
import type { GlobalField } from "@/lib/theme-engine/editor-global";
import { contrastLevel, contrastRatio } from "@/lib/theme-engine/editor-color";
import { HEX_RE } from "@/lib/theme-engine/validate";
import type { SettingField } from "@/lib/theme-engine/types";
import { cn } from "@/lib/utils";
import { ImageField } from "./image-field";
import { LinkPicker } from "./link-picker";
import type { EditorProduct, EditorResources } from "./types";

export type FieldContext = {
  resources: EditorResources;
  /** Couleur de comparaison (contraste) pour les champs couleur. */
  contrastBase?: string | null;
  /** Schémas de couleurs globaux, proposés dans le réglage « Couleurs de la section ». */
  schemes?: { id: string; name: string }[];
};

type Props = { id: string; field: SettingField | GlobalField; value: unknown; onChange: (v: unknown) => void; error?: string; ctx: FieldContext };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Un composant par type de champ du schéma. */
export function SettingInput({ id, field, value, onChange, error, ctx }: Props) {
  const errId = error ? `${id}-error` : undefined;
  const info = "info" in field ? field.info : undefined;
  const hintId = info ? `${id}-hint` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(" ") || undefined;
  const foot = error ? <FieldError id={errId}>{error}</FieldError> : info ? <Hint id={hintId}>{info}</Hint> : null;

  switch (field.type) {
    case "header":
      return <h3 className="pt-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{field.content}</h3>;
    case "paragraph":
      return <p className="text-[13px] leading-relaxed text-ink-muted">{field.content}</p>;

    case "text": {
      const v = str(value);
      return (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor={id}>{field.label}</Label>
            {field.maxLength && <span className="tabular text-[12px] text-ink-faint" aria-hidden>{v.length}/{field.maxLength}</span>}
          </div>
          <Input id={id} fieldSize="sm" value={v} maxLength={field.maxLength} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} invalid={!!error} aria-describedby={describedBy} />
          {foot}
        </div>
      );
    }
    case "textarea":
      return (
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          <Textarea id={id} rows={3} className="min-h-20 text-sm" value={str(value)} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} invalid={!!error} aria-describedby={describedBy} />
          {foot}
        </div>
      );
    case "richtext":
      return <RichText id={id} label={field.label} value={str(value)} onChange={onChange} error={error} info={info} />;

    case "number":
      return (
        <div>
          <Label htmlFor={id}>
            {field.label}
            {field.unit ? <span className="text-ink-muted"> ({field.unit})</span> : null}
          </Label>
          <Input
            id={id}
            fieldSize="sm"
            type="number"
            inputMode="decimal"
            min={field.min}
            max={field.max}
            step={field.step}
            value={num(value, field.min ?? 0)}
            onChange={(e) => onChange(e.target.value === "" ? (field.min ?? 0) : Number(e.target.value))}
            invalid={!!error}
            aria-describedby={describedBy}
          />
          {foot}
        </div>
      );
    case "range": {
      const v = num(value, field.default);
      const decimals = (field.step ?? 1) < 1 ? 2 : 0;
      return (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor={id}>{field.label}</Label>
            <output htmlFor={id} className="tabular min-w-14 text-right text-[13px] font-medium text-ink">
              {v.toFixed(decimals)}
              {field.unit ? ` ${field.unit}` : ""}
            </output>
          </div>
          <input
            id={id}
            type="range"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-describedby={describedBy}
            aria-valuetext={`${v.toFixed(decimals)}${field.unit ? ` ${field.unit}` : ""}`}
            className="h-11 w-full cursor-pointer accent-[var(--c-primary)] sm:h-8"
          />
          {foot}
        </div>
      );
    }
    case "checkbox":
      return (
        <div>
          <Switch checked={value === true} onChange={(v) => onChange(v)} label={field.label} />
          {foot}
        </div>
      );
    case "select": {
      const numeric = "numeric" in field && field.numeric;
      const options = field.id === "scheme" && ctx.schemes?.length ? mergeSchemes(field.options, ctx.schemes) : field.options;
      return (
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          <Select id={id} fieldSize="sm" value={String(value ?? "")} onChange={(e) => onChange(numeric ? Number(e.target.value) : e.target.value)} invalid={!!error} aria-describedby={describedBy}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {foot}
        </div>
      );
    }
    case "segmented": {
      const numeric = "numeric" in field && field.numeric;
      return (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink" id={`${id}-label`}>
            {field.label}
          </span>
          <Segmented fill size="sm" label={field.label} options={field.options} value={String(value ?? "")} onChange={(v) => onChange(numeric ? Number(v) : v)} />
          {foot}
        </div>
      );
    }
    case "color":
      return <ColorInput id={id} label={field.label} value={typeof value === "string" ? value : null} onChange={onChange} error={error} base={"contrastWith" in field && field.contrastWith ? ctx.contrastBase : null} />;
    case "image": {
      const v = value && typeof value === "object" && "url" in (value as object) ? (value as { url: string; alt?: string }) : null;
      return <ImageField storeId={ctx.resources.storeId} id={id} label={field.label} info={info} value={v} onChange={onChange} error={error} noAlt={"noAlt" in field && field.noAlt} />;
    }
    case "video":
      return (
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          <Input id={id} fieldSize="sm" type="url" inputMode="url" placeholder="https://youtube.com/watch?v=…" value={str(value)} onChange={(e) => onChange(e.target.value.trim())} invalid={!!error} aria-describedby={describedBy} />
          {error ? <FieldError id={errId}>{error}</FieldError> : <Hint id={hintId}>{info ?? "YouTube, Vimeo ou fichier MP4 en https."}</Hint>}
        </div>
      );
    case "url":
      return <LinkPicker id={id} label={field.label} value={str(value)} onChange={onChange} error={error} resources={ctx.resources} />;
    case "collection": {
      const list = ctx.resources.collections;
      return (
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          <Select id={id} fieldSize="sm" value={str(value)} onChange={(e) => onChange(e.target.value || null)} invalid={!!error} aria-describedby={describedBy}>
            <option value="">{list.length ? "Toutes les collections / aucune" : "Aucune collection"}</option>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {error ? foot : !list.length ? (
            <Hint>
              Créez des collections dans{" "}
              <a className="font-medium text-primary underline-offset-4 hover:underline" href={`/app/${ctx.resources.storeId}/collections`} target="_blank" rel="noopener noreferrer">
                Collections
              </a>
              .
            </Hint>
          ) : (
            foot
          )}
        </div>
      );
    }
    case "product":
      return <ProductPicker id={id} label={field.label} products={ctx.resources.products} value={value ? [str(value)] : []} max={1} onChange={(ids) => onChange(ids[0] ?? null)} error={error} storeId={ctx.resources.storeId} />;
    case "product_list":
      return <ProductPicker id={id} label={field.label} products={ctx.resources.products} value={Array.isArray(value) ? (value as string[]) : []} max={field.limit ?? 24} onChange={onChange} error={error} storeId={ctx.resources.storeId} />;
    case "menu":
      return (
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          <Select id={id} fieldSize="sm" value={str(value)} onChange={(e) => onChange(e.target.value)} invalid={!!error} aria-describedby={describedBy}>
            <option value="">Aucun menu</option>
            {ctx.resources.menus.map((m) => (
              <option key={m.handle} value={m.handle}>
                {m.title}
              </option>
            ))}
          </Select>
          {error ? (
            foot
          ) : (
            <Hint>
              <a className="font-medium text-primary underline-offset-4 hover:underline" href={`/app/${ctx.resources.storeId}/navigation`} target="_blank" rel="noopener noreferrer">
                Modifier les menus
              </a>{" "}
              (nouvel onglet)
            </Hint>
          )}
        </div>
      );
    case "blog_category": {
      const list = ctx.resources.blogCategories ?? [];
      const v = str(value);
      // Ancienne valeur texte (adresse saisie à la main) ou catégorie supprimée : conservée et signalée.
      const unknown = v !== "" && !list.some((c) => c.slug === v);
      return (
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          <Select id={id} fieldSize="sm" value={v} onChange={(e) => onChange(e.target.value)} invalid={!!error} aria-describedby={describedBy}>
            <option value="">Toutes les catégories</option>
            {list.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
            {unknown && <option value={v}>{v} (introuvable)</option>}
          </Select>
          {error ? (
            foot
          ) : (
            <Hint id={hintId}>
              {unknown ? "Cette catégorie n'existe plus : aucun article ne s'affichera. " : info ? `${info} ` : null}
              <a className="font-medium text-primary underline-offset-4 hover:underline" href={`/app/${ctx.resources.storeId}/blog/categories`} target="_blank" rel="noopener noreferrer">
                {list.length ? "Gérer les catégories" : "Créer des catégories"}
              </a>{" "}
              (nouvel onglet)
            </Hint>
          )}
        </div>
      );
    }
    case "font":
      return (
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          <Select id={id} fieldSize="sm" value={str(value)} onChange={(e) => onChange(e.target.value)} invalid={!!error} aria-describedby={describedBy}>
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          {foot}
        </div>
      );
    case "schemes":
    case "menus":
      return null; // rendus par les réglages du thème
  }
}

function mergeSchemes(options: { value: string; label: string }[], schemes: { id: string; name: string }[]) {
  const seen = new Set(options.map((o) => o.value));
  return [...options, ...schemes.filter((s) => !seen.has(s.id)).map((s) => ({ value: s.id, label: s.name }))];
}

/* ───────────── Couleur ───────────── */

export function ColorInput({ id, label, value, onChange, error, base }: { id: string; label: string; value: string | null; onChange: (v: string) => void; error?: string; base?: string | null }) {
  const [text, setText] = React.useState(value ?? "");
  const [last, setLast] = React.useState(value);
  if (value !== last) {
    setLast(value);
    setText(value ?? "");
  }
  const valid = !!value && HEX_RE.test(value);
  const ratio = valid && base && HEX_RE.test(base) ? contrastRatio(value!, base) : null;
  const level = ratio != null ? contrastLevel(ratio) : null;
  const errId = error ? `${id}-error` : undefined;
  return (
    <div>
      <Label htmlFor={`${id}-hex`}>{label}</Label>
      <div className="flex items-center gap-2">
        <span className="relative size-11 shrink-0 overflow-hidden rounded-[12px] ring-1 ring-line-strong sm:size-9">
          <input
            id={id}
            type="color"
            aria-label={`${label} : sélecteur`}
            value={valid ? value!.toLowerCase() : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 p-0"
          />
        </span>
        <Input
          id={`${id}-hex`}
          fieldSize="sm"
          className="tabular font-mono uppercase"
          value={text}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            let t = e.target.value.trim();
            if (t && !t.startsWith("#")) t = `#${t}`;
            setText(t);
            if (HEX_RE.test(t)) onChange(t);
          }}
          invalid={!!error || (text !== "" && !HEX_RE.test(text))}
          aria-describedby={errId}
        />
      </div>
      {error ? (
        <FieldError id={errId}>{error}</FieldError>
      ) : ratio != null && level ? (
        <p className={cn("mt-1.5 flex items-center gap-1.5 text-[13px]", ratio >= 4.5 ? "text-ink-muted" : "text-warning")}>
          {ratio >= 4.5 ? <Check className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
          Contraste {ratio.toFixed(1).replace(".", ",")}:1 · {level}
        </p>
      ) : null}
    </div>
  );
}

/* ───────────── Texte enrichi (Markdown limité) ───────────── */

function RichText({ id, label, value, onChange, error, info }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; info?: string }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after = before, placeholder = "texte") => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e) || placeholder;
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };
  const list = () => {
    const el = ref.current;
    if (!el) return;
    const s = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    onChange(value.slice(0, s) + "- " + value.slice(s));
    requestAnimationFrame(() => el.focus());
  };
  const tools = [
    { label: "Gras", icon: Bold, run: () => wrap("**") },
    { label: "Italique", icon: Italic, run: () => wrap("*") },
    { label: "Lien", icon: Link2, run: () => wrap("[", "](/catalogue)", "texte du lien") },
    { label: "Liste à puces", icon: List, run: list },
  ];
  const errId = error ? `${id}-error` : undefined;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className={cn("overflow-hidden rounded-[var(--radius-md)] bg-surface ring-1 ring-inset", error ? "ring-2 ring-danger" : "ring-line-strong focus-within:ring-2 focus-within:ring-primary")}>
        <div role="toolbar" aria-label={`Mise en forme : ${label}`} className="flex gap-0.5 border-b border-line p-1">
          {tools.map((t) => (
            <button key={t.label} type="button" onClick={t.run} aria-label={t.label} title={t.label} className="grid size-9 place-items-center rounded-[8px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink">
              <t.icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>
        <textarea
          ref={ref}
          id={id}
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error || undefined}
          aria-describedby={errId ?? `${id}-hint`}
          className="block min-h-24 w-full resize-y border-0 bg-transparent px-3 py-2.5 text-sm leading-relaxed text-ink outline-none"
        />
      </div>
      {error ? <FieldError id={errId}>{error}</FieldError> : <Hint id={`${id}-hint`}>{info ?? "**gras**, *italique*, [lien](/catalogue), listes avec « - ». Pas de HTML."}</Hint>}
    </div>
  );
}

/* ───────────── Produits ───────────── */

function ProductPicker({
  id,
  label,
  products,
  value,
  max,
  onChange,
  error,
  storeId,
}: {
  id: string;
  label: string;
  products: EditorProduct[];
  value: string[];
  max: number;
  onChange: (ids: string[]) => void;
  error?: string;
  storeId: string;
}) {
  const [q, setQ] = React.useState("");
  const byId = new Map(products.map((p) => [p.id, p]));
  const query = q.trim().toLowerCase();
  const filtered = (query ? products.filter((p) => p.name.toLowerCase().includes(query)) : products).slice(0, 60);
  const single = max === 1;
  const full = value.length >= max;
  const errId = error ? `${id}-error` : undefined;

  if (!products.length) {
    return (
      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
        <Hint>
          Aucun produit.{" "}
          <a className="font-medium text-primary underline-offset-4 hover:underline" href={`/app/${storeId}/produits/nouveau`} target="_blank" rel="noopener noreferrer">
            Ajouter un produit
          </a>
        </Hint>
      </div>
    );
  }

  const toggle = (pid: string) => {
    if (single) onChange(value[0] === pid ? [] : [pid]);
    else if (value.includes(pid)) onChange(value.filter((x) => x !== pid));
    else if (!full) onChange([...value, pid]);
  };

  return (
    <fieldset aria-describedby={errId}>
      <legend className="mb-1.5 flex w-full items-baseline justify-between text-sm font-medium text-ink">
        <span>{label}</span>
        {!single && <span className="tabular text-[12px] font-normal text-ink-faint">{value.length}/{max}</span>}
      </legend>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((pid) => (
            <li key={pid} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-soft py-1 pl-3 pr-1 text-[13px] text-primary-deep">
              <span className="truncate">{byId.get(pid)?.name ?? "Produit supprimé"}</span>
              <button type="button" onClick={() => onChange(value.filter((x) => x !== pid))} aria-label={`Retirer ${byId.get(pid)?.name ?? "ce produit"}`} className="grid size-7 place-items-center rounded-full hover:bg-surface">
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <Input id={id} fieldSize="sm" className="pl-9" placeholder="Rechercher un produit" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`${label} : rechercher`} />
      </div>
      <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-[var(--radius-md)] ring-1 ring-line">
        {filtered.map((p) => {
          const on = value.includes(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                role={single ? "radio" : "checkbox"}
                aria-checked={on}
                disabled={!on && full && !single}
                onClick={() => toggle(p.id)}
                className="flex min-h-11 w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <span className="size-8 shrink-0 overflow-hidden rounded-[8px] bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.imageUrl && <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-full ring-1", on ? "bg-primary text-on-primary ring-primary" : "ring-line-strong")}>{on && <Check className="size-3" aria-hidden />}</span>
              </button>
            </li>
          );
        })}
        {!filtered.length && <li className="px-3 py-3 text-[13px] text-ink-muted">Aucun produit ne correspond.</li>}
      </ul>
      <FieldError id={errId}>{error}</FieldError>
    </fieldset>
  );
}

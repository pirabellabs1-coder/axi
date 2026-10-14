"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ImagePlus, SlidersHorizontal, X } from "lucide-react";
import { saveMetafieldValues } from "@/lib/metafields/actions";
import { DIMENSION_UNITS, WEIGHT_UNITS, METAFIELD_TYPE_META, type MetafieldDefinitionDTO, type MetafieldOwnerType } from "@/lib/metafields/types";
import { isEmptyInput, validateMetafieldValue } from "@/lib/metafields/validate";
import { compressPhoto, uploadImage } from "@/lib/storage/client";
import type { UploadPurpose } from "@/lib/storage/limits";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string };

const UPLOAD_PURPOSE: Record<MetafieldOwnerType, UploadPurpose> = {
  PRODUCT: "product",
  VARIANT: "product",
  COLLECTION: "collection",
  CUSTOMER: "theme",
  ORDER: "theme",
  STORE: "theme",
  PAGE: "theme",
  BLOG_POST: "theme",
};

const UNIT_LABEL: Record<string, string> = { mm: "mm", cm: "cm", m: "m", in: "pouces", ft: "pieds", g: "g", kg: "kg", lb: "livres", oz: "onces" };

/** Valeur stockée → état de saisie (chaînes pour les champs texte). */
function toDraft(def: MetafieldDefinitionDTO, v: unknown): unknown {
  if (v === undefined || v === null) {
    if (def.type === "dimension") return { value: "", unit: "cm" };
    if (def.type === "weight") return { value: "", unit: "kg" };
    if (def.type === "image") return { url: "", alt: "" };
    if (def.type === "list_single_line_text") return def.validations.choices?.length ? [] : "";
    return "";
  }
  switch (def.type) {
    case "list_single_line_text":
      return def.validations.choices?.length ? (Array.isArray(v) ? v : []) : Array.isArray(v) ? v.join("\n") : "";
    case "boolean":
      return v === true ? "true" : v === false ? "false" : "";
    case "integer":
    case "decimal":
    case "rating":
      return typeof v === "number" ? String(v) : "";
    case "money":
      return typeof (v as { amount?: unknown }).amount === "number" ? String((v as { amount: number }).amount) : "";
    case "dimension":
    case "weight": {
      const o = v as { value?: unknown; unit?: unknown };
      return { value: typeof o.value === "number" ? String(o.value) : "", unit: typeof o.unit === "string" ? o.unit : def.type === "dimension" ? "cm" : "kg" };
    }
    case "image": {
      const o = v as { url?: unknown; alt?: unknown };
      return { url: typeof o.url === "string" ? o.url : "", alt: typeof o.alt === "string" ? o.alt : "" };
    }
    default:
      return typeof v === "string" ? v : "";
  }
}

/** État de saisie → valeur envoyée (vide = suppression). */
function fromDraft(def: MetafieldDefinitionDTO, d: unknown): unknown {
  switch (def.type) {
    case "dimension":
    case "weight": {
      const o = d as { value: string; unit: string };
      return o.value.trim() === "" ? null : { value: o.value, unit: o.unit };
    }
    case "image": {
      const o = d as { url: string; alt: string };
      return o.url.trim() === "" ? null : { url: o.url.trim(), ...(o.alt.trim() ? { alt: o.alt.trim() } : {}) };
    }
    case "money":
      return typeof d === "string" && d.trim() !== "" ? { amount: d.replace(/[\s  ]/g, "") } : null;
    default:
      return isEmptyInput(d) ? null : d;
  }
}

export function MetafieldsEditorClient({
  storeId,
  ownerType,
  ownerId,
  currency,
  definitions,
  initialValues,
  products,
  collections,
  manageHref,
  locked,
  className,
}: {
  storeId: string;
  ownerType: MetafieldOwnerType;
  ownerId: string;
  currency: string;
  definitions: MetafieldDefinitionDTO[];
  initialValues: Record<string, unknown>;
  products: Option[];
  collections: Option[];
  manageHref: string | null;
  locked: boolean;
  className?: string;
}) {
  const initialDrafts = useMemo(() => Object.fromEntries(definitions.map((d) => [d.id, toDraft(d, initialValues[d.id])])), [definitions, initialValues]);
  const [drafts, setDrafts] = useState<Record<string, unknown>>(initialDrafts);
  const [saved, setSaved] = useState<Record<string, unknown>>(initialDrafts);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [pending, start] = useTransition();

  const pinned = definitions.filter((d) => d.pinnedPosition !== null);
  const others = definitions.filter((d) => d.pinnedPosition === null);
  // Sans champ épinglé, tout est affiché ; sinon, les autres champs sont repliés (sauf s'ils ont une valeur).
  const visibleOthers = pinned.length === 0 || showAll ? others : others.filter((d) => !isEmptyInput(fromDraft(d, drafts[d.id])));
  const hiddenCount = others.length - visibleOthers.length;
  const changed = definitions.filter((d) => JSON.stringify(drafts[d.id]) !== JSON.stringify(saved[d.id]));

  const set = (id: string, v: unknown) => {
    setDrafts((s) => ({ ...s, [id]: v }));
    setErrors((e) => {
      if (!e[id]) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  };

  const save = () => {
    const values: Record<string, unknown> = {};
    const local: Record<string, string> = {};
    for (const d of changed) {
      const v = fromDraft(d, drafts[d.id]);
      if (!isEmptyInput(v)) {
        const check = validateMetafieldValue(d, v, { currency });
        if (!check.ok) local[d.id] = check.error;
      }
      values[d.id] = v;
    }
    if (Object.keys(local).length) {
      setErrors(local);
      setFormError("Corrigez les champs signalés.");
      return;
    }
    start(async () => {
      const r = await saveMetafieldValues(storeId, { ownerType, ownerId, values });
      if (r.ok) {
        setSaved(drafts);
        setErrors({});
        setFormError(null);
        toast.success(r.message ?? "Enregistré");
      } else {
        setFormError(r.error);
        setErrors(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
      }
    });
  };

  const titleId = `mf-${ownerId}-title`;
  return (
    <Card as="section" className={className} aria-labelledby={titleId}>
      <CardHeader
        title={<span id={titleId} className="inline-flex items-center gap-2"><SlidersHorizontal className="size-4 text-primary" aria-hidden /> Champs personnalisés</span>}
        description="Informations propres à votre activité, affichables dans la boutique selon le réglage de chaque champ."
        action={manageHref ? <Link href={manageHref} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">Gérer les champs</Link> : undefined}
      />
      <CardBody>
        {locked && (
          <Alert tone="warning" className="mb-4">
            Votre plan n&apos;inclut plus les champs personnalisés : les valeurs restent affichées mais ne sont plus modifiables.{" "}
            <Link href={`/app/${storeId}/abonnement#plans`} className="font-medium underline underline-offset-4">Voir les plans</Link>
          </Alert>
        )}
        {formError && <Alert tone="danger" className="mb-4">{formError}</Alert>}
        <fieldset disabled={locked || pending} className="grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-2">
          <legend className="sr-only">Champs personnalisés</legend>
          {[...pinned, ...visibleOthers].map((d) => (
            <MetafieldInput key={d.id} def={d} storeId={storeId} purpose={UPLOAD_PURPOSE[ownerType]} currency={currency} value={drafts[d.id]} error={errors[d.id]} onChange={(v) => set(d.id, v)} products={products} collections={collections} />
          ))}
        </fieldset>
        {hiddenCount > 0 && (
          <button type="button" onClick={() => setShowAll(true)} className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary">
            <ChevronDown className="size-4" aria-hidden /> Afficher les autres champs ({hiddenCount})
          </button>
        )}
        {!locked && (
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            {changed.length > 0 && <span className="text-sm text-ink-muted" aria-live="polite">{changed.length} modification{changed.length > 1 ? "s" : ""} non enregistrée{changed.length > 1 ? "s" : ""}</span>}
            <Button onClick={save} loading={pending} disabled={changed.length === 0}>
              Enregistrer les champs
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function MetafieldInput({
  def,
  storeId,
  purpose,
  currency,
  value,
  error,
  onChange,
  products,
  collections,
}: {
  def: MetafieldDefinitionDTO;
  storeId: string;
  purpose: UploadPurpose;
  currency: string;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  products: Option[];
  collections: Option[];
}) {
  const id = `mf-${def.id}`;
  const v = def.validations;
  const hint = def.description ?? (v.choices?.length ? undefined : METAFIELD_TYPE_META[def.type].label);
  const wide = def.type === "multi_line_text" || def.type === "rich_text" || def.type === "image" || (def.type === "list_single_line_text" && !v.choices?.length);
  const label = (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {def.name}
      <span className="font-mono text-[11px] font-normal text-ink-faint">{def.namespace}.{def.key}</span>
    </span>
  );
  const str = typeof value === "string" ? value : "";

  const control = (p: { id: string; "aria-describedby"?: string; invalid: boolean }) => {
    switch (def.type) {
      case "single_line_text":
        return v.choices?.length ? (
          <Select {...p} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">Non renseigné</option>
            {v.choices.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        ) : (
          <Input {...p} value={str} maxLength={v.max ?? 255} onChange={(e) => onChange(e.target.value)} />
        );
      case "multi_line_text":
      case "rich_text":
        return <Textarea {...p} value={str} className="min-h-24" maxLength={v.max ?? (def.type === "rich_text" ? 10_000 : 5_000)} onChange={(e) => onChange(e.target.value)} />;
      case "list_single_line_text":
        if (v.choices?.length) {
          const list = Array.isArray(value) ? (value as string[]) : [];
          return (
            <div id={p.id} aria-describedby={p["aria-describedby"]} role="group" className="flex flex-wrap gap-2 pt-1">
              {v.choices.map((c) => {
                const on = list.includes(c);
                return (
                  <label key={c} className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3.5 text-sm ring-1 ring-line", on && "bg-primary/10 ring-primary")}>
                    <input type="checkbox" className="size-4 accent-[var(--c-primary)]" checked={on} onChange={(e) => onChange(e.target.checked ? [...list, c] : list.filter((x) => x !== c))} />
                    {c}
                  </label>
                );
              })}
            </div>
          );
        }
        return <Textarea {...p} value={str} className="min-h-24" placeholder="Un élément par ligne" onChange={(e) => onChange(e.target.value)} />;
      case "integer":
      case "decimal":
      case "rating":
        return <Input {...p} type="number" inputMode={def.type === "integer" ? "numeric" : "decimal"} step={def.type === "integer" ? 1 : def.type === "rating" ? 0.5 : "any"} min={v.min} max={v.max} value={str} onChange={(e) => onChange(e.target.value)} />;
      case "money":
        return (
          <div className="flex items-center gap-2">
            <Input {...p} inputMode="numeric" value={str} onChange={(e) => onChange(e.target.value)} />
            <span className="shrink-0 text-sm text-ink-muted">{currency === "XOF" || currency === "XAF" ? "FCFA" : `${currency} (centimes)`}</span>
          </div>
        );
      case "boolean":
        return (
          <Select {...p} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">Non renseigné</option>
            <option value="true">Oui</option>
            <option value="false">Non</option>
          </Select>
        );
      case "date":
        return <Input {...p} type="date" value={str} onChange={(e) => onChange(e.target.value)} />;
      case "color":
        return (
          <div className="flex items-center gap-2">
            <input type="color" aria-label={`${def.name} : sélecteur`} className="size-12 shrink-0 cursor-pointer rounded-[var(--radius-md)] ring-1 ring-line" value={/^#[0-9a-f]{6}$/i.test(str) ? str : "#000000"} onChange={(e) => onChange(e.target.value)} />
            <Input {...p} value={str} placeholder="#0d3b2e" maxLength={7} onChange={(e) => onChange(e.target.value)} />
          </div>
        );
      case "url":
        return <Input {...p} type="text" inputMode="url" value={str} placeholder="https://… ou /catalogue" onChange={(e) => onChange(e.target.value)} />;
      case "product_reference":
      case "collection_reference": {
        const list = def.type === "product_reference" ? products : collections;
        return (
          <Select {...p} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">Aucun</option>
            {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        );
      }
      case "dimension":
      case "weight": {
        const o = (value ?? { value: "", unit: "" }) as { value: string; unit: string };
        const units = def.type === "dimension" ? DIMENSION_UNITS : WEIGHT_UNITS;
        return (
          <div className="flex items-center gap-2">
            <Input {...p} type="number" inputMode="decimal" min={0} step="any" value={o.value} onChange={(e) => onChange({ ...o, value: e.target.value })} />
            <Select aria-label={`${def.name} : unité`} className="w-28 shrink-0" value={o.unit} onChange={(e) => onChange({ ...o, unit: e.target.value })}>
              {units.map((u) => <option key={u} value={u}>{UNIT_LABEL[u] ?? u}</option>)}
            </Select>
          </div>
        );
      }
      case "image":
        return <ImageInput p={p} def={def} storeId={storeId} purpose={purpose} value={(value ?? { url: "", alt: "" }) as { url: string; alt: string }} onChange={onChange} />;
    }
  };

  return (
    <Field id={id} label={label} hint={hint} error={error} className={wide ? "md:col-span-2" : undefined}>
      {(p) => control(p)}
    </Field>
  );
}

function ImageInput({ p, def, storeId, purpose, value, onChange }: { p: { id: string; "aria-describedby"?: string; invalid: boolean }; def: MetafieldDefinitionDTO; storeId: string; purpose: UploadPurpose; value: { url: string; alt: string }; onChange: (v: unknown) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await compressPhoto(file);
      const up = await uploadImage(storeId, purpose, blob);
      onChange({ ...value, url: up.url });
    } catch (e) {
      toast.error("Image non importée", e instanceof Error ? e.message : undefined);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="relative size-24 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-surface-2 ring-1 ring-line">
        {value.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.url} alt={value.alt || ""} className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-ink-faint"><ImagePlus className="size-6" aria-hidden /></span>
        )}
        {value.url && (
          <button type="button" onClick={() => onChange({ url: "", alt: "" })} aria-label={`Retirer l'image ${def.name}`} className="absolute right-1 top-1 inline-flex size-8 items-center justify-center rounded-full bg-surface/90 text-ink ring-1 ring-line">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="flex-1 space-y-2">
        <Input {...p} value={value.url} placeholder="https://… ou importez un fichier" onChange={(e) => onChange({ ...value, url: e.target.value })} />
        <Input aria-label={`${def.name} : texte alternatif`} value={value.alt} maxLength={200} placeholder="Texte alternatif (description de l'image)" onChange={(e) => onChange({ ...value, alt: e.target.value })} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
        <Button type="button" variant="outline" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
          <ImagePlus className="size-4" aria-hidden /> Importer une image
        </Button>
      </div>
    </div>
  );
}

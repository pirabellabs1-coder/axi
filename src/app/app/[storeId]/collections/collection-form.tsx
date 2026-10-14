"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X, ChevronUp, ChevronDown, ImagePlus, Search, GripVertical, ImageOff, Wand2, Hand } from "lucide-react";
import { saveCollection, deleteCollection } from "@/lib/collections/actions";
import { CONDITION_FIELDS, FIELD_LABELS, FIELD_OPS, SORT_LABELS, SORT_ORDERS, matchesRules, sortProducts, type Condition, type ConditionField, type SortOrder } from "@/lib/collections/rules";
import { compressPhoto, uploadImage, UploadFailedError } from "@/lib/storage/client";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn, slugify } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { thumbUrl } from "@/lib/image-loader";

export type CollectionProductLite = {
  id: string;
  name: string;
  price: number;
  promoPrice: number | null;
  promoStart: string | null;
  promoEnd: string | null;
  compareAtPrice: number | null;
  tags: string[];
  productType: string | null;
  vendor: string | null;
  categoryId: string | null;
  createdAt: string;
  position: number;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  /** Prix / prix barré des variantes (conditions Prix et En promotion, comme la boutique). */
  variants: { price: number | null; compareAtPrice: number | null }[];
  thumb: string | null;
};

export type CollectionFormValues = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  imageUrl: string | null;
  seoTitle: string;
  seoDescription: string;
  published: boolean;
  sortOrder: SortOrder;
  type: "manual" | "auto";
  match: "all" | "any";
  conditions: Condition[];
  productIds: string[];
};

const iconBtn =
  "inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-[background-color,color,transform] hover:bg-surface-2 hover:text-ink active:scale-[0.96] disabled:opacity-30 disabled:hover:bg-transparent sm:size-9";

const hydrate = (p: CollectionProductLite) => ({
  ...p,
  promoStart: p.promoStart ? new Date(p.promoStart) : null,
  promoEnd: p.promoEnd ? new Date(p.promoEnd) : null,
  createdAt: new Date(p.createdAt),
});

export function CollectionForm({ storeId, storeSlug, currency, initial, products }: { storeId: string; storeSlug: string; currency: string; initial: CollectionFormValues; products: CollectionProductLite[] }) {
  const router = useRouter();
  const isEdit = !!initial.id;
  const [v, setV] = useState(initial);
  const [snapshot, setSnapshot] = useState(JSON.stringify(initial));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [query, setQuery] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageUpload, setImageUpload] = useState<number | null>(null); // progression 0..1 de l'envoi en cours
  const set = (p: Partial<CollectionFormValues>) => setV((c) => ({ ...c, ...p }));
  const dirty = JSON.stringify(v) !== snapshot;
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const hydrated = useMemo(() => products.map(hydrate), [products]);

  useEffect(() => {
    if (!slugTouched) set({ slug: slugify(v.name) });
  }, [v.name, slugTouched]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /* Aperçu des produits de la collection (même logique que le serveur). */
  const members = useMemo(() => {
    if (v.type === "auto") {
      const valid = v.conditions.filter((c) => c.field === "promo" || c.value.trim());
      if (!valid.length) return [];
      return sortProducts(
        hydrated.filter((p) => p.status !== "ARCHIVED" && matchesRules(p, { type: "auto", match: v.match, conditions: valid })),
        v.sortOrder,
      );
    }
    const list = v.productIds.map((id) => hydrated.find((p) => p.id === id)).filter((p): p is (typeof hydrated)[number] => !!p);
    return v.sortOrder === "manual" ? list : sortProducts(list, v.sortOrder);
  }, [v, hydrated]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => !v.productIds.includes(p.id) && p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, products, v.productIds]);

  const moveProduct = (from: number, to: number) => {
    if (to < 0 || to >= v.productIds.length) return;
    const ids = [...v.productIds];
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x);
    set({ productIds: ids, sortOrder: "manual" });
  };

  const onImage = async (f: File | null) => {
    if (!f) return;
    setImageUpload(0);
    try {
      const blob = await compressPhoto(f);
      const up = await uploadImage(storeId, "collection", blob, { onProgress: setImageUpload });
      set({ imageUrl: up.url });
    } catch (e) {
      toast.error("Image non ajoutée", e instanceof UploadFailedError ? e.message : "Image illisible ou trop lourde.");
    } finally {
      setImageUpload(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = () =>
    start(async () => {
      setFormError(null);
      const res = await saveCollection(storeId, {
        id: v.id,
        name: v.name,
        slug: v.slug,
        description: v.description,
        imageUrl: v.imageUrl,
        seoTitle: v.seoTitle || null,
        seoDescription: v.seoDescription || null,
        published: v.published,
        sortOrder: v.sortOrder,
        rules: v.type === "auto" ? { type: "auto", match: v.match, conditions: v.conditions } : { type: "manual", productIds: v.productIds },
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        toast.error("Enregistrement impossible", res.error);
        return;
      }
      setErrors({});
      setSnapshot(JSON.stringify(v));
      toast.success(res.message ?? "Enregistré");
      if (!isEdit && res.data) router.replace(`/app/${storeId}/collections/${res.data.id}`);
      else router.refresh();
    });

  const err = (k: string) => errors[k]?.[0];

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {formError && (
        <Alert tone="danger" className="mb-4" title="La collection n'a pas été enregistrée">
          {formError}
        </Alert>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardBody className="space-y-4">
              <Field id="col-name" label="Titre" required error={err("name")}>
                {(p) => <Input {...p} value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} placeholder="Ex. Nouveautés wax" />}
              </Field>
              <Field id="col-desc" label="Description" hint="Affichée en tête de la page de la collection." error={err("description")}>
                {(p) => <Textarea {...p} value={v.description} onChange={(e) => set({ description: e.target.value })} rows={4} maxLength={2000} />}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Type de collection" />
            <CardBody className="space-y-4">
              <fieldset>
                <legend className="sr-only">Type de collection</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      { id: "manual", icon: Hand, title: "Manuelle", text: "Vous choisissez les produits un par un et leur ordre." },
                      { id: "auto", icon: Wand2, title: "Automatique", text: "Les produits qui remplissent les conditions sont ajoutés tout seuls." },
                    ] as const
                  ).map((o) => (
                    <label key={o.id} className={cn("flex cursor-pointer gap-3 rounded-[var(--radius-md)] p-3 ring-1 ring-inset transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary", v.type === o.id ? "bg-primary-soft/50 ring-primary" : "ring-line-strong hover:bg-surface-2")}>
                      <input type="radio" name="col-type" value={o.id} checked={v.type === o.id} onChange={() => set({ type: o.id, sortOrder: o.id === "auto" && v.sortOrder === "manual" ? "newest" : v.sortOrder, conditions: o.id === "auto" && v.conditions.length === 0 ? [{ field: "tag", op: "eq", value: "" }] : v.conditions })} className="mt-1 size-4 accent-[var(--c-primary)]" />
                      <span>
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                          <o.icon className="size-4 text-primary" aria-hidden /> {o.title}
                        </span>
                        <span className="block text-[13px] text-ink-muted">{o.text}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {v.type === "auto" && (
                <div className="space-y-3">
                  <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <legend className="mb-1 w-full text-sm font-medium text-ink">Les produits doivent remplir</legend>
                    {(["all", "any"] as const).map((m) => (
                      <label key={m} className="inline-flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-0">
                        <input type="radio" name="col-match" checked={v.match === m} onChange={() => set({ match: m })} className="size-4 accent-[var(--c-primary)]" />
                        {m === "all" ? "toutes les conditions" : "au moins une condition"}
                      </label>
                    ))}
                  </fieldset>
                  <ul className="space-y-2">
                    {v.conditions.map((c, i) => (
                      <ConditionRow
                        key={i}
                        index={i}
                        c={c}
                        onChange={(nc) => set({ conditions: v.conditions.map((x, j) => (j === i ? nc : x)) })}
                        onRemove={() => set({ conditions: v.conditions.filter((_, j) => j !== i) })}
                        canRemove={v.conditions.length > 1}
                      />
                    ))}
                  </ul>
                  {err("rules") && (
                    <p className="text-sm font-medium text-danger" role="alert">
                      {err("rules")}
                    </p>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => set({ conditions: [...v.conditions, { field: "tag", op: "eq", value: "" }] })} disabled={v.conditions.length >= 20}>
                    <Plus className="size-4" aria-hidden /> Ajouter une condition
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="Produits"
              description={v.type === "auto" ? "Aperçu en direct des produits qui remplissent les conditions." : "Glissez ou utilisez les flèches pour ordonner (tri manuel)."}
              action={<Badge tone="neutral">{members.length}</Badge>}
            />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field id="col-sort" label="Trier par" className="sm:max-w-60">
                  {(p) => (
                    <Select {...p} value={v.sortOrder} onChange={(e) => set({ sortOrder: e.target.value as SortOrder })}>
                      {SORT_ORDERS.filter((s) => v.type === "manual" || s !== "manual").map((s) => (
                        <option key={s} value={s}>
                          {SORT_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {v.type === "manual" && (
                  <div className="relative min-w-0 flex-1 basis-60">
                    <label htmlFor="col-search" className="mb-1.5 block text-sm font-medium text-ink">
                      Ajouter des produits
                    </label>
                    <Search className="pointer-events-none absolute bottom-3.5 left-3.5 size-4 text-ink-faint" aria-hidden />
                    <Input id="col-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un produit" className="pl-10" autoComplete="off" aria-controls="col-search-results" />
                    {searchResults.length > 0 && (
                      <ul id="col-search-results" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-[var(--radius-md)] bg-surface py-1 shadow-[var(--shadow-lg)] ring-1 ring-line">
                        {searchResults.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => {
                                set({ productIds: [...v.productIds, p.id] });
                                setQuery("");
                              }}
                              className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm hover:bg-surface-2"
                            >
                              <Thumb src={p.thumb} />
                              <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                              <Plus className="size-4 text-primary" aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              {members.length === 0 ? (
                <p className="rounded-[var(--radius-md)] bg-surface-2/40 px-4 py-6 text-center text-sm text-ink-muted ring-1 ring-inset ring-line">
                  {v.type === "auto" ? "Aucun produit ne remplit ces conditions pour le moment." : "Aucun produit. Recherchez-en un ci-dessus pour l'ajouter."}
                </p>
              ) : (
                <ol className="divide-y divide-line rounded-[var(--radius-md)] ring-1 ring-line">
                  {members.slice(0, 200).map((p, i) => {
                    const manualIdx = v.productIds.indexOf(p.id);
                    const reorderable = v.type === "manual" && v.sortOrder === "manual";
                    return (
                      <li
                        key={p.id}
                        draggable={reorderable}
                        onDragStart={() => setDragId(p.id)}
                        onDragOver={(e) => reorderable && dragId && e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragId) moveProduct(v.productIds.indexOf(dragId), manualIdx);
                          setDragId(null);
                        }}
                        onDragEnd={() => setDragId(null)}
                        className={cn("flex items-center gap-3 px-3 py-2", dragId === p.id && "opacity-40")}
                      >
                        {reorderable && <GripVertical className="size-4 shrink-0 cursor-grab text-ink-faint" aria-hidden />}
                        <span className="tabular w-6 text-right text-xs text-ink-faint">{i + 1}</span>
                        <Thumb src={p.thumb} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                          <span className="tabular text-xs text-ink-muted">
                            {formatMoney(p.price, currency)}
                            {p.status !== "ACTIVE" && <Badge tone="neutral" className="ml-2">{p.status === "DRAFT" ? "Brouillon" : "Archivé"}</Badge>}
                          </span>
                        </span>
                        {reorderable && (
                          <>
                            <button type="button" className={iconBtn} onClick={() => moveProduct(manualIdx, manualIdx - 1)} disabled={manualIdx === 0} aria-label={`Monter ${p.name}`}>
                              <ChevronUp className="size-4" aria-hidden />
                            </button>
                            <button type="button" className={iconBtn} onClick={() => moveProduct(manualIdx, manualIdx + 1)} disabled={manualIdx === v.productIds.length - 1} aria-label={`Descendre ${p.name}`}>
                              <ChevronDown className="size-4" aria-hidden />
                            </button>
                          </>
                        )}
                        {v.type === "manual" && (
                          <button type="button" className={cn(iconBtn, "hover:bg-danger-soft hover:text-danger")} onClick={() => set({ productIds: v.productIds.filter((x) => x !== p.id) })} aria-label={`Retirer ${p.name} de la collection`}>
                            <X className="size-4" aria-hidden />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Publication" />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-ink">Publiée</p>
                  <p className="text-xs text-ink-muted">Visible dans la boutique et les menus.</p>
                </div>
                <Switch label="Publiée" checked={v.published} onChange={(c) => set({ published: c })} />
              </div>
              {isEdit && v.published && (
                <a href={`/s/${storeSlug}/collections/${v.slug}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
                  Voir en boutique
                </a>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Image" />
            <CardBody>
              {v.imageUrl ? (
                <div className="relative overflow-hidden rounded-[var(--radius-md)] ring-1 ring-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.imageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                  <button type="button" onClick={() => set({ imageUrl: null })} className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-full bg-surface/95 text-ink ring-1 ring-line hover:text-danger" aria-label="Retirer l'image">
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={imageUpload !== null}
                  aria-busy={imageUpload !== null}
                  className="flex w-full flex-col items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-line-strong bg-surface-2/40 py-8 text-sm text-ink-muted hover:border-primary hover:text-ink disabled:opacity-70"
                >
                  <ImagePlus className="size-5 text-primary" aria-hidden />
                  {imageUpload === null ? "Ajouter une image" : `Envoi · ${Math.round(imageUpload * 100)} %`}
                  {imageUpload !== null && (
                    <span role="progressbar" aria-label="Envoi de l'image" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(imageUpload * 100)} className="block h-1 w-40 overflow-hidden rounded-full bg-line">
                      <span className="block h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${Math.round(imageUpload * 100)}%` }} />
                    </span>
                  )}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onImage(e.target.files?.[0] ?? null)} />
              {err("imageUrl") && <p className="mt-2 text-sm text-danger">{err("imageUrl")}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Référencement" />
            <CardBody className="space-y-4">
              <div className="rounded-[var(--radius-md)] bg-surface-2/40 p-3 ring-1 ring-inset ring-line">
                <p className="truncate text-xs text-ink-muted">
                  {storeSlug} › collections › {v.slug || "adresse"}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[15px] font-medium text-info">{v.seoTitle || v.name || "Titre de la collection"}</p>
                <p className="mt-0.5 line-clamp-3 text-[13px] text-ink-muted">{(v.seoDescription || v.description).slice(0, 160) || "Ajoutez une description."}</p>
              </div>
              <Field id="col-seo-title" label="Titre de la page" hint={`${v.seoTitle.length} / 70`} error={err("seoTitle")}>
                {(p) => <Input {...p} value={v.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} maxLength={70} />}
              </Field>
              <Field id="col-seo-desc" label="Méta-description" hint={`${v.seoDescription.length} / 320`} error={err("seoDescription")}>
                {(p) => <Textarea {...p} value={v.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} maxLength={320} rows={3} />}
              </Field>
              <Field id="col-slug" label="Adresse (URL)" error={err("slug")}>
                {(p) => (
                  <Input
                    {...p}
                    value={v.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set({ slug: slugify(e.target.value) });
                    }}
                    className="font-mono text-sm"
                  />
                )}
              </Field>
            </CardBody>
          </Card>
          {isEdit && (
            <ConfirmButton
              title="Supprimer cette collection ?"
              description="Les produits sont conservés ; ils perdent seulement leur rattachement à cette collection."
              confirmLabel="Supprimer"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-medium text-danger ring-1 ring-inset ring-danger/30 transition-colors hover:bg-danger-soft"
              onConfirm={async () => {
                const r = await deleteCollection(storeId, v.id!);
                if (r.ok) {
                  setSnapshot(JSON.stringify(v));
                  toast.success(r.message ?? "Supprimée");
                  router.replace(`/app/${storeId}/collections`);
                } else toast.error("Suppression impossible", r.error);
              }}
            >
              Supprimer la collection
            </ConfirmButton>
          )}
        </aside>
      </div>

      <div className={cn("sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mt-6 transition-[opacity,transform] duration-200 ease-out lg:bottom-4", dirty || !isEdit ? "opacity-100" : "pointer-events-none translate-y-3 opacity-0")} aria-hidden={!(dirty || !isEdit)}>
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-forest px-4 py-3 text-white shadow-[var(--shadow-lg)] ring-1 ring-white/10">
          <p className="mr-auto text-sm font-medium" role="status">
            {dirty ? "Modifications non enregistrées" : "Nouvelle collection"}
          </p>
          {isEdit && (
            <Button type="button" variant="inverse" size="sm" onClick={() => setV(JSON.parse(snapshot))} disabled={!dirty || pending} tabIndex={dirty ? 0 : -1}>
              Annuler
            </Button>
          )}
          <Button type="submit" variant="accent" size="sm" loading={pending} disabled={isEdit && !dirty} tabIndex={dirty || !isEdit ? 0 : -1}>
            {isEdit ? "Enregistrer" : "Créer la collection"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ConditionRow({ index, c, onChange, onRemove, canRemove }: { index: number; c: Condition; onChange: (c: Condition) => void; onRemove: () => void; canRemove: boolean }) {
  const ops = FIELD_OPS[c.field];
  return (
    <li className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] bg-surface-2/40 p-2 ring-1 ring-inset ring-line sm:grid-cols-[160px_170px_minmax(0,1fr)_auto] sm:items-center">
      <Select
        aria-label={`Champ de la condition ${index + 1}`}
        value={c.field}
        onChange={(e) => {
          const field = e.target.value as ConditionField;
          onChange({ field, op: FIELD_OPS[field][0].op, value: field === "promo" ? "true" : "" });
        }}
        className="h-11"
      >
        {CONDITION_FIELDS.map((f) => (
          <option key={f} value={f}>
            {FIELD_LABELS[f]}
          </option>
        ))}
      </Select>
      <Select aria-label={`Opérateur de la condition ${index + 1}`} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as Condition["op"] })} className="h-11">
        {ops.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </Select>
      {c.field === "promo" ? (
        <Select aria-label={`Valeur de la condition ${index + 1}`} value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} className="h-11">
          <option value="true">oui</option>
          <option value="false">non</option>
        </Select>
      ) : (
        <Input
          aria-label={`Valeur de la condition ${index + 1}`}
          value={c.value}
          onChange={(e) => onChange({ ...c, value: c.field === "price" ? e.target.value.replace(/[^\d]/g, "") : e.target.value })}
          inputMode={c.field === "price" ? "numeric" : undefined}
          placeholder={c.field === "price" ? "10000" : c.field === "tag" ? "wax" : ""}
          className="h-11"
          maxLength={80}
        />
      )}
      <button type="button" onClick={onRemove} disabled={!canRemove} className={cn(iconBtn, "justify-self-end hover:bg-danger-soft hover:text-danger")} aria-label={`Supprimer la condition ${index + 1}`}>
        <Trash2 className="size-4" aria-hidden />
      </button>
    </li>
  );
}

function Thumb({ src }: { src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={thumbUrl(src, 80)} alt="" width={36} height={36} loading="lazy" className="size-9 shrink-0 rounded-[8px] object-cover ring-1 ring-line" />
  ) : (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 text-ink-faint ring-1 ring-inset ring-line" aria-hidden>
      <ImageOff className="size-3.5" />
    </span>
  );
}


"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Star, Info, Search, ChevronDown } from "lucide-react";
import { saveProduct } from "@/lib/products/actions";
import { kindRequiresShipping, kindTracksStock, type ProductKindValue } from "@/lib/digital/kinds";
import { DigitalFiles, type DigitalAssetRow } from "./digital-files";
import { ProductKindBar, ProductKindStep } from "./kind-picker";
import { SERVER_MAX_IMAGES, type DetailInput, type ImageInput, type OptionGroupInput, type ProductPayload } from "@/lib/products/schemas";
import { MAX_VARIANTS, buildVariantMatrix, countCombinations, variantName, type ProductOption, type VariantDraft } from "@/lib/products/variants";
import { markdownToText } from "@/lib/products/markdown";
import { cn, slugify } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { Field, Input, Select, Switch, Label, Hint, Textarea, Checkbox } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { PlanGate } from "@/components/app/plan-gate";
import { AiDescribeButton } from "@/components/app/ai-describe-button";
import { toast } from "@/components/ui/toast";
import { RichTextEditor } from "./rich-text-editor";
import { MediaManager } from "./media-manager";
import { TagInput } from "./tag-input";
import { OptionsEditor, VariantsTable, type OptionsChange } from "./variants-editor";
import { SupplementsEditor, DetailsEditor, type GroupRow } from "./extras-editors";

export type ProductFormValues = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  isFeatured: boolean;
  categoryId: string;
  collectionIds: string[];
  productType: string;
  vendor: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  price: string;
  compareAtPrice: string;
  costPrice: string;
  promoPrice: string;
  promoStart: string;
  promoEnd: string;
  sku: string;
  /** Code-barres d'un produit sans variante (EAN, UPC, ISBN). */
  barcode: string;
  trackStock: boolean;
  stock: string;
  /** Stock lu à l'ouverture de la fiche : le serveur applique (saisie − base) pour ne pas écraser les ventes intercalées. */
  stockBase?: number | null;
  /** « Continuer à vendre en cas de rupture » (produit sans variante ; avec variantes : valeur appliquée aux nouvelles). */
  inventoryPolicy: "DENY" | "CONTINUE";
  /** Seuil d'alerte « stock bas » du produit ; vide = seuil par défaut de la boutique. */
  lowStockThreshold: string;
  minQty: string;
  maxQty: string;
  weightGrams: string;
  images: ImageInput[];
  options: ProductOption[];
  variants: VariantDraft[];
  optionGroups: OptionGroupInput[];
  details: DetailInput[];
  /** Lot 1 : carte cadeau (variantes = valeurs faciales, pas de stock). */
  isGiftCard: boolean;
  /** Validité des cartes émises en jours ; vide = 365. */
  giftCardValidityDays: string;
  /** Vague 2 : nature du produit (physique, numérique, service, carte cadeau). */
  kind: ProductKindValue;
  /** Numérique : téléchargements autorisés par commande (vide = 5, « 0 » = illimité). */
  downloadLimit: string;
  /** Numérique : validité du lien en jours (vide = 365, « 0 » = sans expiration). */
  downloadValidityDays: string;
  /** Service : durée en minutes, lieu, à distance, note de réservation. */
  serviceDurationMinutes: string;
  serviceLocation: string;
  serviceRemote: boolean;
  serviceBookingNote: string;
  /** Numérique et service : instructions envoyées après l'achat. */
  postPurchaseInstructions: string;
};

export type ProductFormFeatures = {
  stockTracking: boolean;
  variants: boolean;
  options: boolean;
  giftCards: boolean;
  /** Vague 2 : produits numériques et services (fonction de plan `digitalProducts`). */
  digitalProducts: boolean;
  photosPerProduct: number;
  planName: string;
  canUpgrade: boolean;
};

export type CollectionChoice = { id: string; name: string; auto: boolean };

export const EMPTY_PRODUCT: ProductFormValues = {
  name: "", slug: "", description: "", status: "ACTIVE", isFeatured: false, categoryId: "", collectionIds: [], productType: "", vendor: "", tags: [], seoTitle: "", seoDescription: "",
  price: "", compareAtPrice: "", costPrice: "", promoPrice: "", promoStart: "", promoEnd: "", sku: "", barcode: "", trackStock: false, stock: "0", inventoryPolicy: "DENY", lowStockThreshold: "", minQty: "1", maxQty: "", weightGrams: "",
  images: [], options: [], variants: [], optionGroups: [], details: [], isGiftCard: false, giftCardValidityDays: "",
  kind: "PHYSICAL", downloadLimit: "", downloadValidityDays: "", serviceDurationMinutes: "", serviceLocation: "", serviceRemote: false, serviceBookingNote: "", postPurchaseInstructions: "",
};

const STATUS_HINT: Record<ProductFormValues["status"], string> = {
  ACTIVE: "Visible dans votre boutique et commandable.",
  DRAFT: "Masqué de la boutique, modifiable à tout moment.",
  ARCHIVED: "Retiré de la boutique et de la liste par défaut.",
};

const int = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(/[^\d]/g, "")));
const digits = (s: string) => s.replace(/[^\d]/g, "");
/** Stock : garde le signe (une survente relue telle quelle reste négative ; le serveur refuse une saisie négative). */
const signedInt = (s: string): number | null => {
  const t = s.trim();
  if (t === "" || t === "-") return null;
  const n = Number(t.replace(/[^\d-]/g, "").replace(/(?!^)-/g, ""));
  return Number.isFinite(n) ? n : null;
};
const signedDigits = (s: string) => s.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "");

/** Applique renommages d'option / de valeurs aux variantes avant de recalculer la matrice. */
function remapVariants(variants: VariantDraft[], change?: OptionsChange): VariantDraft[] {
  if (!change?.optionRename) return variants;
  const { from, to } = change.optionRename;
  return variants.map((v) => {
    if (!(from in v.attributes)) return v;
    const attrs: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.attributes)) attrs[k === from ? to : k] = val;
    return { ...v, attributes: attrs };
  });
}

export function ProductForm({
  storeId,
  storeSlug,
  currency,
  collections,
  autoCollections = [],
  suggestions,
  initial,
  presetCollectionId,
  features,
  storeLowStockThreshold = 5,
  digitalAssets = [],
  header,
}: {
  storeId: string;
  storeSlug: string;
  currency: string;
  collections: CollectionChoice[];
  autoCollections?: string[];
  suggestions: { tags: string[]; types: string[]; vendors: string[] };
  initial?: ProductFormValues;
  presetCollectionId?: string;
  features: ProductFormFeatures;
  /** Seuil « stock bas » par défaut de la boutique (affiché quand le produit n'a pas le sien). */
  storeLowStockThreshold?: number;
  /** Vague 2 : fichiers déjà attachés au produit (produit numérique). */
  digitalAssets?: DigitalAssetRow[];
  /**
   * En-tête de la page, rendu APRÈS l'étape « Que vendez-vous ? » à la création : le commerçant choisit
   * le type avant de lire le titre et de remplir quoi que ce soit.
   */
  header?: ReactNode;
}) {
  const router = useRouter();
  const start0 = initial ?? { ...EMPTY_PRODUCT, categoryId: presetCollectionId ?? "" };
  const isEdit = !!start0.id;
  const [v, setV] = useState<ProductFormValues>(start0);
  const [groups, setGroups] = useState<GroupRow[]>(() => start0.optionGroups.map((g, i) => ({ ...g, key: g.id ?? `g${i}` })));
  const [snapshot, setSnapshot] = useState(() => JSON.stringify({ v: start0, g: start0.optionGroups }));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [seoOpen, setSeoOpen] = useState(false);
  // Fichiers vendus réellement attachés (mis à jour par la carte « Fichiers à remettre », sans recharger la page).
  const [fileCount, setFileCount] = useState(digitalAssets.length);
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);
  const maxPhotos = Math.max(1, Math.min(features.photosPerProduct, SERVER_MAX_IMAGES));

  const set = (patch: Partial<ProductFormValues>) => setV((cur) => ({ ...cur, ...patch }));
  const groupsPayload: OptionGroupInput[] = groups.map(({ key: _k, ...g }) => (void _k, g));
  const dirty = JSON.stringify({ v, g: groupsPayload }) !== snapshot;

  useEffect(() => {
    if (!slugTouched) set({ slug: slugify(v.name).slice(0, 120) });
  }, [v.name, slugTouched]);

  /* ── Avertissement en quittant sans enregistrer ── */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || e.metaKey || e.ctrlKey) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      if (!window.confirm("Vous avez des modifications non enregistrées. Quitter la page sans enregistrer ?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  /* ── Options → matrice des variantes ── */
  const setOptions = (next: ProductOption[], change?: OptionsChange) => {
    const n = countCombinations(next);
    if (n > MAX_VARIANTS) {
      toast.error("Trop de combinaisons", `${n} variantes : ${MAX_VARIANTS} maximum. Retirez des valeurs.`);
      return;
    }
    // Nouvelles combinaisons : politique de rupture du produit (réglage « appliquer à toutes »).
    setV((cur) => ({ ...cur, options: next, variants: buildVariantMatrix(next, remapVariants(cur.variants, change), change?.valueRenames).map((x) => (x.inventoryPolicy ? x : { ...x, inventoryPolicy: cur.inventoryPolicy })) }));
  };

  /** Retirer une image retire aussi ses usages (variantes, couleurs). */
  const setImages = (images: ImageInput[]) =>
    setV((cur) => {
      const urls = new Set(images.map((i) => i.url));
      return {
        ...cur,
        images,
        variants: cur.variants.map((x) => (x.imageUrl && !urls.has(x.imageUrl) ? { ...x, imageUrl: null } : x)),
        options: cur.options.map((o) => ({ ...o, values: o.values.map((x) => (x.image && !urls.has(x.image) ? { ...x, image: null } : x)) })),
      };
    });

  /* ── Calculs d'aperçu ── */
  const price = int(v.price) ?? 0;
  const cost = int(v.costPrice);
  const promo = int(v.promoPrice);
  const margin = cost != null && price > 0 ? { amount: price - cost, pct: Math.round(((price - cost) / price) * 100) } : null;
  const discount = promo != null && price > 0 && promo < price ? Math.round(100 - (promo / price) * 100) : null;
  const hasVariants = v.variants.length > 0;
  // Vague 2 : la nature du produit pilote le formulaire (stock, expédition, fichiers, service).
  const kind = v.kind;
  const tracksStock = kindTracksStock(kind);
  const ships = kindRequiresShipping(kind);
  const kindLocks = { digitalProducts: features.digitalProducts, giftCards: features.giftCards };
  /** Changer de nature remet à zéro ce qui n'a plus de sens (stock, poids, promo d'une carte cadeau). */
  const changeKind = (next: ProductKindValue) =>
    set({
      kind: next,
      isGiftCard: next === "GIFT_CARD",
      ...(kindTracksStock(next) ? {} : { trackStock: false }),
      ...(next === "GIFT_CARD" ? { promoPrice: "", promoStart: "", promoEnd: "" } : {}),
      ...(kindRequiresShipping(next) ? {} : { weightGrams: "" }),
    });
  const kindPlanGate = (kind === "DIGITAL" || kind === "SERVICE") && !features.digitalProducts ? <PlanGate storeId={storeId} feature="digitalProducts" compact /> : null;
  // Fichiers propres à une variante : la liste des combinaisons déjà enregistrées.
  const variantChoices = v.variants.map((x) => ({ id: x.id, name: variantName(x.attributes, v.options) }));
  const continueCount = v.variants.filter((x) => x.inventoryPolicy === "CONTINUE").length;
  const allContinue = hasVariants ? continueCount === v.variants.length : v.inventoryPolicy === "CONTINUE";
  /** « Appliquer à toutes » : produit + toutes ses variantes. */
  const setPolicyAll = (policy: "DENY" | "CONTINUE") => setV((cur) => ({ ...cur, inventoryPolicy: policy, variants: cur.variants.map((x) => ({ ...x, inventoryPolicy: policy })) }));
  const manualCollections = collections.filter((c) => !c.auto);
  const primaryName = manualCollections.find((c) => c.id === v.categoryId)?.name ?? null;
  const seoTitle = v.seoTitle.trim() || v.name.trim() || "Titre du produit";
  const seoDesc = (v.seoDescription.trim() || markdownToText(v.description)).slice(0, 160) || "Ajoutez une description pour indiquer aux moteurs de recherche ce que vous vendez.";
  const err = (k: string) => errors[k]?.[0];

  const buildPayload = (): ProductPayload => ({
    productId: v.id,
    name: v.name,
    slug: v.slug,
    description: v.description,
    status: v.status,
    isFeatured: v.isFeatured,
    categoryId: v.categoryId || null,
    collectionIds: v.collectionIds.filter((id) => id !== v.categoryId),
    productType: v.productType || null,
    vendor: v.vendor || null,
    tags: v.tags,
    seoTitle: v.seoTitle || null,
    seoDescription: v.seoDescription || null,
    price: int(v.price) ?? -1,
    compareAtPrice: int(v.compareAtPrice),
    costPrice: int(v.costPrice),
    promoPrice: int(v.promoPrice),
    promoStart: v.promoPrice && v.promoStart ? new Date(v.promoStart).toISOString() : null,
    promoEnd: v.promoPrice && v.promoEnd ? new Date(v.promoEnd).toISOString() : null,
    sku: v.sku || null,
    barcode: hasVariants ? null : v.barcode.trim() || null,
    trackStock: v.trackStock && features.stockTracking && kindTracksStock(v.kind),
    stock: signedInt(v.stock) ?? 0,
    stockBase: v.stockBase ?? null,
    inventoryPolicy: v.inventoryPolicy,
    lowStockThreshold: int(v.lowStockThreshold),
    minQty: int(v.minQty) ?? 1,
    maxQty: int(v.maxQty),
    weightGrams: int(v.weightGrams),
    images: v.images,
    options: v.options,
    variants: v.variants.map(({ key: _k, ...x }) => (void _k, x)),
    optionGroups: groupsPayload,
    details: v.details.filter((d) => d.title.trim() || d.body.trim()),
    isGiftCard: v.kind === "GIFT_CARD",
    giftCardValidityDays: v.kind === "GIFT_CARD" ? int(v.giftCardValidityDays) : null,
    kind: v.kind,
    downloadLimit: v.kind === "DIGITAL" ? int(v.downloadLimit) : null,
    downloadValidityDays: v.kind === "DIGITAL" ? int(v.downloadValidityDays) : null,
    serviceDurationMinutes: v.kind === "SERVICE" ? int(v.serviceDurationMinutes) : null,
    serviceLocation: v.kind === "SERVICE" ? v.serviceLocation.trim() || null : null,
    serviceRemote: v.kind === "SERVICE" ? v.serviceRemote : false,
    serviceBookingNote: v.kind === "SERVICE" ? v.serviceBookingNote.trim() || null : null,
    postPurchaseInstructions: v.kind === "DIGITAL" || v.kind === "SERVICE" ? v.postPurchaseInstructions.trim() || null : null,
  });

  const save = () => {
    setFormError(null);
    if (v.name.trim().length < 2) {
      setErrors({ name: ["Indiquez un titre (2 caractères minimum)"] });
      document.getElementById("name")?.focus();
      return;
    }
    if (int(v.price) == null) {
      setErrors({ price: ["Indiquez un prix"] });
      document.getElementById("price")?.focus();
      return;
    }
    startTransition(async () => {
      const res = await saveProduct(storeId, buildPayload());
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        toast.error("Enregistrement impossible", res.error);
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      setErrors({});
      // La saisie devient la nouvelle base (en attendant le rechargement) : un second enregistrement n'applique pas deux fois le delta.
      const saved: ProductFormValues = { ...v, stockBase: signedInt(v.stock) ?? 0, variants: v.variants.map((x) => (x.id ? { ...x, stockBase: x.stock } : x)) };
      setV(saved);
      setSnapshot(JSON.stringify({ v: saved, g: groupsPayload }));
      toast.success(res.message ?? "Enregistré");
      if (!isEdit && res.data) router.replace(`/app/${storeId}/produits/${res.data.productId}`);
      else router.refresh();
    });
  };

  const discard = () => {
    if (!window.confirm("Annuler toutes les modifications non enregistrées ?")) return;
    const parsed = JSON.parse(snapshot) as { v: ProductFormValues; g: OptionGroupInput[] };
    setV(parsed.v);
    setGroups(parsed.g.map((g, i) => ({ ...g, key: g.id ?? `g${i}` })));
    setErrors({});
    setFormError(null);
  };

  return (
    <>
      {/* Création : le type d'abord, avant le titre de la page et toute saisie. */}
      {!isEdit && (
        <ProductKindStep value={kind} onChange={changeKind} locks={kindLocks} storeId={storeId}>
          {kindPlanGate}
        </ProductKindStep>
      )}
      {header}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        aria-busy={pending}
      >
        {/* Édition : rappel du type en haut du formulaire, changement confirmé (conséquences listées). */}
        {isEdit && (
          <ProductKindBar
            value={kind}
            onChange={changeKind}
            locks={kindLocks}
            storeId={storeId}
            context={{
              trackStock: v.trackStock,
              hasFiles: fileCount > 0,
              weightSet: !!v.weightGrams.trim(),
              hasPromo: !!v.promoPrice.trim(),
              hasSupplements: groups.length > 0,
              existing: true,
            }}
          >
            {kindPlanGate}
          </ProductKindBar>
        )}
        <datalist id="option-presets">
          <option value="Couleur" />
          <option value="Taille" />
          <option value="Matière" />
          <option value="Pointure" />
          <option value="Longueur" />
        </datalist>
        {formError && (
          <div ref={errorRef} tabIndex={-1} className="mb-4 outline-none">
            <Alert tone="danger" title="Le produit n'a pas été enregistré">
              {formError}
            </Alert>
          </div>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_330px] xl:gap-6">
          {/* ─────────── Colonne principale ─────────── */}
          <div className="min-w-0 space-y-5">
            <Card>
              <CardBody className="space-y-4">
                <Field id="name" label="Titre" required error={err("name")}>
                  {(p) => <Input {...p} value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} placeholder="Ex. Robe wax Abomey" autoComplete="off" />}
                </Field>
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <Label id="description-label" className="mb-0">
                      Description
                    </Label>
                    <AiDescribeButton storeId={storeId} name={v.name} category={primaryName ?? v.productType} productId={v.id ?? null} onApply={({ description }) => set({ description })} />
                  </div>
                  <RichTextEditor id="description" value={v.description} onChange={(md) => set({ description: md })} labelledBy="description-label" describedBy="description-hint" invalid={!!err("description")} />
                  {err("description") ? <p className="mt-1.5 text-[13px] font-medium text-danger" role="alert">{err("description")}</p> : <Hint id="description-hint">Matières, coupe, tailles, délais. Vos clients lisent sur mobile : allez à l&apos;essentiel.</Hint>}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Médias" description="Compression automatique à 300 Ko. Glissez pour réordonner." />
              <CardBody>
                <MediaManager storeId={storeId} images={v.images} onChange={setImages} maxPhotos={maxPhotos} planName={features.planName} canUpgrade={features.canUpgrade} error={err("images")} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Prix" description={`Montants entiers en ${currency}.`} />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <Field id="price" label="Prix" required error={err("price")}>
                  {(p) => <Input {...p} inputMode="numeric" value={v.price} onChange={(e) => set({ price: digits(e.target.value) })} placeholder="15000" />}
                </Field>
                <Field id="compareAtPrice" label="Prix barré" hint="Prix avant remise, affiché barré. Doit être supérieur au prix." error={err("compareAtPrice")}>
                  {(p) => <Input {...p} inputMode="numeric" value={v.compareAtPrice} onChange={(e) => set({ compareAtPrice: digits(e.target.value) })} />}
                </Field>
                <Field id="costPrice" label="Coût par article" hint="Jamais affiché aux clients." error={err("costPrice")}>
                  {(p) => <Input {...p} inputMode="numeric" value={v.costPrice} onChange={(e) => set({ costPrice: digits(e.target.value) })} />}
                </Field>
                <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-md)] bg-surface-2/50 px-4 py-3 ring-1 ring-inset ring-line">
                  <div>
                    <p className="text-xs text-ink-muted">Marge</p>
                    <p className={cn("tabular text-[15px] font-semibold", margin && margin.pct < 0 ? "text-danger" : "text-ink")}>{margin ? `${margin.pct} %` : "–"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">Bénéfice</p>
                    <p className="tabular text-[15px] font-semibold text-ink">{margin ? formatMoney(margin.amount, currency) : "–"}</p>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Field id="promoPrice" label="Prix promotionnel" error={err("promoPrice")} hint={discount != null ? `Remise de ${discount} %. Laissez les dates vides pour une promotion sans limite.` : "Optionnel. Inférieur au prix ; datez la promotion si besoin."}>
                    {(p) => <Input {...p} inputMode="numeric" value={v.promoPrice} onChange={(e) => set({ promoPrice: digits(e.target.value) })} className="sm:max-w-60" />}
                  </Field>
                </div>
                {v.promoPrice && (
                  <>
                    <Field id="promoStart" label="Début de la promotion" error={err("promoStart")}>
                      {(p) => <Input {...p} type="datetime-local" value={v.promoStart} onChange={(e) => set({ promoStart: e.target.value })} />}
                    </Field>
                    <Field id="promoEnd" label="Fin de la promotion" error={err("promoEnd")}>
                      {(p) => <Input {...p} type="datetime-local" value={v.promoEnd} onChange={(e) => set({ promoEnd: e.target.value })} min={v.promoStart || undefined} />}
                    </Field>
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Inventaire" />
              <CardBody className="space-y-4">
                {kind === "GIFT_CARD" ? (
                  <p className="flex items-start gap-2 text-sm text-ink-muted">
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> Carte cadeau : pas de suivi de stock, chaque carte vendue est émise au paiement.
                  </p>
                ) : kind === "DIGITAL" ? (
                  <p className="flex items-start gap-2 text-sm text-ink-muted">
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> Produit numérique : pas de stock à suivre, les fichiers sont remis automatiquement après le paiement.
                  </p>
                ) : features.stockTracking ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] bg-surface-2/50 px-4 py-3 ring-1 ring-inset ring-line">
                    <div>
                      <p className="text-sm font-medium text-ink">{kind === "SERVICE" ? "Limiter le nombre de places" : "Suivre la quantité"}</p>
                      <p className="text-xs text-ink-muted">
                        {kind === "SERVICE"
                          ? "Facultatif : indiquez le nombre de places disponibles. À zéro, la prestation n'est plus réservable (sauf si vous continuez à vendre)."
                          : "Le produit (ou la variante) passe en rupture à zéro, sauf si vous continuez à vendre en rupture. Alerte sous le seuil choisi ci-dessous."}
                      </p>
                    </div>
                    <Switch label="Suivre" checked={v.trackStock} onChange={(c) => set({ trackStock: c })} />
                  </div>
                ) : (
                  <PlanGate storeId={storeId} feature="stockTracking" compact />
                )}
                {!hasVariants ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="sku" label="SKU (référence)" error={err("sku")}>
                      {(p) => <Input {...p} value={v.sku} onChange={(e) => set({ sku: e.target.value })} maxLength={60} className="font-mono text-sm" />}
                    </Field>
                    <Field id="barcode" label="Code-barres (EAN, UPC, ISBN)" error={err("barcode")}>
                      {(p) => <Input {...p} value={v.barcode} onChange={(e) => set({ barcode: e.target.value })} maxLength={60} inputMode="numeric" autoComplete="off" className="font-mono text-sm" />}
                    </Field>
                    {v.trackStock && (
                      <Field
                        id="stock"
                        label="Quantité disponible"
                        error={err("stock")}
                        hint={(signedInt(v.stock) ?? 0) < 0 ? `Survente : ${-(signedInt(v.stock) ?? 0)} unité(s) vendue(s) au-delà du stock, à réapprovisionner.` : isEdit ? "Le changement est enregistré comme mouvement de stock." : undefined}
                      >
                        {(p) => <Input {...p} inputMode="numeric" value={v.stock} onChange={(e) => set({ stock: signedDigits(e.target.value) })} className={cn((signedInt(v.stock) ?? 0) < 0 && "text-danger")} />}
                      </Field>
                    )}
                  </div>
                ) : (
                  <p className="flex items-start gap-2 text-sm text-ink-muted">
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> SKU, code-barres, quantités et vente en rupture se gèrent par variante, dans le tableau des variantes.
                  </p>
                )}
                {features.stockTracking && v.trackStock && tracksStock && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[var(--radius-md)] bg-surface-2/50 px-4 py-3 ring-1 ring-inset ring-line">
                      <Checkbox
                        id="inventoryPolicy"
                        label={hasVariants ? "Continuer à vendre en cas de rupture (toutes les variantes)" : "Continuer à vendre en cas de rupture"}
                        description={
                          hasVariants && continueCount > 0 && !allContinue
                            ? `Réglage mixte : ${continueCount} variante${continueCount > 1 ? "s" : ""} sur ${v.variants.length}. Cochez pour l'appliquer à toutes.`
                            : "Les clients peuvent commander à zéro : affiché « Précommande », expédition différée. Le stock peut devenir négatif."
                        }
                        checked={allContinue}
                        onChange={(e) => (hasVariants ? setPolicyAll(e.target.checked ? "CONTINUE" : "DENY") : set({ inventoryPolicy: e.target.checked ? "CONTINUE" : "DENY" }))}
                      />
                    </div>
                    <Field id="lowStockThreshold" label="Seuil d'alerte « stock bas »" hint={`Vide : seuil de la boutique (${storeLowStockThreshold}). Une alerte à chaque passage sous ce seuil.`} error={err("lowStockThreshold")}>
                      {(p) => <Input {...p} inputMode="numeric" value={v.lowStockThreshold} placeholder={String(storeLowStockThreshold)} onChange={(e) => set({ lowStockThreshold: digits(e.target.value).slice(0, 6) })} className="tabular sm:max-w-40" />}
                    </Field>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="minQty" label="Quantité minimum par commande" error={err("minQty")}>
                    {(p) => <Input {...p} inputMode="numeric" value={v.minQty} onChange={(e) => set({ minQty: digits(e.target.value) })} />}
                  </Field>
                  <Field id="maxQty" label="Quantité maximum par commande" hint="Vide : sans limite." error={err("maxQty")}>
                    {(p) => <Input {...p} inputMode="numeric" value={v.maxQty} onChange={(e) => set({ maxQty: digits(e.target.value) })} />}
                  </Field>
                </div>
              </CardBody>
            </Card>

            {ships && (
              <Card>
                <CardHeader title="Expédition" />
                <CardBody>
                  <Field id="weightGrams" label="Poids (grammes)" hint="Sert au calcul des frais par les transporteurs. Les variantes peuvent avoir leur propre poids (import CSV)." error={err("weightGrams")}>
                    {(p) => <Input {...p} inputMode="numeric" value={v.weightGrams} onChange={(e) => set({ weightGrams: digits(e.target.value) })} className="sm:max-w-60" />}
                  </Field>
                </CardBody>
              </Card>
            )}

            {kind === "DIGITAL" && (
              <Card>
                <CardHeader title="Fichiers à remettre" description="Remis automatiquement dès le paiement confirmé, par un lien personnel. Remplacer un fichier met tous les acheteurs à jour." />
                <CardBody className="space-y-5">
                  <DigitalFiles storeId={storeId} productId={v.id} variants={variantChoices} initial={digitalAssets} onCountChange={setFileCount} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="downloadLimit" label="Téléchargements autorisés" hint="Par commande. Vide : 5. Saisissez 0 pour un nombre illimité." error={err("downloadLimit")}>
                      {(p) => <Input {...p} inputMode="numeric" value={v.downloadLimit} placeholder="5" onChange={(e) => set({ downloadLimit: digits(e.target.value).slice(0, 4) })} className="tabular sm:max-w-40" />}
                    </Field>
                    <Field id="downloadValidityDays" label="Validité du lien (jours)" hint="Vide : 365 jours. Saisissez 0 pour un lien sans date limite." error={err("downloadValidityDays")}>
                      {(p) => <Input {...p} inputMode="numeric" value={v.downloadValidityDays} placeholder="365" onChange={(e) => set({ downloadValidityDays: digits(e.target.value).slice(0, 4) })} className="tabular sm:max-w-40" />}
                    </Field>
                  </div>
                  <Field id="postPurchaseInstructions" label="Instructions envoyées après l'achat" hint="Affichées sur la page de téléchargement et dans l'e-mail (mot de passe d'archive, logiciel conseillé…)." error={err("postPurchaseInstructions")}>
                    {(p) => <Textarea {...p} value={v.postPurchaseInstructions} onChange={(e) => set({ postPurchaseInstructions: e.target.value })} maxLength={1000} rows={3} className="min-h-0" />}
                  </Field>
                </CardBody>
              </Card>
            )}

            {kind === "SERVICE" && (
              <Card>
                <CardHeader title="Prestation" description="Aucune livraison. Le rendez-vous se fixe avec le client (le calendrier viendra plus tard)." />
                <CardBody className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="serviceDurationMinutes" label="Durée (minutes)" hint="Vide si la durée varie." error={err("serviceDurationMinutes")}>
                      {(p) => <Input {...p} inputMode="numeric" value={v.serviceDurationMinutes} placeholder="60" onChange={(e) => set({ serviceDurationMinutes: digits(e.target.value).slice(0, 5) })} className="tabular sm:max-w-40" />}
                    </Field>
                    <Field id="serviceLocation" label="Lieu" hint="Adresse, salle, ou « en visioconférence »." error={err("serviceLocation")}>
                      {(p) => <Input {...p} value={v.serviceLocation} onChange={(e) => set({ serviceLocation: e.target.value })} maxLength={160} placeholder="Cotonou, Haie Vive" />}
                    </Field>
                  </div>
                  <div className="rounded-[var(--radius-md)] bg-surface-2/50 px-4 py-3 ring-1 ring-inset ring-line">
                    <Checkbox
                      id="serviceRemote"
                      label="Prestation à distance"
                      description="Par téléphone, WhatsApp ou visioconférence : aucun déplacement."
                      checked={v.serviceRemote}
                      onChange={(e) => set({ serviceRemote: e.target.checked })}
                    />
                  </div>
                  <Field id="serviceBookingNote" label="Note de réservation" hint="Affichée sur la fiche : délais, pièces à apporter, conditions d'annulation." error={err("serviceBookingNote")}>
                    {(p) => <Textarea {...p} value={v.serviceBookingNote} onChange={(e) => set({ serviceBookingNote: e.target.value })} maxLength={500} rows={2} className="min-h-0" />}
                  </Field>
                  <Field id="postPurchaseInstructions" label="Instructions envoyees apres l'achat" hint="Comment vous joindre pour fixer le rendez-vous, lien de visioconférence…" error={err("postPurchaseInstructions")}>
                    {(p) => <Textarea {...p} value={v.postPurchaseInstructions} onChange={(e) => set({ postPurchaseInstructions: e.target.value })} maxLength={1000} rows={3} className="min-h-0" />}
                  </Field>
                </CardBody>
              </Card>
            )}

            {kind === "GIFT_CARD" && (
              <Card>
                <CardHeader title="Carte cadeau" description="Chaque variante est une valeur (ex. option « Montant » : 10 000, 25 000). La carte est émise et envoyée dès le paiement confirmé ; TVA non appliquée." />
                <CardBody className="space-y-4">
                  <Field id="giftCardValidityDays" label="Validité des cartes (jours)" hint="Entre 180 et 1 825 jours. Vide : 365 jours." error={err("giftCardValidityDays")}>
                    {(p) => <Input {...p} inputMode="numeric" value={v.giftCardValidityDays} placeholder="365" onChange={(e) => set({ giftCardValidityDays: digits(e.target.value).slice(0, 4) })} className="tabular sm:max-w-40" />}
                  </Field>
                  {groups.length > 0 && (
                    <Alert tone="warning">Retirez les suppléments : une carte cadeau n&apos;en a pas.</Alert>
                  )}
                </CardBody>
              </Card>
            )}

            <Card>
              <CardHeader title="Variantes" description="Couleurs, tailles, matières : jusqu'à 3 options et 100 combinaisons, chacune avec son prix, son stock et sa photo." />
              <CardBody className="space-y-5">
                {!features.variants ? (
                  <PlanGate storeId={storeId} feature="variants" compact />
                ) : (
                  <>
                    <OptionsEditor options={v.options} onChange={setOptions} images={v.images} error={err("options")} />
                    {err("variants") && (
                      <p className="text-sm font-medium text-danger" role="alert">
                        {err("variants")}
                      </p>
                    )}
                    <VariantsTable options={v.options} variants={v.variants} onChange={(variants) => set({ variants })} images={v.images} trackStock={v.trackStock && features.stockTracking} basePrice={price} currency={currency} />
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Suppléments" description="Choix additionnels à la commande, gratuits ou payants." />
              <CardBody>
                {features.options ? (
                  <SupplementsEditor groups={groups} onChange={setGroups} currency={currency} error={err("optionGroups")} />
                ) : (
                  <>
                    <PlanGate storeId={storeId} feature="options" compact />
                    {groups.length > 0 && <p className="mt-3 text-sm text-ink-muted">Les {groups.length} groupe(s) existant(s) sont conservés tels quels.</p>}
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Détails de la fiche" description="Onglets repliables affichés sous la description : composition, entretien, livraison." />
              <CardBody>
                <DetailsEditor details={v.details} onChange={(details) => set({ details })} error={err("details")} />
              </CardBody>
            </Card>
          </div>

          {/* ─────────── Colonne latérale ─────────── */}
          <aside className="min-w-0 space-y-5" aria-label="Organisation du produit">
            <Card>
              <CardHeader title="Statut" />
              <CardBody className="space-y-4">
                <Field id="status" label="Statut" hint={STATUS_HINT[v.status]} error={err("status")}>
                  {(p) => (
                    <Select {...p} value={v.status} onChange={(e) => set({ status: e.target.value as ProductFormValues["status"] })}>
                      <option value="ACTIVE">Actif</option>
                      <option value="DRAFT">Brouillon</option>
                      <option value="ARCHIVED">Archivé</option>
                    </Select>
                  )}
                </Field>
                <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                  <div>
                    <p className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                      <Star className="size-3.5 text-sun" aria-hidden /> Produit vedette
                    </p>
                    <p className="text-xs text-ink-muted">Mis en avant dans la boutique.</p>
                  </div>
                  <Switch label="Vedette" checked={v.isFeatured} onChange={(c) => set({ isFeatured: c })} />
                </div>
                {isEdit && v.status === "ACTIVE" && (
                  <a href={`/s/${storeSlug}/p/${v.slug}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
                    <ExternalLink className="size-4" aria-hidden /> Voir en boutique
                  </a>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Organisation" />
              <CardBody className="space-y-4">
                <Field id="productType" label="Type de produit" hint="Classement interne (ex. Robe, Sandales). Différent du type de vente choisi en haut de la page." error={err("productType")}>
                  {(p) => <Input {...p} value={v.productType} onChange={(e) => set({ productType: e.target.value })} list="type-suggestions" maxLength={60} placeholder="Ex. Robe" />}
                </Field>
                <datalist id="type-suggestions">
                  {suggestions.types.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <Field id="vendor" label="Marque" error={err("vendor")}>
                  {(p) => <Input {...p} value={v.vendor} onChange={(e) => set({ vendor: e.target.value })} list="vendor-suggestions" maxLength={60} placeholder="Ex. Atelier Dah" />}
                </Field>
                <datalist id="vendor-suggestions">
                  {suggestions.vendors.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <Field id="categoryId" label="Collection principale" hint="Sert au fil d'Ariane et aux filtres de la boutique." error={err("categoryId")}>
                  {(p) => (
                    <Select {...p} value={v.categoryId} onChange={(e) => set({ categoryId: e.target.value, collectionIds: v.collectionIds.filter((id) => id !== e.target.value) })}>
                      <option value="">Aucune</option>
                      {manualCollections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {manualCollections.filter((c) => c.id !== v.categoryId).length > 0 && (
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-medium text-ink">Autres collections</legend>
                    <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
                      {manualCollections
                        .filter((c) => c.id !== v.categoryId)
                        .map((c) => (
                          <li key={c.id}>
                            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2 text-sm text-ink hover:bg-surface-2 sm:min-h-9">
                              <input
                                type="checkbox"
                                className="size-5 accent-[var(--c-primary)]"
                                checked={v.collectionIds.includes(c.id)}
                                onChange={(e) => set({ collectionIds: e.target.checked ? [...v.collectionIds, c.id] : v.collectionIds.filter((x) => x !== c.id) })}
                              />
                              {c.name}
                            </label>
                          </li>
                        ))}
                    </ul>
                  </fieldset>
                )}
                {autoCollections.length > 0 && (
                  <p className="text-xs text-ink-muted">
                    Inclus automatiquement dans : {autoCollections.join(", ")}.
                  </p>
                )}
                <Link href={`/app/${storeId}/collections`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-0">
                  Gérer les collections
                </Link>
                <TagInput id="tags" label="Étiquettes" value={v.tags} onChange={(tags) => set({ tags })} suggestions={suggestions.tags} hint="Servent aux filtres et aux collections automatiques." />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Référencement"
                action={
                  <button type="button" onClick={() => setSeoOpen((o) => !o)} aria-expanded={seoOpen} aria-controls="seo-fields" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary hover:bg-primary-soft sm:min-h-8">
                    Modifier <ChevronDown className={cn("size-4 transition-transform duration-200", seoOpen && "rotate-180")} aria-hidden />
                  </button>
                }
              />
              <CardBody className="space-y-4">
                <div className="rounded-[var(--radius-md)] bg-surface-2/40 p-3 ring-1 ring-inset ring-line" aria-label="Aperçu dans Google">
                  <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                    <Search className="size-3" aria-hidden /> Aperçu Google
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {storeSlug} › p › {v.slug || "adresse-du-produit"}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[15px] font-medium leading-snug text-info">{seoTitle}</p>
                  <p className="mt-0.5 line-clamp-3 text-[13px] text-ink-muted">{seoDesc}</p>
                  {price > 0 && <p className="tabular mt-1 text-xs text-ink-muted">{formatMoney(discount != null ? promo! : price, currency)}</p>}
                </div>
                <div id="seo-fields" hidden={!seoOpen} className="space-y-4">
                  <Field id="seoTitle" label="Titre de la page" hint={`${v.seoTitle.length} / 70 caractères. Vide : titre du produit.`} error={err("seoTitle")}>
                    {(p) => <Input {...p} value={v.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} maxLength={70} />}
                  </Field>
                  <Field id="seoDescription" label="Méta-description" hint={`${v.seoDescription.length} / 320 caractères.`} error={err("seoDescription")}>
                    {(p) => <Textarea {...p} value={v.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} maxLength={320} rows={3} className="min-h-0" />}
                  </Field>
                  <Field id="slug" label="Adresse (URL)" hint="Lettres, chiffres et tirets." error={err("slug")}>
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
                </div>
              </CardBody>
            </Card>
          </aside>
        </div>

        {/* Barre d'enregistrement collante : visible dès qu'il y a des modifications (toujours à la création). */}
        <div
          className={cn(
            "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mt-6 transition-[opacity,transform] duration-200 ease-out lg:bottom-4 motion-reduce:transition-none",
            dirty || !isEdit ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
          )}
          aria-hidden={!(dirty || !isEdit)}
        >
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-forest px-4 py-3 text-white shadow-[var(--shadow-lg)] ring-1 ring-white/10">
            <p className="mr-auto text-sm font-medium" role="status">
              {!isEdit ? "Nouveau produit non enregistré" : dirty ? "Modifications non enregistrées" : "Aucune modification"}
              {hasVariants && <Badge tone="accent" className="ml-2 align-middle">{v.variants.length} variante{v.variants.length > 1 ? "s" : ""}</Badge>}
            </p>
            {isEdit && (
              <Button type="button" variant="inverse" size="sm" onClick={discard} disabled={!dirty || pending} tabIndex={dirty ? 0 : -1}>
                Annuler
              </Button>
            )}
            <Button type="submit" variant="accent" size="sm" loading={pending} disabled={!dirty && isEdit} tabIndex={dirty || !isEdit ? 0 : -1}>
              {isEdit ? "Enregistrer" : "Créer le produit"}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}

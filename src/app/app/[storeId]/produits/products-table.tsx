"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageOff, Star, CheckCircle2, FileEdit, Archive, Tag, FolderPlus, Download, X, ChevronDown, PackageCheck, PackageX } from "lucide-react";
import type { ProductStatus } from "@prisma/client";
import { bulkUpdateProducts, type BulkAction } from "@/lib/products/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { thumbUrl } from "@/lib/image-loader";
import { ProductRowActions } from "./row-actions";
import { PRODUCT_KIND_BADGES, type ProductKindValue } from "@/lib/digital/kinds";

export type ProductRow = {
  id: string;
  name: string;
  status: ProductStatus;
  isFeatured: boolean;
  trackStock: boolean;
  thumb: string | null;
  thumbAlt: string;
  stockLabel: string;
  stockTone: "danger" | "warning" | "neutral" | "muted";
  /** Stock négatif (vente au-delà du stock en « continuer à vendre ») : badge « Survente ». */
  oversold?: boolean;
  /** Rupture vendue en précommande (« continuer à vendre en cas de rupture »). */
  preorder?: boolean;
  priceLabel: string;
  productType: string | null;
  vendor: string | null;
  collections: string[];
  variantCount: number;
  /** Vague 2 : nature du produit (badge « Numérique », « Service », « Carte cadeau »). */
  kind?: ProductKindValue;
  /** Vague 2 : nombre de fichiers vendus (produit numérique). */
  files?: number;
};

/** Badge de nature : rien pour un produit physique (cas par défaut, pour ne pas charger la liste). */
function KindBadge({ kind, files }: { kind?: ProductKindValue; files?: number }) {
  if (!kind || kind === "PHYSICAL") return null;
  const label = PRODUCT_KIND_BADGES[kind];
  const missing = kind === "DIGITAL" && !files;
  return (
    // `Badge` n'accepte pas d'attribut HTML : l'infobulle est portée par un span englobant.
    <span title={missing ? "Aucun fichier attaché : les acheteurs recevraient un lien vide." : undefined}>
      <Badge tone={missing ? "warning" : kind === "GIFT_CARD" ? "accent" : "info"}>
        {label}
        {kind === "DIGITAL" && files ? ` · ${files} fichier${files > 1 ? "s" : ""}` : ""}
        {missing ? " · sans fichier" : ""}
      </Badge>
    </span>
  );
}

const STATUS: Record<ProductStatus, { label: string; tone: "success" | "neutral" | "warning" }> = {
  ACTIVE: { label: "Actif", tone: "success" },
  DRAFT: { label: "Brouillon", tone: "neutral" },
  ARCHIVED: { label: "Archivé", tone: "warning" },
};

/** Tableau dense des produits avec sélection multiple et actions groupées (cartes sur mobile). */
export function ProductsTable({
  storeId,
  rows,
  collections,
  tags,
  canExport,
}: {
  storeId: string;
  rows: ProductRow[];
  collections: { id: string; name: string; auto: boolean }[];
  tags: string[];
  canExport: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | "tag" | "untag" | "collection">(null);
  const [tag, setTag] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const base = `/app/${storeId}/produits`;
  const all = rows.length > 0 && selected.size === rows.length;
  const some = selected.size > 0 && !all;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const run = (action: BulkAction) =>
    start(async () => {
      const res = await bulkUpdateProducts(storeId, [...selected], action);
      if (res.ok) {
        toast.success(res.message ?? "Fait");
        setSelected(new Set());
        setDialog(null);
        setTag("");
        router.refresh();
      } else toast.error("Action impossible", res.error);
    });

  const manual = collections.filter((c) => !c.auto);

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b border-line bg-primary-soft/80 px-3 py-2 backdrop-blur sm:px-4" role="region" aria-label="Actions groupées">
          <p className="mr-auto text-sm font-medium text-ink" aria-live="polite">
            {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
          </p>
          <Button size="sm" variant="outline" loading={pending} onClick={() => run({ type: "status", status: "ACTIVE" })}>
            <CheckCircle2 className="size-4" aria-hidden /> Activer
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run({ type: "status", status: "DRAFT" })}>
            <FileEdit className="size-4" aria-hidden /> Brouillon
          </Button>
          <DropdownMenu
            label="Autres actions groupées"
            trigger={(p) => (
              <button {...p} className={buttonClasses({ variant: "outline", size: "sm" })} disabled={pending}>
                Plus <ChevronDown className="size-4" aria-hidden />
              </button>
            )}
          >
            <DropdownItem icon={Tag} onSelect={() => setDialog("tag")}>
              Ajouter une étiquette
            </DropdownItem>
            <DropdownItem icon={Tag} onSelect={() => setDialog("untag")}>
              Retirer une étiquette
            </DropdownItem>
            <DropdownItem icon={FolderPlus} onSelect={() => setDialog("collection")} disabled={manual.length === 0}>
              Ajouter à une collection
            </DropdownItem>
            <DropdownItem icon={Star} onSelect={() => run({ type: "feature", value: true })}>
              Mettre en vedette
            </DropdownItem>
            <DropdownItem icon={PackageCheck} onSelect={() => run({ type: "inventoryPolicy", policy: "CONTINUE" })}>
              Continuer à vendre en rupture
            </DropdownItem>
            <DropdownItem icon={PackageX} onSelect={() => run({ type: "inventoryPolicy", policy: "DENY" })}>
              Bloquer la vente à zéro
            </DropdownItem>
            {canExport && (
              <DropdownItem icon={Download} onSelect={() => window.location.assign(`${base}/export?ids=${[...selected].join(",")}`)}>
                Exporter la sélection
              </DropdownItem>
            )}
            <DropdownSeparator />
            <DropdownItem icon={Archive} tone="danger" onSelect={() => run({ type: "status", status: "ARCHIVED" })}>
              Supprimer (archiver)
            </DropdownItem>
          </DropdownMenu>
          <button type="button" onClick={() => setSelected(new Set())} className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface hover:text-ink sm:size-9" aria-label="Annuler la sélection">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {/* Mobile : cartes */}
      <ul className="divide-y divide-line md:hidden" aria-label="Produits">
        {rows.map((p) => (
          <li key={p.id} className={cn("relative flex items-center gap-3 px-4 py-3", selected.has(p.id) && "bg-primary-soft/30")}>
            <input type="checkbox" className="relative z-[1] size-5 shrink-0 accent-[var(--c-primary)]" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Sélectionner ${p.name}`} />
            <Thumb src={p.thumb} alt={p.thumbAlt} size={56} />
            <div className="min-w-0 flex-1">
              <Link href={`${base}/${p.id}`} className="block truncate text-[15px] font-medium text-ink after:absolute after:inset-0 after:content-['']">
                {p.name}
              </Link>
              <p className="tabular mt-0.5 text-sm text-ink">{p.priceLabel}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={STATUS[p.status].tone} dot>
                  {STATUS[p.status].label}
                </Badge>
                <KindBadge kind={p.kind} files={p.files} />
                <StockText row={p} compact />
              </div>
            </div>
            <div className="relative z-[1]">
              <ProductRowActions storeId={storeId} productId={p.id} name={p.name} status={p.status} isFeatured={p.isFeatured} trackStock={p.trackStock} />
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop : tableau dense */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[980px] text-sm">
          <caption className="sr-only">Produits du catalogue</caption>
          <thead className="border-b border-line bg-surface-2/50 text-left text-[12px] text-ink-muted">
            <tr>
              <th scope="col" className="h-10 w-12 px-4">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--c-primary)] sm:size-4"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = some;
                  }}
                  onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
                  aria-label="Sélectionner tous les produits de la page"
                />
              </th>
              <th scope="col" className="px-2 font-medium">
                Produit
              </th>
              <th scope="col" className="px-3 font-medium">
                Statut
              </th>
              <th scope="col" className="px-3 font-medium">
                Inventaire
              </th>
              <th scope="col" className="px-3 text-right font-medium">
                Prix
              </th>
              <th scope="col" className="px-3 font-medium">
                Type
              </th>
              <th scope="col" className="px-3 font-medium">
                Marque
              </th>
              <th scope="col" className="px-3 font-medium">
                Collections
              </th>
              <th scope="col" className="w-14 px-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => (
              <tr key={p.id} className={cn("relative transition-colors duration-150", selected.has(p.id) ? "bg-primary-soft/30" : "hover:bg-surface-2/60")}>
                <td className="px-4 py-2">
                  <input type="checkbox" className="relative z-[1] size-5 accent-[var(--c-primary)] sm:size-4" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Sélectionner ${p.name}`} />
                </td>
                <th scope="row" className="px-2 py-2 text-left font-normal">
                  <div className="flex items-center gap-3">
                    <Thumb src={p.thumb} alt={p.thumbAlt} size={40} />
                    <Link href={`${base}/${p.id}`} className="flex max-w-[300px] items-center gap-1.5 font-medium text-ink outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary">
                      <span className="truncate">{p.name}</span>
                      {p.isFeatured && <Star className="size-3.5 shrink-0 fill-sun text-sun" aria-label="Vedette" />}
                    </Link>
                  </div>
                </th>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={STATUS[p.status].tone} dot>
                      {STATUS[p.status].label}
                    </Badge>
                    <KindBadge kind={p.kind} files={p.files} />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <StockText row={p} />
                </td>
                <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink">{p.priceLabel}</td>
                <td className="max-w-[140px] truncate px-3 py-2 text-ink-muted">{p.productType ?? <span className="text-ink-faint">–</span>}</td>
                <td className="max-w-[140px] truncate px-3 py-2 text-ink-muted">{p.vendor ?? <span className="text-ink-faint">–</span>}</td>
                <td className="max-w-[200px] truncate px-3 py-2 text-ink-muted" title={p.collections.join(", ")}>
                  {p.collections.length ? p.collections.join(", ") : <span className="text-ink-faint">–</span>}
                </td>
                <td className="relative z-[1] px-2 py-1 text-right">
                  <ProductRowActions storeId={storeId} productId={p.id} name={p.name} status={p.status} isFeatured={p.isFeatured} trackStock={p.trackStock} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialog === "tag" || dialog === "untag"} onClose={() => setDialog(null)} title={dialog === "untag" ? "Retirer une étiquette" : "Ajouter une étiquette"} description={`${selected.size} produit${selected.size > 1 ? "s" : ""} sélectionné${selected.size > 1 ? "s" : ""}.`} size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (tag.trim()) run({ type: dialog === "untag" ? "removeTag" : "addTag", tag: tag.trim() });
          }}
        >
          <Field id="bulk-tag" label="Étiquette" required>
            {(p) => <Input {...p} value={tag} onChange={(e) => setTag(e.target.value)} list="bulk-tag-list" maxLength={40} autoFocus />}
          </Field>
          <datalist id="bulk-tag-list">
            {tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
              Annuler
            </Button>
            <Button type="submit" loading={pending} disabled={!tag.trim()}>
              {dialog === "untag" ? "Retirer" : "Ajouter"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === "collection"} onClose={() => setDialog(null)} title="Ajouter à une collection" description="Seules les collections manuelles acceptent des produits." size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (collectionId) run({ type: "addToCollection", collectionId });
          }}
        >
          <Field id="bulk-col" label="Collection" required>
            {(p) => (
              <Select {...p} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
                <option value="">Choisir</option>
                {manual.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
              Annuler
            </Button>
            <Button type="submit" loading={pending} disabled={!collectionId}>
              Ajouter
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function StockText({ row, compact = false }: { row: ProductRow; compact?: boolean }) {
  if (row.oversold || row.preorder) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {row.oversold ? <Badge tone="danger">Survente</Badge> : <Badge tone="info">Précommande</Badge>}
        {!compact && <span className="tabular text-ink-muted">{row.stockLabel}</span>}
      </span>
    );
  }
  if (row.stockTone === "muted") return compact ? null : <span className="text-ink-faint">{row.stockLabel}</span>;
  if (row.stockTone === "danger") return <Badge tone="danger">{row.stockLabel}</Badge>;
  if (row.stockTone === "warning") return <Badge tone="warning">{row.stockLabel}</Badge>;
  return compact ? <Badge tone="neutral">{row.stockLabel}</Badge> : <span className="tabular text-ink">{row.stockLabel}</span>;
}

function Thumb({ src, alt, size }: { src: string | null; alt: string; size: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbUrl(src)} alt={alt} width={size} height={size} loading="lazy" decoding="async" style={{ width: size, height: size }} className="shrink-0 rounded-[10px] object-cover ring-1 ring-line" />;
  }
  return (
    <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-ink-faint ring-1 ring-inset ring-line" aria-hidden>
      <ImageOff className="size-4" />
    </span>
  );
}

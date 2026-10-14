"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { FilePlus2, FileText, RefreshCw, Trash2, Save } from "lucide-react";
import { uploadFile, UploadFailedError } from "@/lib/storage/client";
import { ACCEPTED_FILE_TYPES, FILE_TYPE_LABELS, MAX_FILES_PER_PRODUCT, MAX_FILE_BYTES } from "@/lib/storage/file-keys";
import { formatFileSize } from "@/lib/digital/rules";
import { deleteDigitalAsset, renameDigitalAsset } from "@/lib/digital/actions";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type DigitalAssetRow = { id: string; name: string; variantId: string | null; bytes: number; mime: string; version: number; position: number };

/**
 * Fichiers vendus d'un produit numérique (vague 2).
 *  - téléversement direct (octets bruts, sans compression) vers `POST /api/stores/{id}/files` ;
 *  - « Remplacer » envoie une nouvelle version du MÊME fichier : les acheteurs qui reviennent sur leur lien
 *    téléchargent la nouvelle version, sans nouvel accès à émettre ;
 *  - renommer et retirer passent par des actions serveur (filtrées par boutique).
 * Le produit doit déjà être enregistré (un fichier est rattaché à une fiche) : tant qu'il ne l'est pas,
 * le bloc invite à enregistrer d'abord.
 */
export function DigitalFiles({
  storeId,
  productId,
  variants,
  initial,
  onCountChange,
}: {
  storeId: string;
  productId?: string;
  variants: { id?: string; name: string }[];
  initial: DigitalAssetRow[];
  /** Nombre de fichiers attachés, remonté au formulaire (avertissements de changement de type). */
  onCountChange?: (count: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<DigitalAssetRow[]>(initial);
  const [variantId, setVariantId] = useState<string>("");
  const [replacing, setReplacing] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ name: string; fraction: number } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const named = variants.filter((v) => v.id);

  // Le formulaire suit le nombre de fichiers sans re-render inutile (la liste vit ici).
  const countRef = useRef(onCountChange);
  useEffect(() => {
    countRef.current = onCountChange;
  });
  useEffect(() => {
    countRef.current?.(assets.length);
  }, [assets.length]);

  if (!productId) {
    return (
      <Alert tone="info">
        Enregistrez d&apos;abord le produit : vous pourrez ensuite téléverser les fichiers à remettre après l&apos;achat.
      </Alert>
    );
  }

  const send = async (file: File, assetId: string | null) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Fichier trop lourd", `${formatFileSize(MAX_FILE_BYTES)} maximum par fichier.`);
      return;
    }
    setProgress({ name: file.name, fraction: 0 });
    try {
      const res = await uploadFile(storeId, file, {
        productId,
        variantId: assetId ? null : variantId || null,
        assetId,
        name: file.name,
        onProgress: (fraction) => setProgress({ name: file.name, fraction }),
      });
      setAssets((cur) => (res.replaced ? cur.map((a) => (a.id === res.asset.id ? res.asset : a)) : [...cur.filter((a) => a.id !== res.asset.id), res.asset]));
      toast.success(res.replaced ? `Nouvelle version de « ${res.asset.name} »` : `${res.asset.name} ajouté`, res.replaced ? "Les acheteurs téléchargent désormais cette version." : undefined);
    } catch (e) {
      toast.error("Envoi impossible", e instanceof UploadFailedError ? e.message : "Fichier illisible ou trop lourd.");
    } finally {
      setProgress(null);
      setReplacing(null);
      if (fileRef.current) fileRef.current.value = "";
      if (replaceRef.current) replaceRef.current.value = "";
    }
  };

  const rename = (id: string) => {
    const name = (names[id] ?? "").trim();
    if (!name) return;
    start(async () => {
      const res = await renameDigitalAsset(storeId, id, name);
      if (!res.ok) return toast.error("Renommage impossible", res.error);
      setAssets((cur) => cur.map((a) => (a.id === id ? { ...a, name } : a)));
      setNames((cur) => {
        const next = { ...cur };
        delete next[id];
        return next;
      });
      toast.success(res.message ?? "Enregistré");
    });
  };

  const remove = (id: string, name: string) => {
    if (!window.confirm(`Retirer « ${name} » de ce produit ? Les acheteurs ne le verront plus dans leurs téléchargements.`)) return;
    start(async () => {
      const res = await deleteDigitalAsset(storeId, id);
      if (!res.ok) return toast.error("Suppression impossible", res.error);
      setAssets((cur) => cur.filter((a) => a.id !== id));
      toast.success(res.message ?? "Fichier retiré");
    });
  };

  const full = assets.length >= MAX_FILES_PER_PRODUCT;

  return (
    <div className="space-y-4">
      {assets.length === 0 ? (
        <Alert tone="warning">Aucun fichier : les acheteurs recevront un lien vide. Ajoutez au moins un fichier avant de publier.</Alert>
      ) : (
        <ul className="divide-y divide-line" aria-label="Fichiers vendus">
          {assets.map((a) => {
            const variant = named.find((v) => v.id === a.variantId);
            const draft = names[a.id];
            return (
              <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-ink-muted">
                      <FileText className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                      <p className="text-xs text-ink-muted">
                        {formatFileSize(a.bytes)} · {a.mime}
                        {a.version > 1 ? ` · version ${a.version}` : ""}
                      </p>
                      {variant && (
                        <Badge tone="neutral" className="mt-1">
                          {variant.name}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending || !!progress}
                      onClick={() => {
                        setReplacing(a.id);
                        replaceRef.current?.click();
                      }}
                    >
                      <RefreshCw className="size-4" aria-hidden /> Remplacer
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="text-danger hover:bg-danger-soft" disabled={pending} onClick={() => remove(a.id, a.name)}>
                      <Trash2 className="size-4" aria-hidden /> <span className="sr-only">Retirer {a.name}</span>
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex items-stretch gap-2">
                  <label htmlFor={`asset-name-${a.id}`} className="sr-only">
                    Nom affiché du fichier {a.name}
                  </label>
                  <Input
                    id={`asset-name-${a.id}`}
                    value={draft ?? a.name}
                    onChange={(e) => setNames((cur) => ({ ...cur, [a.id]: e.target.value }))}
                    maxLength={120}
                    className="h-11 text-sm sm:h-9"
                    placeholder="Nom affiché à l'acheteur"
                  />
                  <Button type="button" variant="outline" size="sm" disabled={pending || draft == null || draft.trim() === a.name} onClick={() => rename(a.id)}>
                    <Save className="size-4" aria-hidden /> <span className="sr-only">Enregistrer le nom</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {named.length > 0 && (
        <div>
          <label htmlFor="asset-variant" className="mb-1.5 block text-sm font-medium text-ink">
            Fichier réservé à une variante
          </label>
          <select
            id="asset-variant"
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            className="h-11 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 text-sm text-ink"
          >
            <option value="">Toutes les variantes</option>
            {named.map((v) => (
              <option key={v.id} value={v.id!}>
                {v.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-muted">Le prochain fichier ajouté sera remis pour ce choix seulement.</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={!!progress || full}
        aria-busy={!!progress}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-line-strong bg-surface-2/40 px-3 py-8 text-sm text-ink-muted transition-colors hover:border-primary hover:bg-primary-soft/40 hover:text-ink disabled:opacity-60",
        )}
      >
        <FilePlus2 className="size-5 text-primary" aria-hidden />
        <span className="font-medium">{progress ? `Envoi ${Math.round(progress.fraction * 100)} %` : full ? `${MAX_FILES_PER_PRODUCT} fichiers maximum` : "Ajouter un fichier"}</span>
        {progress ? (
          <span role="progressbar" aria-label="Envoi du fichier" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)} className="block h-1 w-3/4 max-w-40 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
          </span>
        ) : (
          <span className="text-center text-xs text-ink-faint">
            {FILE_TYPE_LABELS} · {formatFileSize(MAX_FILE_BYTES)} maximum par fichier, {MAX_FILES_PER_PRODUCT} fichiers par produit.
          </span>
        )}
      </button>

      <input ref={fileRef} type="file" accept={ACCEPTED_FILE_TYPES} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files?.[0] && send(e.target.files[0], null)} />
      <input
        ref={replaceRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => e.target.files?.[0] && replacing && send(e.target.files[0], replacing)}
      />
      <p className="text-xs text-ink-muted">
        Les fichiers ne sont jamais accessibles par une adresse publique : chaque acheteur reçoit un lien personnel, limité en nombre de téléchargements et dans le temps.
      </p>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus, X, Star, ArrowLeft, ArrowRight, Link as LinkIcon, GripVertical } from "lucide-react";
import type { ImageInput } from "@/lib/products/schemas";
import { compressPhoto, uploadImage, UploadFailedError } from "@/lib/storage/client";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const iconBtn =
  "inline-flex size-9 items-center justify-center rounded-full text-ink-muted transition-[background-color,color,transform] hover:bg-surface-2 hover:text-ink active:scale-[0.96] disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * Médias du produit : téléversement multiple (compression dans le navigateur puis envoi au stockage
 * des médias ; seule l'URL est enregistrée avec le produit), glisser-déposer pour réordonner (et boutons clavier),
 * texte alternatif, photo principale. La limite du plan est appliquée ici et revérifiée côté serveur.
 */
export function MediaManager({
  storeId,
  images,
  onChange,
  maxPhotos,
  planName,
  canUpgrade,
  error,
}: {
  storeId: string;
  images: ImageInput[];
  onChange: (next: ImageInput[]) => void;
  maxPhotos: number;
  planName: string;
  canUpgrade: boolean;
  error?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number; fraction: number; step: "compress" | "upload" } | null>(null);
  const [url, setUrl] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [live, setLive] = useState("");
  const full = images.length >= maxPhotos;

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= images.length) return;
    const next = [...images];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
    setLive(`Photo déplacée en position ${to + 1} sur ${images.length}`);
  };

  const addFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    const room = Math.max(0, maxPhotos - images.length);
    if (room === 0) return toast.error(`${maxPhotos} photo${maxPhotos > 1 ? "s" : ""} maximum sur le plan ${planName}`);
    if (list.length > room) toast.info(`${room} photo${room > 1 ? "s" : ""} ajoutée${room > 1 ? "s" : ""}`, `Le plan ${planName} autorise ${maxPhotos} photo${maxPhotos > 1 ? "s" : ""} par produit.`);
    setBusy(true);
    const added: ImageInput[] = [];
    const batch = list.slice(0, room);
    for (const [index, f] of batch.entries()) {
      try {
        setProgress({ index, total: batch.length, fraction: 0, step: "compress" });
        const blob = await compressPhoto(f);
        setProgress({ index, total: batch.length, fraction: 0, step: "upload" });
        const up = await uploadImage(storeId, "product", blob, { onProgress: (fraction) => setProgress({ index, total: batch.length, fraction, step: "upload" }) });
        if (!images.some((i) => i.url === up.url) && !added.some((i) => i.url === up.url)) added.push({ url: up.url, alt: "" });
      } catch (e) {
        toast.error(`${f.name} n'a pas pu être ajoutée`, e instanceof UploadFailedError ? e.message : "Image illisible ou trop lourde.");
      }
    }
    setProgress(null);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (added.length) {
      onChange([...images, ...added].slice(0, Math.max(maxPhotos, images.length)));
      setLive(`${added.length} photo${added.length > 1 ? "s" : ""} ajoutée${added.length > 1 ? "s" : ""}`);
    }
  };

  const addUrl = () => {
    const u = url.trim();
    if (!/^https:\/\/\S+$/i.test(u)) return toast.error("Adresse invalide", "L'adresse doit commencer par https://");
    if (full) return toast.error(`${maxPhotos} photo${maxPhotos > 1 ? "s" : ""} maximum sur le plan ${planName}`);
    if (images.some((i) => i.url === u)) return toast.info("Cette image est déjà dans la liste");
    onChange([...images, { url: u, alt: "" }]);
    setUrl("");
  };

  return (
    <div
      className={cn("space-y-4 rounded-[var(--radius-md)] transition-shadow", dropActive && "ring-2 ring-primary ring-offset-4 ring-offset-surface")}
      onDragOver={(e) => {
        if (dragIndex == null && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        if (dragIndex != null || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setDropActive(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      {images.length > maxPhotos && (
        <Alert tone="warning">
          {images.length} photos, au-delà des {maxPhotos} du plan {planName} : elles sont conservées, mais vous ne pouvez plus en ajouter.
          {canUpgrade && (
            <>
              {" "}
              <Link href={`/app/${storeId}/abonnement#plans`} className="font-semibold underline underline-offset-4">
                Voir les plans
              </Link>
            </>
          )}
        </Alert>
      )}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Médias du produit">
        {images.map((img, i) => (
          <li
            key={img.url.slice(-40) + i}
            draggable
            onDragStart={(e) => {
              setDragIndex(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
            }}
            onDragOver={(e) => {
              if (dragIndex == null) return;
              e.preventDefault();
              setOverIndex(i);
            }}
            onDrop={(e) => {
              if (dragIndex == null) return;
              e.preventDefault();
              e.stopPropagation();
              move(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={cn(
              "group/photo relative transition-[opacity,transform] duration-150 ease-out",
              i === 0 && "col-span-2 row-span-2",
              dragIndex === i && "opacity-40",
              overIndex === i && dragIndex !== i && "scale-[0.97]",
            )}
          >
            <div className="relative overflow-hidden rounded-[var(--radius-md)] bg-surface-2 ring-1 ring-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt || `Photo ${i + 1}`} className="aspect-square w-full cursor-grab object-cover active:cursor-grabbing" />
              <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-ink ring-1 ring-line">
                <GripVertical className="size-3 text-ink-faint" aria-hidden />
                {i === 0 ? "Principale" : i + 1}
              </span>
              <div className="absolute right-1.5 top-1.5 flex gap-0.5 rounded-full bg-surface/95 p-0.5 shadow-sm ring-1 ring-line">
                {i > 0 && (
                  <button type="button" onClick={() => move(i, 0)} className={cn(iconBtn, "size-8")} aria-label={`Définir la photo ${i + 1} comme principale`} title="Définir comme principale">
                    <Star className="size-3.5" aria-hidden />
                  </button>
                )}
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className={cn(iconBtn, "size-8")} aria-label={`Déplacer la photo ${i + 1} vers la gauche`}>
                  <ArrowLeft className="size-3.5" aria-hidden />
                </button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === images.length - 1} className={cn(iconBtn, "size-8")} aria-label={`Déplacer la photo ${i + 1} vers la droite`}>
                  <ArrowRight className="size-3.5" aria-hidden />
                </button>
                <button type="button" onClick={() => onChange(images.filter((_, j) => j !== i))} className={cn(iconBtn, "size-8 hover:bg-danger-soft hover:text-danger")} aria-label={`Retirer la photo ${i + 1}`}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
            <label htmlFor={`alt-${i}`} className="sr-only">
              Texte alternatif de la photo {i + 1}
            </label>
            <Input id={`alt-${i}`} value={img.alt} onChange={(e) => onChange(images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} placeholder="Texte alternatif" maxLength={160} className="mt-2 h-11 px-3 text-sm sm:h-9 sm:text-xs" />
          </li>
        ))}
        {!full && (
          <li className={cn(images.length === 0 && "col-span-2 sm:col-span-4")}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              aria-busy={busy}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-line-strong bg-surface-2/40 px-3 text-sm text-ink-muted transition-colors hover:border-primary hover:bg-primary-soft/40 hover:text-ink disabled:opacity-60",
                images.length === 0 ? "py-10" : "aspect-square",
              )}
            >
              <ImagePlus className="size-5 text-primary" aria-hidden />
              <span className="font-medium">
                {busy && progress
                  ? progress.step === "compress"
                    ? `Préparation ${progress.total > 1 ? `${progress.index + 1}/${progress.total}` : ""}`
                    : `Envoi ${progress.total > 1 ? `${progress.index + 1}/${progress.total} · ` : ""}${Math.round(progress.fraction * 100)} %`
                  : busy
                    ? "Préparation"
                    : images.length === 0
                      ? "Ajouter des photos"
                      : "Ajouter"}
              </span>
              {busy && progress && (
                <span
                  role="progressbar"
                  aria-label="Envoi des photos"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(((progress.index + (progress.step === "upload" ? progress.fraction : 0)) / progress.total) * 100)}
                  className="block h-1 w-3/4 max-w-40 overflow-hidden rounded-full bg-line"
                >
                  <span className="block h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${Math.round(((progress.index + (progress.step === "upload" ? progress.fraction : 0)) / progress.total) * 100)}%` }} />
                </span>
              )}
              {images.length === 0 && <span className="text-xs text-ink-faint">Ou glissez-les ici. JPG, PNG, WebP, compressées à 300 Ko. {maxPhotos} maximum.</span>}
            </button>
          </li>
        )}
      </ul>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => addFiles(e.target.files)} />
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="image-url" className="sr-only">
            Adresse d&apos;une image (https)
          </label>
          <LinkIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input
            id="image-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Ou collez le lien d'une image (https://)"
            className="h-11 pl-10 text-sm"
            inputMode="url"
            disabled={full}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addUrl();
              }
            }}
          />
        </div>
        <Button type="button" variant="outline" onClick={addUrl} disabled={full || !url.trim()}>
          Ajouter
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        {images.length} / {maxPhotos} photo{maxPhotos > 1 ? "s" : ""} (plan {planName}). Glissez une photo pour la déplacer ; la première est la photo principale.
      </p>
    </div>
  );
}

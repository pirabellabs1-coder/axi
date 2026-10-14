"use client";

import * as React from "react";
import { ImageIcon, Link2, Loader2, Trash2, Upload } from "lucide-react";
import { Input, Label, Hint, FieldError } from "@/components/ui/field";
import { isHttpsUrl } from "@/lib/theme-engine/validate";
import { cn } from "@/lib/utils";
import { compressThemeImage, uploadImage, UploadFailedError } from "@/lib/storage/client";
import { ACCEPTED_IMAGE_TYPES } from "@/lib/storage/limits";

const ACCEPT = ACCEPTED_IMAGE_TYPES;

type ImageValue = { url: string; alt?: string } | null;

/**
 * Champ image de l'éditeur de thème : import (compression WebP dans le navigateur puis envoi au stockage
 * des médias) ou lien https. Seule l'URL est enregistrée dans le document de thème.
 */
export function ImageField({
  storeId,
  id,
  label,
  info,
  value,
  onChange,
  error,
  noAlt = false,
}: {
  storeId: string;
  id: string;
  label: string;
  info?: string;
  value: ImageValue;
  onChange: (v: ImageValue) => void;
  error?: string;
  noAlt?: boolean;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [urlMode, setUrlMode] = React.useState(false);
  const [draftUrl, setDraftUrl] = React.useState("");

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setLocalError(null);
    if (!ACCEPT.split(",").includes(file.type)) {
      setLocalError("Formats acceptés : PNG, JPEG, WebP, AVIF ou GIF.");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const blob = await compressThemeImage(file);
      const { url } = await uploadImage(storeId, "theme", blob, { onProgress: setProgress });
      onChange({ url, ...(noAlt ? {} : { alt: value?.alt ?? "" }) });
    } catch (e) {
      setLocalError(e instanceof UploadFailedError ? e.message : "Impossible de traiter cette image. Essayez une image plus légère ou un lien https.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const applyUrl = () => {
    const u = draftUrl.trim();
    if (!isHttpsUrl(u)) {
      setLocalError("Adresse https attendue, par exemple https://exemple.com/photo.jpg.");
      return;
    }
    setLocalError(null);
    onChange({ url: u, ...(noAlt ? {} : { alt: value?.alt ?? "" }) });
    setUrlMode(false);
    setDraftUrl("");
  };

  const err = localError ?? error;
  const hintId = `${id}-hint`;

  return (
    <div>
      <Label htmlFor={`${id}-file`}>{label}</Label>
      <div className={cn("flex items-center gap-3 rounded-[var(--radius-md)] bg-surface p-2 ring-1 ring-inset", err ? "ring-danger" : "ring-line-strong")}>
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-surface-2 ring-1 ring-line">
          {busy ? (
            <span className="flex flex-col items-center gap-0.5 text-[11px] font-medium tabular-nums text-ink-muted" role="status" aria-label={`Envoi de l'image : ${Math.round(progress * 100)} %`}>
              <Loader2 className="size-5 animate-spin" aria-hidden />
              {Math.round(progress * 100)} %
            </span>
          ) : value?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.url} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-5 text-ink-faint" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <button
            type="button"
            id={`${id}-file`}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-describedby={hintId}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-medium text-ink transition-colors hover:bg-line disabled:opacity-50"
          >
            <Upload className="size-3.5" aria-hidden /> {value ? "Remplacer" : "Importer"}
          </button>
          <button
            type="button"
            onClick={() => setUrlMode((v) => !v)}
            aria-expanded={urlMode}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Link2 className="size-3.5" aria-hidden /> Lien
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={`Retirer l'image « ${label} »`}
              className="inline-flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {urlMode && (
        <div className="mt-2 flex gap-2">
          <Input
            fieldSize="sm"
            type="url"
            inputMode="url"
            placeholder="https://…"
            aria-label={`Adresse de l'image « ${label} »`}
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyUrl();
              }
            }}
          />
          <button type="button" onClick={applyUrl} className="h-11 shrink-0 rounded-full bg-primary px-4 text-[13px] font-medium text-on-primary sm:h-9">
            Utiliser
          </button>
        </div>
      )}
      {value && !noAlt && (
        <div className="mt-2">
          <Label htmlFor={`${id}-alt`} className="text-[13px] text-ink-muted">
            Texte alternatif
          </Label>
          <Input
            id={`${id}-alt`}
            fieldSize="sm"
            maxLength={200}
            placeholder="Décrivez l'image pour les personnes malvoyantes"
            value={value.alt ?? ""}
            onChange={(e) => onChange({ ...value, alt: e.target.value })}
          />
        </div>
      )}
      {err ? (
        <FieldError id={hintId}>{err}</FieldError>
      ) : (
        <Hint id={hintId}>{info ?? "PNG, JPEG, WebP, AVIF ou GIF, compressée automatiquement à 300 Ko."}</Hint>
      )}
    </div>
  );
}

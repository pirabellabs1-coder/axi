"use client";

import * as React from "react";
import { Loader2, RotateCw } from "lucide-react";
import type { TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import { cn } from "@/lib/utils";
import { inlineModeMessage, parseSectionClicked, PREVIEW_MESSAGES, type SectionClick } from "@/lib/theme-engine/preview-messages";
import { previewAudienceMessage, type SimulatedAudience } from "./preview-doc";
import type { Device } from "./types";

const WIDTHS: Record<Device, number> = { desktop: 1280, tablet: 768, mobile: 390 };

/**
 * Aperçu en direct : iframe `/s/{slug}?preview=1&template=…` (même origine).
 * Envoie `{ type: "axi:theme-preview", doc }` à chaque modification et `{ type: "axi:select-section", id }` à la sélection.
 * Écoute `axi:preview-ready` (renvoi du document) et `axi:section-clicked` (sélection depuis l'aperçu), uniquement
 * depuis la fenêtre de l'iframe et la même origine. Protocole : src/lib/theme-engine/preview-messages.ts.
 * Lot 4 : `path` affiche une fiche réelle (ex. `/p/robe-wax`, produit qui utilise le modèle alternatif édité) ;
 * `audience` envoie `{ type: "axi:preview-audience", audience }` (voir docs/vague2/T2-editeur.md) ;
 * `toolbar` : contrôles de l'aperçu (audience simulée, réduction des animations).
 */
export function Preview({
  slug,
  template,
  device,
  doc,
  selectedSectionId,
  onSectionClick,
  path,
  audience = null,
  toolbar,
  inlineMode = false,
  onInlineMessage,
  postRef,
}: {
  slug: string;
  template: TemplateId;
  device: Device;
  doc: ThemeDocument;
  selectedSectionId: string | null;
  onSectionClick?: (click: SectionClick) => void;
  path?: string | null;
  audience?: SimulatedAudience | null;
  toolbar?: React.ReactNode;
  /** Lot 4 §8 : édition directe dans l'aperçu (`axi:inline-mode`). */
  inlineMode?: boolean;
  /** Messages d'édition directe reçus de l'aperçu (origine et source déjà vérifiées). */
  onInlineMessage?: (data: unknown) => void;
  /** Reçoit la fonction d'envoi vers l'aperçu (pour `axi:inline-reject`). */
  postRef?: React.RefObject<((message: unknown) => void) | null>;
}) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);
  const docRef = React.useRef(doc);
  const selRef = React.useRef(selectedSectionId);
  const audienceRef = React.useRef(audience);
  React.useEffect(() => {
    docRef.current = doc;
    selRef.current = selectedSectionId;
    audienceRef.current = audience;
  });

  const src = path ? `/s/${encodeURIComponent(slug)}${path}?preview=1` : `/s/${encodeURIComponent(slug)}?preview=1&template=${template}`;

  const post = React.useCallback((message: unknown) => {
    frame.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);
  const inlineRef = React.useRef(inlineMode);
  React.useEffect(() => {
    inlineRef.current = inlineMode;
  });
  React.useEffect(() => {
    if (postRef) postRef.current = post;
  }, [post, postRef]);

  // Lot 4 §8 : état de l'édition en place transmis à l'aperçu (et renvoyé à chaque rechargement de l'iframe).
  React.useEffect(() => {
    if (loading) return;
    post(inlineModeMessage(inlineMode));
  }, [inlineMode, loading, post]);

  // Document : envoi groupé à la frame d'animation suivante.
  React.useEffect(() => {
    if (loading) return;
    const id = requestAnimationFrame(() => post({ type: PREVIEW_MESSAGES.theme, doc }));
    return () => cancelAnimationFrame(id);
  }, [doc, loading, post]);

  React.useEffect(() => {
    if (loading) return;
    post(previewAudienceMessage(audience));
  }, [audience, loading, post]);

  React.useEffect(() => {
    if (loading || !selectedSectionId) return;
    post({ type: PREVIEW_MESSAGES.select, id: selectedSectionId });
  }, [selectedSectionId, loading, post]);

  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const data = e.data as { type?: unknown } | null;
      if (data?.type === PREVIEW_MESSAGES.ready) {
        post({ type: PREVIEW_MESSAGES.theme, doc: docRef.current });
        post(previewAudienceMessage(audienceRef.current));
        post(inlineModeMessage(inlineRef.current));
        if (selRef.current) post({ type: PREVIEW_MESSAGES.select, id: selRef.current });
        return;
      }
      const click = parseSectionClicked(e.data);
      if (click) {
        onSectionClick?.(click);
        return;
      }
      onInlineMessage?.(e.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [post, onSectionClick, onInlineMessage]);

  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Nouveau modèle de page : la frame recharge.
  const [lastSrc, setLastSrc] = React.useState(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    setLoading(true);
  }

  const width = WIDTHS[device];
  const pad = device === "desktop" ? 0 : 24;
  const scale = size.w ? Math.min(1, (size.w - pad * 2) / width) : 1;
  const height = Math.max(200, (size.h - pad * 2) / scale);

  return (
    <div ref={box} className="relative h-full w-full overflow-hidden bg-canvas-deep">
      <div
        className={cn("absolute left-1/2 top-0 origin-top", device !== "desktop" && "top-6")}
        style={{ width, height, transform: `translateX(-50%) scale(${scale})` }}
      >
        <iframe
          key={reloadKey}
          ref={frame}
          src={src}
          title="Aperçu de la boutique"
          onLoad={() => {
            setLoading(false);
            post({ type: "axi:theme-preview", doc: docRef.current });
            if (selRef.current) post({ type: "axi:select-section", id: selRef.current });
          }}
          className={cn(
            "size-full border-0 bg-white transition-opacity duration-200",
            device !== "desktop" && "rounded-[20px] shadow-[var(--shadow-lg)] ring-1 ring-line",
            loading ? "opacity-40" : "opacity-100",
          )}
        />
      </div>
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center" role="status">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[13px] text-ink-muted shadow-[var(--shadow-md)] ring-1 ring-line">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Chargement de l&apos;aperçu
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-end gap-2">
        {toolbar && <div className="pointer-events-auto mr-auto flex min-w-0 flex-wrap items-center gap-1.5">{toolbar}</div>}
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setReloadKey((k) => k + 1);
          }}
          className="pointer-events-auto inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink shadow-[var(--shadow-md)] ring-1 ring-line transition-transform duration-150 hover:bg-surface-2 active:scale-[0.97] sm:h-9"
        >
          <RotateCw className="size-3.5" aria-hidden /> Recharger
        </button>
      </div>
    </div>
  );
}

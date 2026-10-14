"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import type { RenderData } from "@/lib/storefront/render-types";
import { sanitizeThemeDocument } from "@/lib/storefront/theme-doc";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { PREVIEW_MESSAGES, isSectionId, parseInlineMode, parsePreviewOptions, resolveClickTarget, sectionClickedMessage } from "@/lib/theme-engine/preview-messages";
import { InlineEditLayer } from "./inline-edit";
import type { AudienceContext } from "@/lib/theme-engine/audience";
import type { MotionEnv } from "@/lib/theme-engine/motion";
import { parsePreviewAudience } from "./preview-audience";
import { StoreFrame } from "./store-frame";
import { TemplateRenderer } from "./template-renderer";

const TARGET_SELECTOR = "[data-section-id],[data-section-group]";
const GROUP_LABELS: Record<string, string> = { header: "En-tête", footer: "Pied de page" };

/** Nom lisible d'une cible de l'aperçu (section ou groupe global), posé en `data-section-label` pour l'étiquette CSS. */
function labelTarget(el: HTMLElement) {
  if (el.hasAttribute("data-section-label")) return;
  const group = el.getAttribute("data-section-group");
  const type = el.getAttribute("data-section-type");
  const label = group ? GROUP_LABELS[group] : type ? (SECTION_SCHEMAS[type as keyof typeof SECTION_SCHEMAS]?.name ?? type) : null;
  if (label) el.setAttribute("data-section-label", label);
}

/**
 * Aperçu en direct de l'éditeur (iframe `/s/{slug}?preview=1&template=…`, membres uniquement).
 * Protocole complet : src/lib/theme-engine/preview-messages.ts et docs/CONSTRUCTEUR-BOUTIQUE.md.
 * Messages acceptés (même origine, fenêtre parente uniquement) :
 *  - { type: "axi:theme-preview", doc } → revalidation défensive puis nouveau rendu, sans rechargement ;
 *  - { type: "axi:select-section", id } → défilement vers la section et contour ;
 *  - { type: "axi:preview-options", allowNavigation?, reduceMotion? } → navigation par les liens, « Réduire les animations ».
 *  - { type: "axi:preview-audience", audience } → visiteur simulé (lot 4 §12) ;
 *  - { type: "axi:inline-mode", enabled } → édition directe dans l'aperçu (lot 4 §8, voir inline-edit.tsx).
 * Envoie au parent « axi:preview-ready » au montage, et « axi:section-clicked » au clic sur une section,
 * l'en-tête ou le pied de page. Survol / focus : contour léger + nom de la section. Dans l'iframe, les liens
 * et formulaires ne naviguent pas (sauf `allowNavigation`).
 */
export function LivePreview({ initialDoc, template, data, templateSuffix = null, motionEnv }: { initialDoc: ThemeDocument; template: TemplateId; data: RenderData; templateSuffix?: string | null; motionEnv?: MotionEnv }) {
  const [doc, setDoc] = useState(initialDoc);
  const [selected, setSelected] = useState<string | null>(null);
  // Lot 4 : audience simulée (`axi:preview-audience`, défaut : visiteur par défaut) et « Réduire les animations ».
  const [audience, setAudience] = useState<AudienceContext | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Lot 4 §8 : édition en place, désactivée par défaut (activée par `axi:inline-mode`).
  const [inlineMode, setInlineMode] = useState(false);
  const inlineEditing = useRef(false);
  const pendingDoc = useRef<unknown>(null);
  const allowNavigation = useRef(false);

  /** Fin de saisie : le dernier document reçu pendant la frappe est appliqué. */
  const onEditingChange = useCallback((editing: boolean) => {
    inlineEditing.current = editing;
    if (editing || pendingDoc.current == null) return;
    const next = pendingDoc.current;
    pendingDoc.current = null;
    setDoc((cur) => sanitizeThemeDocument(next, cur));
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Uniquement dans l'iframe de l'éditeur, et uniquement les messages de la fenêtre parente de même origine.
      if (window.parent === window || e.origin !== window.location.origin || e.source !== window.parent) return;
      const m = e.data as { type?: unknown; doc?: unknown; id?: unknown; allowNavigation?: unknown } | null;
      if (!m || typeof m !== "object") return;
      if (m.type === PREVIEW_MESSAGES.theme) {
        // Saisie en place en cours : on diffère le nouveau rendu (il déplacerait le curseur).
        if (inlineEditing.current) pendingDoc.current = m.doc;
        else setDoc((cur) => sanitizeThemeDocument(m.doc, cur));
      }
      else if (m.type === PREVIEW_MESSAGES.select) setSelected(isSectionId(m.id) ? m.id : null);
      else if (m.type === PREVIEW_MESSAGES.options) {
        const o = parsePreviewOptions(m);
        if (o?.allowNavigation !== undefined) allowNavigation.current = o.allowNavigation;
        if (o?.reduceMotion !== undefined) setReduceMotion(o.reduceMotion);
      } else if (m.type === PREVIEW_MESSAGES.audience) {
        const a = parsePreviewAudience(m, { now: new Date(data.now) });
        if (a) setAudience(a);
      } else if (m.type === PREVIEW_MESSAGES.inlineMode) {
        const im = parseInlineMode(m);
        if (im) setInlineMode(im.enabled);
      }
    };
    window.addEventListener("message", onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: PREVIEW_MESSAGES.ready, template }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [template, data.now]);

  // Clic / survol / focus dans l'iframe de l'éditeur : sélection de la section côté éditeur.
  useEffect(() => {
    if (window.parent === window) return;
    const origin = window.location.origin;
    let hovered: HTMLElement | null = null;

    const targetOf = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>(TARGET_SELECTOR) : null);
    const setHovered = (el: HTMLElement | null) => {
      if (el === hovered) return;
      hovered?.removeAttribute("data-hovered");
      hovered = el;
      if (el) {
        labelTarget(el);
        el.setAttribute("data-hovered", "true");
      }
    };

    const onClick = (e: MouseEvent) => {
      const el = targetOf(e.target);
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (link && !allowNavigation.current) {
        // Capture sur le document : avant les gestionnaires React (Link de Next compris).
        e.preventDefault();
        e.stopPropagation();
      }
      if (!el) return;
      const target = resolveClickTarget([{ sectionId: el.getAttribute("data-section-id"), group: el.getAttribute("data-section-group") }]);
      if (!target) return;
      window.parent.postMessage(sectionClickedMessage("id" in target ? { id: target.id, template } : target), origin);
    };
    const onSubmit = (e: SubmitEvent) => {
      if (allowNavigation.current) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onOver = (e: Event) => setHovered(targetOf(e.target));
    const onLeave = () => setHovered(null);

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("focusin", onOver, true);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("focusin", onOver, true);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      setHovered(null);
    };
  }, [template]);

  // Sélection : contour + étiquette + défilement (après le rendu du nouveau document).
  useEffect(() => {
    document.querySelectorAll("[data-section-id][data-selected]").forEach((el) => el.removeAttribute("data-selected"));
    if (!selected) return;
    const el = document.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(selected)}"]`);
    if (!el) return;
    el.setAttribute("data-selected", "true");
    labelTarget(el);
    el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [selected, doc]);

  const env: MotionEnv = { ...motionEnv, reduce: reduceMotion || motionEnv?.reduce };
  return (
    <StoreFrame doc={doc} data={data} preview motionEnv={env} template={template}>
      <TemplateRenderer doc={doc} template={template} data={data} preview templateSuffix={templateSuffix} audience={audience} motionEnv={env} />
      <InlineEditLayer doc={doc} template={template} enabled={inlineMode} selectedSectionId={selected} onEditingChange={onEditingChange} />
    </StoreFrame>
  );
}

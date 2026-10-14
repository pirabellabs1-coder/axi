"use client";

import * as React from "react";
import { editAttrs } from "@/lib/theme-engine/edit-attrs";
import {
  imageDropMessage,
  inlineChangeMessage,
  isAcceptedInlineImage,
  parseInlineReject,
  sectionActionMessage,
  SECTION_ACTIONS,
  type InlineTarget,
  type SectionActionId,
} from "@/lib/theme-engine/preview-messages";
import type { SectionInstance, TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import { inlineImageTarget, inlineTextTargets, normalizeText, plainFromMarkdown } from "./inline-edit-targets";

/**
 * Lot 4 §8 : édition directe dans l'aperçu (côté APERÇU, dans l'iframe).
 *
 * - marquage : les éléments qui affichent un réglage texte reçoivent `data-edit` / `data-edit-kind`
 *   (produits par `editAttrs`, donc en aperçu uniquement) ; aucune modification des composants de section ;
 * - `text` / `textarea` : `contenteditable="plaintext-only"` au clic (ou F2 au clavier) ; Entrée valide,
 *   Échap annule, la perte de focus valide ; chaque frappe envoie `axi:inline-change` en phase `input`,
 *   la validation en phase `commit` (c'est l'éditeur qui écrit dans le document et l'historique) ;
 * - `richtext` et champs liés à une source dynamique : non éditables en place, une bulle l'explique ;
 * - dépôt d'une image du système sur une section qui a un champ image : `axi:image-drop` ;
 * - barre d'actions flottante sur la section sélectionnée : `axi:section-action`.
 *
 * L'aperçu ne modifie JAMAIS le document : il ne fait que proposer des changements à l'éditeur, qui valide.
 */

const EDITABLE_SELECTOR = "h1,h2,h3,h4,h5,h6,p,span,a,li,blockquote,figcaption,dt,dd,summary,td,th,div,button";
const MARK_ATTR = "data-edit";

type Bubble = { message: string; x: number; y: number } | null;

const ACTION_LABELS: Record<SectionActionId, string> = {
  "move-up": "Monter",
  "move-down": "Descendre",
  duplicate: "Dupliquer",
  hide: "Masquer",
  "insert-after": "Ajouter une section après",
  remove: "Supprimer",
};

function post(message: unknown) {
  if (window.parent === window) return;
  window.parent.postMessage(message, window.location.origin);
}

/** Élément le plus profond dont le texte correspond à la valeur du réglage (et qui n'est pas déjà pris). */
function findElementFor(root: HTMLElement, text: string, taken: Set<Element>): HTMLElement | null {
  const wanted = normalizeText(text);
  if (!wanted) return null;
  const candidates: HTMLElement[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR))) {
    if (taken.has(el) || el.hasAttribute(MARK_ATTR)) continue;
    if (normalizeText(el.textContent ?? "") !== wanted) continue;
    candidates.push(el);
  }
  // Le plus profond : aucun autre candidat à l'intérieur.
  return candidates.find((el) => !candidates.some((other) => other !== el && el.contains(other))) ?? null;
}

function markSection(el: HTMLElement, section: SectionInstance) {
  for (const old of Array.from(el.querySelectorAll<HTMLElement>(`[${MARK_ATTR}]`))) {
    for (const a of ["data-edit", "data-edit-kind", "data-edit-dynamic", "data-edit-label", "tabindex", "aria-label"]) old.removeAttribute(a);
  }
  const taken = new Set<Element>();
  for (const t of inlineTextTargets(section)) {
    const text = t.kind === "richtext" ? plainFromMarkdown(t.value) : t.value;
    const node = t.dynamic ? null : findElementFor(el, text, taken);
    if (!node) continue;
    taken.add(node);
    const attrs = editAttrs({ preview: true }, { sectionId: t.sectionId, blockId: t.blockId, settingId: t.settingId, kind: t.kind });
    if (!attrs["data-edit"]) continue;
    node.setAttribute("data-edit", attrs["data-edit"]);
    node.setAttribute("data-edit-kind", attrs["data-edit-kind"]!);
    node.setAttribute("data-edit-label", t.label);
    if (t.dynamic) node.setAttribute("data-edit-dynamic", "true");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", `Modifier : ${t.label}`);
  }
  // Champs liés à une source dynamique : repérés pour la bulle d'explication.
  for (const t of inlineTextTargets(section).filter((x) => x.dynamic)) {
    const node = findElementFor(el, t.label, taken);
    if (node) node.setAttribute("data-edit-dynamic", "true");
  }
  const img = inlineImageTarget(section);
  if (img && !img.dynamic) el.setAttribute("data-edit-image", `${img.sectionId}:${img.blockId ?? "-"}:${img.settingId}`);
  else el.removeAttribute("data-edit-image");
}

function targetOf(el: HTMLElement): InlineTarget | null {
  const raw = el.getAttribute("data-edit") ?? el.getAttribute("data-edit-image");
  if (!raw) return null;
  const [sectionId, blockId, settingId] = raw.split(":");
  if (!sectionId || !settingId) return null;
  return { sectionId, blockId: blockId === "-" ? null : blockId, settingId };
}

export function InlineEditLayer({
  doc,
  template,
  enabled,
  selectedSectionId,
  onEditingChange,
}: {
  doc: ThemeDocument;
  template: TemplateId;
  enabled: boolean;
  selectedSectionId: string | null;
  /** Prévient l'aperçu qu'une saisie est en cours : le document reçu entre-temps est mis en attente
   *  (sinon un nouveau rendu replacerait le curseur au milieu de la frappe). */
  onEditingChange?: (editing: boolean) => void;
}) {
  const [bubble, setBubble] = React.useState<Bubble>(null);
  const [bar, setBar] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const editing = React.useRef<{ el: HTMLElement; original: string; target: InlineTarget; kind: string } | null>(null);

  const say = React.useCallback((el: Element | null, message: string) => {
    const r = el?.getBoundingClientRect();
    setBubble({ message, x: r ? r.left + r.width / 2 : window.innerWidth / 2, y: r ? Math.max(8, r.top - 8) : 40 });
    window.setTimeout(() => setBubble((b) => (b?.message === message ? null : b)), 4000);
  }, []);

  /* ───────── Marquage (après chaque rendu du document) ───────── */
  React.useEffect(() => {
    if (!enabled) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${MARK_ATTR}],[data-edit-image]`))) {
        for (const a of ["data-edit", "data-edit-kind", "data-edit-dynamic", "data-edit-label", "data-edit-image", "tabindex", "aria-label"]) el.removeAttribute(a);
      }
      return;
    }
    const tpl = doc.templates[template];
    const markAll = () => {
      // Pendant une saisie, le DOM appartient au champ en cours : on ne le remarque pas.
      if (editing.current) return;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-section-id]"))) {
        const sectionId = el.getAttribute("data-section-id");
        const section = sectionId ? tpl?.sections[sectionId] : null;
        if (section) markSection(el, section);
      }
    };
    // Le rendu des sections peut arriver après le document (images, flux SSR) : on repasse quelques fois,
    // puis on suit les changements du DOM tant que l'édition en place est active.
    const timers = [0, 200, 600, 1500, 3000].map((d) => window.setTimeout(markAll, d));
    let debounce = 0;
    const observer = new MutationObserver(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(markAll, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(debounce);
      observer.disconnect();
    };
  }, [doc, template, enabled]);

  /* ───────── Édition en place ───────── */
  const editingChange = React.useRef(onEditingChange);
  React.useEffect(() => {
    editingChange.current = onEditingChange;
  });

  const endEdit = React.useCallback((restore: boolean) => {
    const cur = editing.current;
    if (!cur) return;
    editing.current = null;
    editingChange.current?.(false);
    if (restore) cur.el.textContent = cur.original;
    cur.el.removeAttribute("contenteditable");
    cur.el.removeAttribute("data-editing");
  }, []);

  const commit = React.useCallback(() => {
    const cur = editing.current;
    if (!cur) return;
    const value = (cur.el.textContent ?? "").replace(/ /g, " ");
    editing.current = null;
    editingChange.current?.(false);
    cur.el.removeAttribute("contenteditable");
    cur.el.removeAttribute("data-editing");
    if (normalizeText(value) !== normalizeText(cur.original)) post(inlineChangeMessage(cur.target, value, "commit", template));
  }, [template]);

  const startEdit = React.useCallback(
    (el: HTMLElement) => {
      const kind = el.getAttribute("data-edit-kind");
      const target = targetOf(el);
      if (!target) return;
      if (el.hasAttribute("data-edit-dynamic")) {
        say(el, "Donnée du produit : modifiez le produit pour changer ce texte.");
        return;
      }
      if (kind !== "text" && kind !== "textarea") {
        say(el, "Texte enrichi : modifiez-le dans le panneau « Réglages ».");
        return;
      }
      if (editing.current?.el === el) return;
      commit();
      editing.current = { el, original: el.textContent ?? "", target, kind };
      editingChange.current?.(true);
      el.setAttribute("contenteditable", "plaintext-only");
      el.setAttribute("data-editing", "true");
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    },
    [commit, say],
  );

  React.useEffect(() => {
    if (!enabled) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(`[${MARK_ATTR}]`) : null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      startEdit(el);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el) return;
      if (editing.current?.el === el) {
        if (e.key === "Escape") {
          e.preventDefault();
          endEdit(true);
          el.blur();
        } else if (e.key === "Enter" && !e.shiftKey && editing.current.kind === "text") {
          e.preventDefault();
          commit();
          el.blur();
        }
        return;
      }
      if (e.key === "F2" && el.hasAttribute(MARK_ATTR)) {
        e.preventDefault();
        startEdit(el);
      }
    };
    const onInput = () => {
      const cur = editing.current;
      if (cur) post(inlineChangeMessage(cur.target, (cur.el.textContent ?? "").replace(/ /g, " "), "input", template));
    };
    const onBlur = () => commit();

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("focusout", onBlur, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("focusout", onBlur, true);
      endEdit(true);
    };
  }, [enabled, startEdit, commit, endEdit, template]);

  /* ───────── Refus envoyé par l'éditeur ───────── */
  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (window.parent === window || e.origin !== window.location.origin || e.source !== window.parent) return;
      const reject = parseInlineReject(e.data);
      if (!reject) return;
      const sel = `[data-edit="${CSS.escape(`${reject.target.sectionId}:${reject.target.blockId ?? "-"}:${reject.target.settingId}`)}"]`;
      const el = document.querySelector<HTMLElement>(sel);
      const cur = editing.current;
      if (cur && cur.el === el) endEdit(true);
      say(el, reject.message);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [endEdit, say]);

  /* ───────── Dépôt d'image sur une section ───────── */
  React.useEffect(() => {
    if (!enabled) return;
    let active: HTMLElement | null = null;
    const setActive = (el: HTMLElement | null) => {
      if (active === el) return;
      active?.removeAttribute("data-drop-active");
      active = el;
      active?.setAttribute("data-drop-active", "true");
    };
    const sectionOf = (e: DragEvent) => (e.target instanceof Element ? e.target.closest<HTMLElement>("[data-edit-image]") : null);
    const onOver = (e: DragEvent) => {
      const el = sectionOf(e);
      if (!el || !e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setActive(el);
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setActive(null);
    };
    const onDrop = (e: DragEvent) => {
      const el = sectionOf(e);
      if (!el) return;
      e.preventDefault();
      setActive(null);
      const file = e.dataTransfer?.files?.[0];
      const target = targetOf(el);
      if (!target) return;
      if (!file) return;
      if (!isAcceptedInlineImage(file)) {
        say(el, "Image refusée : JPEG, PNG, WebP ou AVIF, 5 Mo maximum.");
        return;
      }
      post(imageDropMessage(target, file));
    };
    document.addEventListener("dragover", onOver, true);
    document.addEventListener("dragleave", onLeave, true);
    document.addEventListener("drop", onDrop, true);
    return () => {
      document.removeEventListener("dragover", onOver, true);
      document.removeEventListener("dragleave", onLeave, true);
      document.removeEventListener("drop", onDrop, true);
      setActive(null);
    };
  }, [enabled, say]);

  /* ───────── Barre d'actions flottante sur la section sélectionnée ───────── */
  React.useEffect(() => {
    if (!enabled || !selectedSectionId) {
      const off = requestAnimationFrame(() => setBar(null));
      return () => cancelAnimationFrame(off);
    }
    const place = () => {
      const el = document.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(selectedSectionId)}"]`);
      if (!el) {
        setBar(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setBar({ top: Math.max(8, r.top + 8), left: r.left + r.width / 2, width: r.width });
    };
    // Position calculée après le rendu (jamais pendant l'effet : évite les rendus en cascade).
    const first = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [enabled, selectedSectionId, doc]);

  if (!enabled) return null;

  return (
    <>
      <style>{INLINE_CSS}</style>
      {bar && selectedSectionId && (
        <div className="axi-inline-bar" style={{ top: bar.top, left: bar.left }} role="toolbar" aria-label="Actions de la section">
          {SECTION_ACTIONS.map((a) => (
            <button key={a} type="button" title={ACTION_LABELS[a]} aria-label={ACTION_LABELS[a]} onClick={() => post(sectionActionMessage(selectedSectionId, a, template))}>
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>
      )}
      {bubble && (
        <div className="axi-inline-bubble" style={{ top: bubble.y, left: bubble.x }} role="status">
          {bubble.message}
        </div>
      )}
    </>
  );
}

/**
 * Styles de l'édition en place (dans l'iframe d'aperçu uniquement). Contour de focus visible,
 * cibles d'au moins 44 px dans la barre d'actions, animations réduites honorées par le navigateur.
 */
const INLINE_CSS = `
[data-edit]{outline:1px dashed color-mix(in srgb, currentColor 35%, transparent);outline-offset:3px;cursor:text;border-radius:3px}
[data-edit]:hover{outline-style:solid;outline-color:#2563eb}
[data-edit]:focus-visible{outline:3px solid #2563eb;outline-offset:3px}
[data-edit][data-edit-dynamic]{cursor:not-allowed}
[data-edit][data-editing]{outline:2px solid #2563eb;outline-offset:3px;background:color-mix(in srgb,#2563eb 8%,transparent)}
[data-edit-image][data-drop-active]{outline:3px dashed #2563eb;outline-offset:-6px;position:relative}
[data-edit-image][data-drop-active]::after{content:"Déposer pour remplacer l'image";position:absolute;inset-inline:0;top:50%;transform:translateY(-50%);text-align:center;font:600 14px/1.4 system-ui,sans-serif;color:#fff;background:rgba(37,99,235,.92);padding:10px;pointer-events:none}
.axi-inline-bar{position:fixed;z-index:2147483000;transform:translateX(-50%);display:flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:999px;background:#111;box-shadow:0 6px 24px rgba(0,0,0,.28)}
.axi-inline-bar button{min-height:44px;min-width:44px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:#fff;font:500 12.5px/1 system-ui,sans-serif;cursor:pointer}
.axi-inline-bar button:hover{background:rgba(255,255,255,.14)}
.axi-inline-bar button:focus-visible{outline:2px solid #fff;outline-offset:2px}
.axi-inline-bubble{position:fixed;z-index:2147483001;transform:translate(-50%,-100%);max-width:280px;padding:8px 12px;border-radius:10px;background:#111;color:#fff;font:500 13px/1.35 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.28);pointer-events:none}
@media (max-width:600px){.axi-inline-bar button{padding:0 8px;font-size:12px}}
`;

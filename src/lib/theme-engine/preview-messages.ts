/**
 * Protocole `postMessage` entre l'éditeur de thème et son aperçu (iframe `/s/{slug}?preview=1&template=…`, même origine).
 * Module pur, partagé par les deux côtés et testé (tests/theme-preview-messages.test.ts). Voir docs/CONSTRUCTEUR-BOUTIQUE.md.
 *
 * Lot 4 §8 (édition directe) : éditeur → aperçu `axi:inline-mode` { enabled }, `axi:inline-reject` { target, message } ;
 *   aperçu → éditeur `axi:inline-change` { target, value, phase }, `axi:image-drop` { target, file },
 *   `axi:section-action` { id, action }. Parseurs défensifs ci-dessous (tests/preview-messages-inline.test.ts).
 *
 * Éditeur → aperçu : `axi:theme-preview` { doc }, `axi:select-section` { id },
 *   `axi:preview-options` { allowNavigation?, reduceMotion? } (lot 4 : « Réduire les animations »),
 *   `axi:preview-audience` { audience: objet | null } (lot 4 §12 : visiteur simulé, `null` = règles ignorées).
 * Aperçu → éditeur : `axi:preview-ready` { template }, `axi:section-clicked` { id, template } ou { group }.
 */
import type { TemplateId } from "./types";

export const PREVIEW_MESSAGES = {
  ready: "axi:preview-ready",
  theme: "axi:theme-preview",
  select: "axi:select-section",
  options: "axi:preview-options",
  sectionClicked: "axi:section-clicked",
  /** Lot 4 §12 : audience simulée (lue par `src/components/storefront/preview-audience.ts`). */
  audience: "axi:preview-audience",
  /* Lot 4 §8 : édition directe dans l'aperçu (éditeur ⇄ aperçu). */
  inlineMode: "axi:inline-mode",
  inlineChange: "axi:inline-change",
  inlineReject: "axi:inline-reject",
  imageDrop: "axi:image-drop",
  sectionAction: "axi:section-action",
} as const;

/** Options d'aperçu : toutes facultatives, une option absente laisse l'état de l'aperçu inchangé. */
export type PreviewOptions = { allowNavigation?: boolean; reduceMotion?: boolean };
export type PreviewOptionsMessage = { type: typeof PREVIEW_MESSAGES.options } & PreviewOptions;

export function previewOptionsMessage(opts: PreviewOptions): PreviewOptionsMessage {
  return { type: PREVIEW_MESSAGES.options, ...opts };
}

/** Lecture défensive d'un `axi:preview-options` : seules les options booléennes sont retenues ; `null` pour tout autre message. */
export function parsePreviewOptions(data: unknown): PreviewOptions | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown; allowNavigation?: unknown; reduceMotion?: unknown };
  if (m.type !== PREVIEW_MESSAGES.options) return null;
  const out: PreviewOptions = {};
  if (typeof m.allowNavigation === "boolean") out.allowNavigation = m.allowNavigation;
  if (typeof m.reduceMotion === "boolean") out.reduceMotion = m.reduceMotion;
  return out;
}

const TEMPLATE_IDS: readonly TemplateId[] = ["home", "product", "collection", "catalog", "page", "cart", "search", "not_found", "blog", "article"];
const SECTION_ID = /^[\w-]{1,64}$/;

/** Groupes globaux cliquables dans l'aperçu (hors sections du modèle). */
export const PREVIEW_GROUPS = ["header", "footer"] as const;
export type PreviewGroup = (typeof PREVIEW_GROUPS)[number];

export function isSectionId(v: unknown): v is string {
  return typeof v === "string" && SECTION_ID.test(v);
}

export function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === "string" && (TEMPLATE_IDS as readonly string[]).includes(v);
}

export type SectionClickedMessage =
  | { type: typeof PREVIEW_MESSAGES.sectionClicked; id: string; template?: TemplateId }
  | { type: typeof PREVIEW_MESSAGES.sectionClicked; group: PreviewGroup };

/** Message envoyé par l'aperçu au clic sur une section (ou sur l'en-tête / le pied de page). */
export function sectionClickedMessage(target: { id: string; template?: TemplateId } | { group: PreviewGroup }): SectionClickedMessage {
  return { type: PREVIEW_MESSAGES.sectionClicked, ...target };
}

export type SectionClick = { kind: "section"; id: string; template: TemplateId | null } | { kind: "group"; group: PreviewGroup };

/**
 * Lecture défensive d'un `axi:section-clicked` reçu par l'éditeur (l'origine et la source sont vérifiées par l'appelant).
 * Renvoie `null` pour tout autre message ou toute valeur invalide.
 */
export function parseSectionClicked(data: unknown): SectionClick | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown; id?: unknown; template?: unknown; group?: unknown };
  if (m.type !== PREVIEW_MESSAGES.sectionClicked) return null;
  if (typeof m.group === "string") return (PREVIEW_GROUPS as readonly string[]).includes(m.group) ? { kind: "group", group: m.group as PreviewGroup } : null;
  if (!isSectionId(m.id)) return null;
  return { kind: "section", id: m.id, template: isTemplateId(m.template) ? m.template : null };
}

/* ───────────────────────── Lot 4 §8 : édition directe dans l'aperçu ─────────────────────────
 *
 * Tous les parseurs ci-dessous sont DÉFENSIFS : l'aperçu est une iframe, l'origine et la source sont vérifiées
 * par l'appelant, mais le contenu du message est revérifié champ par champ (identifiants, longueurs, types).
 * L'éditeur revalide ensuite la valeur contre le schéma du champ avant de l'appliquer.
 */

/** Longueur maximale d'une valeur texte envoyée par l'aperçu (le champ a en général une limite plus basse). */
export const MAX_INLINE_VALUE = 5000;
/** Image déposée sur une section : formats et taille acceptés côté aperçu (revérifiés au téléversement). */
export const INLINE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

export const SECTION_ACTIONS = ["move-up", "move-down", "duplicate", "hide", "remove", "insert-after"] as const;
export type SectionActionId = (typeof SECTION_ACTIONS)[number];

export type InlineTarget = { sectionId: string; blockId: string | null; settingId: string };
export type InlinePhase = "input" | "commit";

export type InlineModeMessage = { type: typeof PREVIEW_MESSAGES.inlineMode; enabled: boolean };
export type InlineChangeMessage = { type: typeof PREVIEW_MESSAGES.inlineChange; target: InlineTarget; value: string; phase: InlinePhase; template?: TemplateId };
export type InlineRejectMessage = { type: typeof PREVIEW_MESSAGES.inlineReject; target: InlineTarget; message: string };
export type ImageDropMessage = { type: typeof PREVIEW_MESSAGES.imageDrop; target: InlineTarget; file: File };
export type SectionActionMessage = { type: typeof PREVIEW_MESSAGES.sectionAction; id: string; action: SectionActionId; template?: TemplateId };

export function inlineModeMessage(enabled: boolean): InlineModeMessage {
  return { type: PREVIEW_MESSAGES.inlineMode, enabled };
}

export function inlineChangeMessage(target: InlineTarget, value: string, phase: InlinePhase, template?: TemplateId): InlineChangeMessage {
  return { type: PREVIEW_MESSAGES.inlineChange, target, value, phase, ...(template ? { template } : {}) };
}

export function inlineRejectMessage(target: InlineTarget, message: string): InlineRejectMessage {
  return { type: PREVIEW_MESSAGES.inlineReject, target, message: String(message).slice(0, 200) };
}

export function imageDropMessage(target: InlineTarget, file: File): ImageDropMessage {
  return { type: PREVIEW_MESSAGES.imageDrop, target, file };
}

export function sectionActionMessage(id: string, action: SectionActionId, template?: TemplateId): SectionActionMessage {
  return { type: PREVIEW_MESSAGES.sectionAction, id, action, ...(template ? { template } : {}) };
}

/** Cible valide (`sectionId`, `blockId` facultatif, `settingId`), sinon null. */
export function parseInlineTarget(v: unknown): InlineTarget | null {
  if (!v || typeof v !== "object") return null;
  const t = v as { sectionId?: unknown; blockId?: unknown; settingId?: unknown };
  if (!isSectionId(t.sectionId) || !isSectionId(t.settingId)) return null;
  if (t.blockId != null && !isSectionId(t.blockId)) return null;
  return { sectionId: t.sectionId, blockId: typeof t.blockId === "string" ? t.blockId : null, settingId: t.settingId };
}

/** `axi:inline-mode` (éditeur → aperçu). */
export function parseInlineMode(data: unknown): { enabled: boolean } | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown; enabled?: unknown };
  if (m.type !== PREVIEW_MESSAGES.inlineMode || typeof m.enabled !== "boolean") return null;
  return { enabled: m.enabled };
}

/** `axi:inline-change` (aperçu → éditeur) : valeur texte brute, longueur plafonnée, phase connue. */
export function parseInlineChange(data: unknown): { target: InlineTarget; value: string; phase: InlinePhase; template: TemplateId | null } | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown; target?: unknown; value?: unknown; phase?: unknown; template?: unknown };
  if (m.type !== PREVIEW_MESSAGES.inlineChange) return null;
  const target = parseInlineTarget(m.target);
  if (!target) return null;
  if (typeof m.value !== "string" || m.value.length > MAX_INLINE_VALUE) return null;
  if (m.phase !== "input" && m.phase !== "commit") return null;
  return { target, value: m.value, phase: m.phase, template: isTemplateId(m.template) ? m.template : null };
}

/** `axi:inline-reject` (éditeur → aperçu). */
export function parseInlineReject(data: unknown): { target: InlineTarget; message: string } | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown; target?: unknown; message?: unknown };
  if (m.type !== PREVIEW_MESSAGES.inlineReject) return null;
  const target = parseInlineTarget(m.target);
  if (!target || typeof m.message !== "string") return null;
  return { target, message: m.message.slice(0, 200) };
}

/** Fichier image accepté par l'édition directe (type et taille). `File` est transmis par clone structuré. */
export function isAcceptedInlineImage(v: unknown): v is File {
  if (typeof File === "undefined" || !(v instanceof File)) return false;
  return (INLINE_IMAGE_TYPES as readonly string[]).includes(v.type) && v.size > 0 && v.size <= MAX_INLINE_IMAGE_BYTES;
}

/** `axi:image-drop` (aperçu → éditeur) : le `File` est vérifié ici, puis de nouveau par le serveur au téléversement. */
export function parseImageDrop(data: unknown): { target: InlineTarget; file: File } | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown; target?: unknown; file?: unknown };
  if (m.type !== PREVIEW_MESSAGES.imageDrop) return null;
  const target = parseInlineTarget(m.target);
  if (!target || !isAcceptedInlineImage(m.file)) return null;
  return { target, file: m.file };
}

/** `axi:section-action` (aperçu → éditeur) : barre d'actions flottante. */
export function parseSectionAction(data: unknown): { id: string; action: SectionActionId; template: TemplateId | null } | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown; id?: unknown; action?: unknown; template?: unknown };
  if (m.type !== PREVIEW_MESSAGES.sectionAction) return null;
  if (!isSectionId(m.id) || typeof m.action !== "string" || !(SECTION_ACTIONS as readonly string[]).includes(m.action)) return null;
  return { id: m.id, action: m.action as SectionActionId, template: isTemplateId(m.template) ? m.template : null };
}

/**
 * Cible d'un clic dans l'aperçu : section la plus proche (`data-section-id`), sinon en-tête / pied de page
 * (`data-section-group`). Fonction pure sur une chaîne d'ancêtres (testable sans DOM).
 */
export function resolveClickTarget(chain: { sectionId?: string | null; group?: string | null }[]): { id: string } | { group: PreviewGroup } | null {
  for (const n of chain) {
    if (isSectionId(n.sectionId)) return { id: n.sectionId };
    if (n.group && (PREVIEW_GROUPS as readonly string[]).includes(n.group)) return { group: n.group as PreviewGroup };
  }
  return null;
}

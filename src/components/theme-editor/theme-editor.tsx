"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  CloudOff,
  ExternalLink,
  History as HistoryIcon,
  Loader2,
  Lock,
  Monitor,
  Redo2,
  Rocket,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import * as ops from "@/lib/theme-engine/operations";
import { ThemeOpError } from "@/lib/theme-engine/operations";
import { createHistory, pushHistory, redo as redoH, undo as undoH, type History } from "@/lib/theme-engine/editor-history";
import { checkBinding } from "@/lib/theme-engine/dynamic-sources";
import { EDITABLE_TEMPLATES } from "@/lib/theme-engine/editor-defaults";
import { issueKey, validateThemeDocument, type ValidationIssue } from "@/lib/theme-engine/validate";
import type { SectionType, TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import { changeThemePreset, discardThemeDraft, publishTheme, restoreThemeVersion, saveThemeDraft } from "@/lib/theme/actions";
import { deleteAlternateTemplate, renameAlternateTemplate } from "@/lib/theme/alternate-actions";
import { PLANS, type PlanId } from "@/config/plans";
import { DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { Alert } from "@/components/ui/misc";
import { cn, formatDateTime } from "@/lib/utils";
import { AddSectionDialog } from "./add-section-dialog";
import { Inspector, type InspectorActions } from "./inspector";
import { Preview } from "./preview";
import { SectionTree, sectionLabel, type TreeActions } from "./section-tree";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import { BrandingPanel, PresetPanel, ThemeSettingsList } from "./theme-settings";
import type { Device, EditorLibraryItem, EditorLot4, EditorPreset, EditorResources, EditorSavedSection, EditorVersion, Selection } from "./types";
import { AlternateManager } from "./alternate-picker";
import { ALTERNATE_TYPE_LABELS, alternateSuffixes, isAlternateType, normalizeTarget, parseTargetValue, projectTarget, targetKey } from "./editor-target";
import { MotionPanel, motionOf, MOTION_PRESET_LABELS } from "./motion-panel";
import { previewDocument, type SimulatedAudience } from "./preview-doc";
import { AudienceSimulator, PreviewOwnerSelect, ReduceMotionToggle } from "./preview-toolbar";
import { SaveSectionDialog } from "./saved-sections";
import { QualityPanel } from "./quality-panel";
import { applyIssueFix, issueDestination, overallScore } from "./quality-fix";
import { scoreTheme, type Issue } from "@/lib/theme-engine/quality";
import { deleteSavedSectionItem, fetchLibraryPayload, fetchSavedPayload, saveSectionToLibrary } from "./saved-sections-bridge";
import { useInlineBridge } from "./inline-bridge";
import { DesignAssistantPanel, InlineEditToggle } from "./design-assistant";
import { ASSISTANT_OPERATIONS, MAX_ASSISTANT_OPERATIONS } from "@/lib/ai/design/assistant";
import type { SectionActionId } from "@/lib/theme-engine/preview-messages";

type Props = {
  storeId: string;
  storeName: string;
  slug: string;
  /** La boutique est-elle déjà en ligne (visible des clients) ? Pilote le badge et le message de publication. */
  storeOnline: boolean;
  initialDoc: ThemeDocument;
  publishedDoc: ThemeDocument | null;
  recovered: boolean;
  resources: EditorResources;
  presets: EditorPreset[];
  presetLimit: number | null;
  versionHistory: boolean;
  versions: EditorVersion[];
  showPoweredBy: boolean;
  canRemoveBranding: boolean;
  /** Lot 4 (vague 2) : plan, modèles alternatifs, sources dynamiques, sections enregistrées, qualité. */
  lot4: EditorLot4;
};

const AUTOSAVE_MS = 1200;
const QUALITY_DEBOUNCE_MS = 500;

/** Retire les métadonnées (updatedAt) pour comparer les documents. */
function clean(doc: ThemeDocument): ThemeDocument {
  const rest = { ...doc };
  delete rest.updatedAt;
  return rest;
}

function errorMap(issues: ValidationIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) out[issueKey(i.path)] ??= i.message;
  return out;
}

function fromFieldErrors(fe: Record<string, string[]> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(fe ?? {}).map(([k, v]) => [k, v[0] ?? ""]));
}

/** Largeur ≥ 1024 px (disposition 3 colonnes). */
function useIsLarge(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

const iconBtn =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-2 hover:text-ink active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35 lg:size-9";

export function ThemeEditor(p: Props) {
  const router = useRouter();
  const isLarge = useIsLarge();
  const [hist, setHist] = React.useState<History<ThemeDocument>>(() => createHistory(clean(p.initialDoc)));
  const doc = hist.present;
  const [template, setTemplate] = React.useState<TemplateId>("home");
  const [alternate, setAlternate] = React.useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const [audience, setAudience] = React.useState<SimulatedAudience | null>(null);
  const [previewOwner, setPreviewOwner] = React.useState<string | null>(null);
  const [saveSectionId, setSaveSectionId] = React.useState<string | null>(null);
  const [savedSections, setSavedSections] = React.useState<EditorSavedSection[]>(p.lot4.savedSections);
  const [alternateOwners, setAlternateOwners] = React.useState(p.lot4.alternateOwners);
  // Cible d'édition : modèle par défaut ou alternatif (`product:luxe`) ; vue = document où templates[type] est la cible.
  const target = normalizeTarget(doc, { template, alternate });
  const tkey = targetKey(target);
  const view = React.useMemo(() => projectTarget(doc, target), [doc, target.template, target.alternate]); // eslint-disable-line react-hooks/exhaustive-deps
  const [device, setDevice] = React.useState<Device>("desktop");
  const [selection, setSelection] = React.useState<Selection>(null);
  const [leftTab, setLeftTab] = React.useState<"sections" | "theme" | "quality">("sections");
  const [mobileTab, setMobileTab] = React.useState<"sections" | "settings" | "preview">("sections");
  const [addAt, setAddAt] = React.useState<{ index?: number } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [versions, setVersions] = React.useState(p.versions);
  const [live, setLive] = React.useState("");
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  // Lot 4 §8 : édition en place dans l'aperçu (désactivée par défaut) et confirmation de suppression.
  const [inlineMode, setInlineMode] = React.useState(false);
  const [removeId, setRemoveId] = React.useState<string | null>(null);

  // Sauvegarde automatique
  const docJson = React.useMemo(() => JSON.stringify(doc), [doc]);
  const [savedJson, setSavedJson] = React.useState(docJson);
  const [publishedJson, setPublishedJson] = React.useState(() => (p.publishedDoc ? JSON.stringify(clean(p.publishedDoc)) : null));
  const [storeOnline, setStoreOnline] = React.useState(p.storeOnline);
  const [saving, setSaving] = React.useState(false);
  const [saveFailure, setSaveFailure] = React.useState<"error" | "invalid" | null>(null);
  const latest = React.useRef({ doc, json: docJson });
  const savedRef = React.useRef(docJson);
  const inFlight = React.useRef(false);
  // Dernier document réellement tenté (validé ou envoyé) : sert à ne PAS reboucler sur un document identique
  // rejeté, tout en relançant dès qu'il change (retry sur changement, pas de spam sur un rejet stable).
  const attemptedRef = React.useRef(docJson);
  // Incrémenté à la fin de chaque tentative : relance l'effet d'autosauvegarde même après un rejet
  // (sinon un document modifié pendant une sauvegarde en vol, ou rejeté, resterait bloqué sans nouvel essai).
  const [saveTick, setSaveTick] = React.useState(0);
  React.useEffect(() => {
    latest.current = { doc, json: docJson };
  });

  const announce = React.useCallback((m: string) => setLive(m), []);

  const markSaved = (json: string) => {
    savedRef.current = json;
    setSavedJson(json);
  };

  const save = React.useCallback(
    async (manual = false): Promise<boolean> => {
      const { doc: d, json } = latest.current;
      // Une sauvegarde est en cours : l'effet d'autosauvegarde relancera la suivante quand elle aura abouti.
      if (inFlight.current) return true;
      if (json === savedRef.current) {
        if (manual) toast.success("Brouillon enregistré");
        return true;
      }
      attemptedRef.current = json;
      const local = validateThemeDocument(d);
      if (!local.ok) {
        setErrors(errorMap(local.errors));
        setSaveFailure("invalid");
        if (manual) toast.error("Certains réglages sont à corriger", local.errors[0]?.message);
        setSaveTick((t) => t + 1);
        return false;
      }
      inFlight.current = true;
      setSaving(true);
      const r = await saveThemeDraft(p.storeId, json).catch(() => ({ ok: false as const, error: "Connexion perdue. Nouvel essai à la prochaine modification.", fieldErrors: undefined }));
      inFlight.current = false;
      setSaving(false);
      if (r.ok) {
        markSaved(json);
        setErrors({});
        setSaveFailure(null);
        if (manual) toast.success("Brouillon enregistré");
      } else {
        setSaveFailure(r.fieldErrors ? "invalid" : "error");
        setErrors(fromFieldErrors(r.fieldErrors));
        if (manual || !r.fieldErrors) toast.error("Enregistrement impossible", r.error);
      }
      setSaveTick((t) => t + 1);
      return r.ok;
    },
    [p.storeId],
  );

  React.useEffect(() => {
    // Rien à sauver : document identique au dernier brouillon enregistré.
    if (docJson === savedJson) return;
    // Document déjà tenté et rejeté, inchangé depuis : on attend une modification (pas de boucle de retry).
    if (saveFailure && docJson === attemptedRef.current) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
    // `saveTick` relance l'évaluation après chaque tentative (reprise d'une modif perdue pendant une sauvegarde en vol).
  }, [docJson, savedJson, saveFailure, saveTick, save]);

  const dirty = docJson !== savedJson;
  const status: "saved" | "dirty" | "saving" | "error" | "invalid" = saving ? "saving" : saveFailure && dirty ? saveFailure : dirty ? "dirty" : "saved";
  const unpublished = publishedJson == null || publishedJson !== docJson;

  // Avertit avant de quitter la page avec des modifications non enregistrées.
  React.useEffect(() => {
    if (!dirty && !saving) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty, saving]);

  // Plein écran : la page sous l'éditeur ne défile pas.
  React.useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, []);

  /* ───────── Opérations ───────── */

  const commit = (next: ThemeDocument, coalesceKey?: string) => setHist((h) => pushHistory(h, next, { coalesceKey }));
  const run = <T,>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ThemeOpError) {
        toast.error(e.message);
        return undefined;
      }
      throw e;
    }
  };

  const select = React.useCallback(
    (s: Selection) => {
      setSelection(s);
      if (s?.kind === "global") setLeftTab(s.group === "header" || s.group === "footer" ? leftTabFor(s.group) : "theme");
      if (s && !isLarge) setMobileTab("settings");
    },
    [isLarge],
  );

  const undo = () => setHist((h) => undoH(h));
  const redo = () => setHist((h) => redoH(h));

  const tpl = view.templates[template];
  const treeActions: TreeActions & InspectorActions = {
    select,
    moveSection: (id, to) => run(() => commit(ops.moveSection(doc, tkey, id, to))),
    toggleSection: (id) =>
      run(() => {
        const s = tpl.sections[id];
        commit(ops.setSectionHidden(doc, tkey, id, !s.disabled));
        announce(`${sectionLabel(s).name} ${s.disabled ? "affichée" : "masquée"}.`);
      }),
    duplicateSection: (id) =>
      run(() => {
        const r = ops.duplicateSection(doc, tkey, id);
        commit(r.doc);
        select({ kind: "section", id: r.id });
        announce("Section dupliquée.");
      }),
    removeSection: (id) =>
      run(() => {
        const name = sectionLabel(tpl.sections[id]).name;
        commit(ops.removeSection(doc, tkey, id));
        if (selection && ((selection.kind === "section" && selection.id === id) || (selection.kind === "block" && selection.sectionId === id))) setSelection(null);
        toast.info(`« ${name} » supprimée`, undefined, { label: "Annuler", onClick: undo });
      }),
    addBlock: (sid, type) =>
      run(() => {
        const r = ops.addBlock(doc, tkey, sid, type);
        commit(r.doc);
        select({ kind: "block", sectionId: sid, blockId: r.id });
      }),
    moveBlock: (sid, bid, to) => run(() => commit(ops.moveBlock(doc, tkey, sid, bid, to))),
    toggleBlock: (sid, bid) =>
      run(() => {
        const b = tpl.sections[sid].blocks.find((x) => x.id === bid)!;
        commit(ops.setBlockHidden(doc, tkey, sid, bid, !b.disabled));
      }),
    duplicateBlock: (sid, bid) =>
      run(() => {
        const r = ops.duplicateBlock(doc, tkey, sid, bid);
        commit(r.doc);
        select({ kind: "block", sectionId: sid, blockId: r.id });
      }),
    removeBlock: (sid, bid) =>
      run(() => {
        commit(ops.removeBlock(doc, tkey, sid, bid));
        if (selection?.kind === "block" && selection.blockId === bid) setSelection({ kind: "section", id: sid });
        toast.info("Bloc supprimé", undefined, { label: "Annuler", onClick: undo });
      }),
    openAddSection: (index) => setAddAt({ index }),
    setSection: (sid, key, value) => run(() => commit(ops.updateSectionSetting(doc, tkey, sid, key, value), `s:${sid}:${key}`)),
    setBlock: (sid, bid, key, value) => run(() => commit(ops.updateBlockSetting(doc, tkey, sid, bid, key, value), `b:${bid}:${key}`)),
    setGlobal: (path, value, coalesce) => run(() => commit(ops.updateGlobalSetting(doc, path, value), coalesce ? `g:${path}` : undefined)),
    resetSection: (sid) => run(() => commit(ops.resetSectionSettings(doc, tkey, sid))),
    resetBlock: (sid, bid) => run(() => commit(ops.resetBlockSettings(doc, tkey, sid, bid))),
    applyPreset: (sid, index) => run(() => commit(ops.applySectionPreset(doc, tkey, sid, index))),
    // Lot 4
    setAnimation: (sid, a) => run(() => commit(ops.setSectionAnimation(doc, tkey, sid, a))),
    setVisibility: (sid, v) => run(() => commit(ops.setSectionVisibility(doc, tkey, sid, v), `v:${sid}`)),
    saveSection: (sid) => setSaveSectionId(sid),
    bindSource: (sid, bid, key, source) =>
      run(() => {
        const section = tpl.sections[sid];
        const schema = SECTION_SCHEMAS[section.type];
        const fields = bid ? (schema.blocks?.find((x) => x.type === section.blocks.find((b) => b.id === bid)?.type)?.settings ?? []) : schema.settings;
        const field = fields.find((f) => "id" in f && f.id === key);
        const check = field ? checkBinding(field.type, source, { definitions: p.lot4.metafields, template }) : { ok: false as const, reason: "Réglage inconnu." };
        if (!check.ok) {
          toast.error(check.reason);
          return;
        }
        commit(ops.bindDynamicSource(doc, tkey, sid, bid, key, source));
        announce("Donnée connectée.");
      }),
    unbindSource: (sid, bid, key) =>
      run(() => {
        commit(ops.unbindDynamicSource(doc, tkey, sid, bid, key));
        announce("Donnée déconnectée : la valeur par défaut est rétablie.");
      }),
  };

  const addSection = (type: SectionType) =>
    run(() => {
      const r = ops.addSection(doc, tkey, type, { index: addAt?.index });
      commit(r.doc);
      select({ kind: "section", id: r.id });
      announce("Section ajoutée.");
    });

  /* ───────── Lot 4 : sections enregistrées, bibliothèque ───────── */

  const knownRefs = React.useMemo(
    () => ({
      collectionIds: new Set(p.resources.collections.map((c) => c.id)),
      productIds: new Set(p.resources.products.map((x) => x.id)),
      menuHandles: new Set(p.resources.menus.map((m) => m.handle)),
    }),
    [p.resources],
  );

  /* ───────── Lot 4 : qualité (anti-rebond 500 ms) ───────── */

  const [qualityDoc, setQualityDoc] = React.useState(doc);
  React.useEffect(() => {
    const id = setTimeout(() => setQualityDoc(doc), QUALITY_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [doc]);
  const report = React.useMemo(() => scoreTheme(qualityDoc, p.lot4.qualityFacts), [qualityDoc, p.lot4.qualityFacts]);
  const qualityPending = qualityDoc !== doc;

  const fixIssue = (issue: Issue) => {
    const r = applyIssueFix(doc, issue, knownRefs);
    if (!r) return;
    if (!r.ok) {
      toast.error("Correction impossible", r.error);
      return;
    }
    commit(r.doc);
    setQualityDoc(r.doc);
    announce("Correction appliquée.");
    toast.success("Correction appliquée", issue.message, { label: "Annuler", onClick: undo });
  };

  const showIssue = (issue: Issue) => {
    const dest = issueDestination(issue);
    if (!dest) return;
    if (dest.template !== template || dest.alternate !== (target.alternate ?? null)) switchTarget(dest.template, dest.alternate);
    if (dest.selection) {
      setSelection(dest.selection);
      if (!isLarge) setMobileTab("settings");
    } else if (!isLarge) setMobileTab("preview");
  };

  const insertPayload = (payload: unknown, label: string): boolean =>
    run(() => {
      const r = ops.insertSavedSection(doc, tkey, payload, { index: addAt?.index, refs: knownRefs });
      commit(r.doc);
      select({ kind: "section", id: r.id });
      announce(`« ${label} » ajoutée.`);
      return true;
    }) ?? false;

  const insertSaved = async (item: EditorSavedSection): Promise<boolean> => {
    const r = await fetchSavedPayload(p.storeId, item.id);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    const ok = insertPayload(r.payload, item.name);
    if (ok && r.removedRefs) toast.info(`${r.removedRefs} référence${r.removedRefs > 1 ? "s" : ""} introuvable${r.removedRefs > 1 ? "s" : ""} retirée${r.removedRefs > 1 ? "s" : ""}`, "Choisissez de nouveau les produits ou collections dans les réglages.");
    return ok;
  };

  const insertLibrary = async (item: EditorLibraryItem): Promise<boolean> => {
    if (item.locked) {
      toast.error(item.lockReason ?? `« ${item.name} » est incluse à partir du plan ${item.requiredPlanName}.`, undefined, { label: "Voir les plans", onClick: () => router.push(`/app/${p.storeId}/abonnement`) });
      return false;
    }
    const r = await fetchLibraryPayload(p.storeId, item.id);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    return insertPayload(r.payload, item.name);
  };

  const deleteSaved = async (item: EditorSavedSection) => {
    const r = await deleteSavedSectionItem(p.storeId, item.id);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setSavedSections((list) => list.filter((x) => x.id !== item.id));
    toast.success(`« ${item.name} » retirée de vos sections`);
  };

  const storeSection = async (name: string): Promise<string | null> => {
    const section = saveSectionId ? tpl.sections[saveSectionId] : undefined;
    if (!section) return "Section introuvable.";
    const r = await saveSectionToLibrary(p.storeId, name, section);
    if (!r.ok) return r.error;
    setSavedSections((list) => [r.item, ...list.filter((x) => x.id !== r.item.id)]);
    toast.success(r.message ?? `« ${name} » enregistrée`, "Retrouvez-la dans « Ajouter une section », onglet « Mes sections ».");
    return null;
  };

  const savedLimit = p.lot4.rules.savedSections;
  const sectionToSave = saveSectionId ? tpl.sections[saveSectionId] : undefined;

  /* ───────── Lot 4 §8 : édition directe dans l'aperçu ───────── */

  // Plan : l'édition en place est incluse partout, l'assistant de design à partir de Business (revérifié côté serveur).
  const planFeatures = PLANS[p.lot4.planId as PlanId]?.features;
  const canInline = planFeatures?.inlineEditing ?? false;
  const canAssistant = planFeatures?.designAssistant ?? false;

  const inlinePost = React.useRef<((message: unknown) => void) | null>(null);
  const runSectionAction = (id: string, action: SectionActionId) => {
    const section = tpl.sections[id];
    if (!section) return;
    select({ kind: "section", id });
    const index = tpl.order.indexOf(id);
    if (action === "move-up") treeActions.moveSection(id, Math.max(0, index - 1));
    else if (action === "move-down") treeActions.moveSection(id, Math.min(tpl.order.length - 1, index + 1));
    else if (action === "duplicate") treeActions.duplicateSection(id);
    else if (action === "hide") treeActions.toggleSection(id);
    else if (action === "insert-after") setAddAt({ index: index + 1 });
    else if (action === "remove") setRemoveId(id);
  };

  const handleInline = useInlineBridge({
    storeId: p.storeId,
    doc: view,
    template,
    post: (m) => inlinePost.current?.(m),
    setSection: (sid, key, value, coalesce) => run(() => commit(ops.updateSectionSetting(doc, tkey, sid, key, value), coalesce)),
    setBlock: (sid, bid, key, value, coalesce) => run(() => commit(ops.updateBlockSetting(doc, tkey, sid, bid, key, value), coalesce)),
    setImage: (target, value) =>
      run(() => {
        const next = target.blockId
          ? ops.updateBlockSetting(doc, tkey, target.sectionId, target.blockId, target.settingId, value)
          : ops.updateSectionSetting(doc, tkey, target.sectionId, target.settingId, value);
        commit(next);
      }),
    sectionAction: runSectionAction,
    select: (id) => {
      if (selectedSectionId !== id) select({ kind: "section", id });
    },
    notify: (kind, message, detail) => (kind === "error" ? toast.error(message, detail) : toast.info(message, detail)),
  });

  /* ───────── Lot 4 §10 : assistant de design ───────── */

  const applyAssistant = (operations: unknown[], explanation: string): boolean => {
    const r = ops.applyOperations(doc, operations, { maxOps: MAX_ASSISTANT_OPERATIONS, allow: ASSISTANT_OPERATIONS, refs: knownRefs });
    if (!r.ok) {
      toast.error("Modification impossible", r.error);
      return false;
    }
    // Une seule entrée d'historique : « Annuler » rétablit l'état d'avant l'instruction.
    commit(r.doc);
    announce("Modification de l'assistant appliquée.");
    toast.success("Assistant de design", explanation, { label: "Annuler", onClick: undo });
    return true;
  };

  /* ───────── Lot 4 : modèles alternatifs ───────── */

  const switchTarget = (t: TemplateId, alt: string | null) => {
    setTemplate(t);
    setAlternate(alt);
    setSelection(null);
    setPreviewOwner(null);
  };

  const createAlternate = (suffix: string, from: string | null): boolean => {
    if (!isAlternateType(template)) return false;
    const type = template;
    const ok = run(() => {
      const r = ops.duplicateAlternate(doc, type, from, suffix, { perTypeLimit: p.lot4.rules.alternatesPerType });
      commit(r.doc);
      return true;
    });
    if (ok) {
      switchTarget(type, suffix);
      toast.success(`Modèle « ${ALTERNATE_TYPE_LABELS[type]} · ${suffix} » créé`, "Choisissez-le dans la fiche des éléments qui doivent l'utiliser.");
    }
    return !!ok;
  };

  /** Renommer / supprimer passent par le serveur (fiches liées mises à jour) ; l'historique repart du document renvoyé. */
  const afterAlternateAction = (next: ThemeDocument) => {
    const c = clean(next);
    setHist(createHistory(c));
    markSaved(JSON.stringify(c));
    setErrors({});
    setSaveFailure(null);
    setSelection(null);
  };

  const renameAlternate = async (from: string, to: string): Promise<string | null> => {
    if (!isAlternateType(template)) return "Modèle introuvable.";
    const type = template;
    if (dirty && !(await save())) return "Enregistrez d'abord les modifications en cours.";
    const r = await renameAlternateTemplate(p.storeId, type, from, to).catch(() => ({ ok: false as const, error: "Connexion perdue. Réessayez.", fieldErrors: undefined }));
    if (!r.ok) return r.fieldErrors?.name?.[0] ?? r.error;
    afterAlternateAction(r.data!.doc);
    if (alternate === from) setAlternate(to);
    setAlternateOwners((list) => list.map((o) => (o.type === type && o.suffix === from ? { ...o, suffix: to } : o)));
    toast.success(r.message ?? "Modèle renommé");
    return null;
  };

  const deleteAlternate = async (suffix: string): Promise<boolean> => {
    if (!isAlternateType(template)) return false;
    const type = template;
    if (dirty && !(await save())) {
      toast.error("Enregistrez d'abord les modifications en cours.");
      return false;
    }
    const r = await deleteAlternateTemplate(p.storeId, type, suffix).catch(() => ({ ok: false as const, error: "Connexion perdue. Réessayez." }));
    if (!r.ok) {
      toast.error("Suppression impossible", r.error);
      return false;
    }
    afterAlternateAction(r.data!.doc);
    if (alternate === suffix) switchTarget(type, null);
    setAlternateOwners((list) => list.filter((o) => !(o.type === type && o.suffix === suffix)));
    toast.success(r.message ?? "Modèle supprimé");
    return true;
  };


  /* ───────── Serveur ───────── */

  const replaceFromServer = (next: ThemeDocument) => {
    const c = clean(next);
    setHist((h) => pushHistory(h, c));
    markSaved(JSON.stringify(c));
    setErrors({});
    setSaveFailure(null);
    setSelection(null);
  };

  const publish = async () => {
    const local = validateThemeDocument(doc);
    if (!local.ok) {
      setErrors(errorMap(local.errors));
      toast.error("Corrigez les réglages signalés avant de publier", local.errors[0]?.message);
      return;
    }
    setPublishing(true);
    const json = docJson;
    try {
      const r = await publishTheme(p.storeId, json);
      if (r.ok) {
        markSaved(json);
        setPublishedJson(json);
        setSaveFailure(null);
        setErrors({});
        if (r.data?.versions) setVersions(r.data.versions);
        const outcome = r.data?.store;
        const subtitle = outcome
          ? outcome.justPublished
            ? "Votre boutique est désormais visible de vos clients."
            : outcome.online
              ? "Vos clients voient maintenant la nouvelle version."
              : outcome.suspended
                ? "Thème enregistré. La boutique reste hors ligne (suspendue)."
                : "Le thème est publié, mais la boutique n'est pas encore en ligne."
          : "Vos clients voient maintenant la nouvelle version.";
        if (outcome && !outcome.online && !outcome.suspended) toast.info(r.message ?? "Thème publié", subtitle);
        else toast.success(r.message ?? "Thème publié", subtitle);
        if (outcome) setStoreOnline(outcome.online);
      } else {
        setErrors(fromFieldErrors(r.fieldErrors));
        toast.error("Publication impossible", r.error);
      }
    } catch {
      toast.error("Publication impossible", "Vérifiez votre connexion et réessayez.");
    } finally {
      setPublishing(false);
    }
  };

  const restore = async (id: string) => {
    if (dirty) await save();
    const r = await restoreThemeVersion(p.storeId, id);
    if (r.ok && r.data) {
      replaceFromServer(r.data.doc);
      toast.success("Version restaurée", r.message);
    } else if (!r.ok) toast.error(r.error);
  };

  const discard = async () => {
    const r = await discardThemeDraft(p.storeId);
    if (r.ok && r.data) {
      replaceFromServer(r.data.doc);
      toast.success(r.message ?? "Modifications abandonnées");
    } else if (!r.ok) toast.error(r.error);
  };

  const applyPreset = async (presetId: string, keep: boolean) => {
    if (dirty) await save();
    const r = await changeThemePreset(p.storeId, presetId, keep);
    if (r.ok && r.data) {
      replaceFromServer(r.data.doc);
      setTemplate("home");
      toast.success("Modèle appliqué", r.message);
    } else if (!r.ok) toast.error(r.error);
  };

  const exit = async () => {
    if (dirty) await save();
    router.push(`/app/${p.storeId}`);
  };

  /* ───────── Raccourcis ───────── */

  const shortcuts = React.useRef({ undo, redo, save });
  React.useEffect(() => {
    shortcuts.current = { undo, redo, save };
  });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (document.querySelector("dialog[open]")) return;
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        shortcuts.current.undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        shortcuts.current.redo();
      } else if (k === "s") {
        e.preventDefault();
        void shortcuts.current.save(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ───────── Rendu ───────── */

  const t = tpl;
  const selectedSectionId = selection?.kind === "section" ? selection.id : selection?.kind === "block" ? selection.sectionId : null;
  // Sélection devenue invalide (annuler, autre modèle de page) : on l'ignore.
  const effectiveSelection: Selection =
    selection && selection.kind !== "global" && !t.sections[selectedSectionId!]
      ? null
      : selection?.kind === "block" && !t.sections[selection.sectionId]?.blocks.some((b) => b.id === selection.blockId)
        ? null
        : selection;
  const currentPreset = p.presets.find((x) => x.id === doc.preset);
  const effectiveDevice: Device = isLarge ? device : "mobile";

  // Aperçu : vue de la cible, animations réduites et audience simulée (jamais enregistré).
  const audienceDevice: "mobile" | "desktop" = effectiveDevice === "desktop" ? "desktop" : "mobile";
  const previewAudience = React.useMemo(() => (audience ? { ...audience, device: audienceDevice } : null), [audience, audienceDevice]);
  const previewDoc = React.useMemo(() => previewDocument(view, { reduceMotion, audience: previewAudience }), [view, reduceMotion, previewAudience]);
  const { ruleCities, hasAudienceRules } = React.useMemo(() => {
    const cities = new Set<string>();
    let any = false;
    for (const tt of [...Object.values(doc.templates), ...Object.values(doc.alternates ?? {}).flatMap((m) => Object.values(m ?? {}))]) {
      for (const sec of Object.values(tt.sections)) {
        for (const r of sec.visibility?.rules ?? []) {
          any = true;
          if (r.type === "city") r.values.forEach((c) => cities.add(c));
        }
      }
    }
    if (p.lot4.storeCity) cities.add(p.lot4.storeCity);
    return { ruleCities: [...cities].slice(0, 30), hasAudienceRules: any };
  }, [doc, p.lot4.storeCity]);
  const ownersOfTarget = target.alternate ? alternateOwners.filter((o) => o.type === target.template && o.suffix === target.alternate) : [];

  const extraGlobal = (group: string) => {
    if (group === "preset")
      return (
        <div>
          <PanelTitle title="Modèle de départ" onBack={() => select(null)} />
          <PresetPanel presets={p.presets} current={doc.preset} presetLimit={p.presetLimit} storeId={p.storeId} onApply={applyPreset} />
        </div>
      );
    if (group === "motion")
      return (
        <div>
          <PanelTitle title="Animations" onBack={() => select(null)} />
          <MotionPanel motion={doc.settings.motion} enabled={p.lot4.rules.motionPresets} storeId={p.storeId} onChange={(m) => treeActions.setGlobal("motion", m)} />
        </div>
      );
    if (group === "branding")
      return (
        <div>
          <PanelTitle title="Mention « Propulsé par Axi »" onBack={() => select(null)} />
          <BrandingPanel storeId={p.storeId} showPoweredBy={p.showPoweredBy} canRemove={p.canRemoveBranding} />
        </div>
      );
    return null;
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-canvas text-ink" data-theme-editor>
      <div aria-live="polite" className="sr-only">
        {live}
      </div>

      {/* Barre du haut */}
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex h-14 items-center gap-1.5 px-2 lg:gap-2 lg:px-3">
          <button type="button" onClick={exit} className={cn(iconBtn, "lg:w-auto lg:gap-1.5 lg:px-3 lg:text-[13px] lg:font-medium lg:text-ink")} aria-label="Quitter l'éditeur">
            <X className="size-4" aria-hidden />
            <span className="hidden lg:inline">Quitter</span>
          </button>
          <div className="hidden min-w-0 items-center gap-2 border-l border-line pl-3 lg:flex">
            <span className="max-w-[160px] truncate text-sm font-semibold">{p.storeName}</span>
            <SaveStatus status={status} onRetry={() => void save(true)} />
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            <label className="sr-only" htmlFor="template-select">
              Modèle de page
            </label>
            <select
              id="template-select"
              value={target.alternate ? `${target.template}:${target.alternate}` : target.template}
              onChange={(e) => {
                const next = parseTargetValue(e.target.value);
                switchTarget(next.template, next.alternate);
              }}
              className="h-11 w-full min-w-0 max-w-[220px] cursor-pointer rounded-full bg-surface-2 px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line hover:bg-line focus-visible:outline-2 focus-visible:outline-primary lg:h-9"
            >
              {EDITABLE_TEMPLATES.map((x) => {
                const alts = alternateSuffixes(doc, x.id);
                if (!alts.length) {
                  return (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  );
                }
                return (
                  <optgroup key={x.id} label={x.label}>
                    <option value={x.id}>{x.label} (par défaut)</option>
                    {alts.map((a) => (
                      <option key={a} value={`${x.id}:${a}`}>
                        {x.label} · {a}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {isAlternateType(template) && (
              <AlternateManager
                doc={doc}
                type={template}
                current={target.alternate}
                owners={alternateOwners}
                limit={{ perType: p.lot4.rules.alternatesPerType }}
                storeId={p.storeId}
                onSelect={(alt) => switchTarget(template, alt)}
                onCreate={createAlternate}
                onRename={renameAlternate}
                onDelete={deleteAlternate}
                triggerClassName={cn(iconBtn, "gap-1 lg:w-auto lg:px-2.5")}
              />
            )}
            <div className="hidden lg:block">
              <Segmented
                size="sm"
                label="Taille de l'aperçu"
                value={device}
                onChange={setDevice}
                options={[
                  { value: "desktop", label: <><Monitor className="size-4" aria-hidden /><span className="sr-only">Ordinateur</span></> },
                  { value: "tablet", label: <><Tablet className="size-4" aria-hidden /><span className="sr-only">Tablette</span></> },
                  { value: "mobile", label: <><Smartphone className="size-4" aria-hidden /><span className="sr-only">Mobile</span></> },
                ]}
              />
            </div>
          </div>

          <div className="hidden items-center lg:flex">
            <button type="button" className={iconBtn} onClick={undo} disabled={!hist.past.length} aria-label="Annuler (Ctrl+Z)" title="Annuler (Ctrl+Z)">
              <Undo2 className="size-4" aria-hidden />
            </button>
            <button type="button" className={iconBtn} onClick={redo} disabled={!hist.future.length} aria-label="Rétablir (Ctrl+Y)" title="Rétablir (Ctrl+Y)">
              <Redo2 className="size-4" aria-hidden />
            </button>
          </div>

          <DropdownMenu
            label="Versions"
            className="w-[300px] max-w-[calc(100vw-1rem)]"
            trigger={(tp) => (
              <button {...tp} className={cn(iconBtn, "lg:w-auto lg:gap-1.5 lg:px-3 lg:text-[13px] lg:font-medium lg:text-ink")} aria-label="Versions">
                <HistoryIcon className="size-4" aria-hidden />
                <span className="hidden lg:inline">Versions</span>
              </button>
            )}
          >
            <DropdownLabel>Versions publiées</DropdownLabel>
            {!p.versionHistory ? (
              <DropdownItem icon={Lock} href={`/app/${p.storeId}/abonnement`} hint="Plan Business">
                Historique et restauration
              </DropdownItem>
            ) : versions.length ? (
              versions.slice(0, 12).map((v, i) => (
                <DropdownItem key={v.id} icon={HistoryIcon} onSelect={() => void restore(v.id)} hint={i === 0 ? "En ligne" : (v.actorName ?? undefined)}>
                  {v.label ?? formatDateTime(v.publishedAt)}
                </DropdownItem>
              ))
            ) : (
              <p className="px-3 py-2 text-[13px] text-ink-muted">Aucune version publiée pour le moment.</p>
            )}
            <DropdownSeparator />
            <DropdownItem icon={ExternalLink} href={`/s/${p.slug}`} external>
              Voir la boutique en ligne
            </DropdownItem>
            <DropdownItem icon={Trash2} tone="danger" disabled={!unpublished || !publishedJson} onSelect={() => setDiscardOpen(true)}>
              Abandonner les modifications
            </DropdownItem>
          </DropdownMenu>

          <span
            className={cn(
              "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex",
              storeOnline ? "bg-primary-soft text-primary-deep" : "bg-surface-2 text-ink-muted",
            )}
            title={storeOnline ? "Votre boutique est visible de vos clients." : "Votre boutique n'est pas encore en ligne : publiez pour la mettre en ligne."}
          >
            <span className={cn("size-1.5 rounded-full", storeOnline ? "bg-primary" : "bg-ink-faint")} aria-hidden />
            {storeOnline ? "En ligne" : "Hors ligne"}
          </span>

          <button
            type="button"
            onClick={publish}
            disabled={publishing}
            aria-busy={publishing || undefined}
            className="relative inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-on-primary transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-70 lg:h-9"
          >
            <span className="grid size-4 place-items-center" aria-hidden>
              {publishing ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            </span>
            Publier
            {unpublished && !publishing && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-primary" aria-hidden />}
            <span className="sr-only">{unpublished ? " (modifications non publiées)" : " (à jour)"}</span>
          </button>
        </div>

        {/* Onglets mobiles */}
        <div className="flex items-center gap-1 border-t border-line px-2 py-1.5 lg:hidden">
          <Segmented
            fill
            size="sm"
            className="flex-1"
            label="Vue de l'éditeur"
            value={mobileTab}
            onChange={setMobileTab}
            options={[
              { value: "sections", label: "Sections" },
              { value: "settings", label: "Réglages" },
              { value: "preview", label: "Aperçu" },
            ]}
          />
          <SaveStatus status={status} compact onRetry={() => void save(true)} />
          <button type="button" className={iconBtn} onClick={undo} disabled={!hist.past.length} aria-label="Annuler">
            <Undo2 className="size-4" aria-hidden />
          </button>
          <button type="button" className={iconBtn} onClick={redo} disabled={!hist.future.length} aria-label="Rétablir">
            <Redo2 className="size-4" aria-hidden />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 lg:grid lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        {/* Colonne gauche */}
        <aside className={cn("min-h-0 w-full flex-col border-line bg-surface lg:flex lg:border-r", mobileTab === "sections" ? "flex" : "hidden")} aria-label="Structure">
          <div className="shrink-0 border-b border-line p-2">
            <Segmented
              fill
              size="sm"
              label="Panneau"
              value={leftTab}
              onChange={setLeftTab}
              options={[
                { value: "sections", label: "Sections" },
                { value: "theme", label: "Thème" },
                {
                  value: "quality",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      Qualité
                      {p.lot4.rules.qualityScores && (
                        <span className="tabular rounded-full bg-surface px-1.5 text-[11px] font-semibold text-ink ring-1 ring-line">
                          <span className="sr-only">score global </span>
                          {overallScore(report.scores)}
                        </span>
                      )}
                    </span>
                  ),
                },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {p.recovered && (
              <div className="p-2">
                <Alert tone="warning">Le brouillon précédent était incompatible : l&apos;éditeur est reparti de la dernière version valide.</Alert>
              </div>
            )}
            {leftTab === "quality" ? (
              <QualityPanel report={report} pending={qualityPending} enabled={p.lot4.rules.qualityScores} storeId={p.storeId} onFix={fixIssue} onShow={showIssue} />
            ) : leftTab === "sections" ? (
              <SectionTree doc={view} template={template} selection={effectiveSelection} errors={errors} actions={treeActions} announce={announce} />
            ) : (
              <ThemeSettingsList
                selection={effectiveSelection}
                onSelect={select}
                presetName={currentPreset?.name ?? doc.preset}
                motionDetail={MOTION_PRESET_LABELS[motionOf(doc.settings.motion).preset]}
              />
            )}
          </div>
          {/* Lot 4 §10 : assistant de design (brouillon, annulable en une entrée d'historique). */}
          <DesignAssistantPanel
            storeId={p.storeId}
            template={template}
            selection={selectedSectionId}
            docJson={docJson}
            enabled={canAssistant}
            onApply={applyAssistant}
          />
        </aside>

        {/* Aperçu */}
        <main className={cn("min-h-0 min-w-0 flex-1 lg:block", mobileTab === "preview" ? "block" : "hidden")} aria-label="Aperçu">
          <Preview
            slug={p.slug}
            template={template}
            device={effectiveDevice}
            doc={previewDoc}
            path={target.alternate ? previewOwner : null}
            audience={previewAudience}
            inlineMode={inlineMode}
            onInlineMessage={handleInline}
            postRef={inlinePost}
            toolbar={
              <>
                <InlineEditToggle checked={inlineMode} onChange={setInlineMode} enabled={canInline} />
                <AudienceSimulator value={previewAudience} onChange={setAudience} device={audienceDevice} cities={ruleCities} hasRules={hasAudienceRules} />
                <ReduceMotionToggle checked={reduceMotion} onChange={setReduceMotion} />
                {target.alternate && isAlternateType(template) && ownersOfTarget.length > 0 && (
                  <PreviewOwnerSelect owners={ownersOfTarget} value={previewOwner} onChange={setPreviewOwner} noun={ALTERNATE_TYPE_LABELS[template].toLowerCase()} />
                )}
              </>
            }
            selectedSectionId={selectedSectionId}
            onSectionClick={(click) => {
              if (click.kind === "group") {
                select({ kind: "global", group: click.group });
                return;
              }
              // L'aperçu peut afficher un autre modèle que celui de l'éditeur (rechargement en cours) : on bascule.
              const other = click.template && click.template !== template && EDITABLE_TEMPLATES.some((x) => x.id === click.template) ? click.template : null;
              const clicked = other && doc.templates[other]?.sections[click.id] ? other : template;
              if (!view.templates[clicked]?.sections[click.id]) return;
              if (clicked !== template) switchTarget(clicked, null);
              setLeftTab("sections");
              select({ kind: "section", id: click.id });
            }}
          />
        </main>

        {/* Colonne droite */}
        <aside className={cn("min-h-0 w-full overflow-y-auto overscroll-contain border-line bg-surface lg:block lg:border-l", mobileTab === "settings" ? "block" : "hidden")} aria-label="Réglages">
          <Inspector
            doc={view}
            template={template}
            selection={effectiveSelection}
            errors={errors}
            resources={p.resources}
            actions={treeActions}
            extraGlobal={extraGlobal}
            lot4={{
              storeId: p.storeId,
              storeCity: p.lot4.storeCity,
              motionEnabled: p.lot4.rules.motionPresets,
              motionOn: motionOf(doc.settings.motion).preset !== "none" && motionOf(doc.settings.motion).reveal,
              audienceRules: p.lot4.rules.audienceRules,
              canSaveSections: savedLimit !== 0,
              dynamic: { template, metafields: p.lot4.metafields, samples: p.lot4.samples, sampleProductName: p.lot4.sampleProductName },
            }}
          />
        </aside>
      </div>

      <AddSectionDialog
        open={!!addAt}
        onClose={() => setAddAt(null)}
        doc={view}
        template={template}
        onAdd={addSection}
        saved={{
          items: savedSections,
          library: p.lot4.library,
          storeId: p.storeId,
          savedLimit,
          onInsertSaved: insertSaved,
          onDeleteSaved: deleteSaved,
          onInsertLibrary: insertLibrary,
        }}
      />
      <SaveSectionDialog
        open={!!sectionToSave}
        onClose={() => setSaveSectionId(null)}
        defaultName={sectionToSave ? sectionLabel(sectionToSave).detail || sectionLabel(sectionToSave).name : ""}
        sectionName={sectionToSave ? sectionLabel(sectionToSave).name : ""}
        limitReached={
          savedLimit === 0
            ? "Les sections enregistrées sont incluses à partir du plan Starter."
            : savedLimit != null && savedSections.length >= savedLimit
              ? `Votre plan inclut ${savedLimit} sections enregistrées. Supprimez-en une ou passez au plan Business.`
              : null
        }
        storeId={p.storeId}
        onSave={storeSection}
      />
      {/* Lot 4 §8 : « Supprimer » depuis la barre d'actions de l'aperçu est confirmé côté éditeur. */}
      <Dialog
        open={!!removeId}
        onClose={() => setRemoveId(null)}
        title="Supprimer cette section ?"
        description={removeId && tpl.sections[removeId] ? `« ${sectionLabel(tpl.sections[removeId]).name} » sera retirée de la page. Vous pourrez annuler.` : undefined}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setRemoveId(null)} className="h-10 rounded-full px-4 text-sm font-medium text-ink hover:bg-surface-2">
              Garder la section
            </button>
            <button
              type="button"
              onClick={() => {
                const id = removeId;
                setRemoveId(null);
                if (id) treeActions.removeSection(id);
              }}
              className="h-10 rounded-full bg-danger px-4 text-sm font-medium text-white hover:opacity-90"
            >
              Supprimer
            </button>
          </>
        }
      >
        <span className="sr-only">Confirmation</span>
      </Dialog>
      <Dialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Abandonner les modifications ?"
        description="Le brouillon revient à la version actuellement en ligne. Les modifications non publiées seront perdues."
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setDiscardOpen(false)} className="h-10 rounded-full px-4 text-sm font-medium text-ink hover:bg-surface-2">
              Garder mes modifications
            </button>
            <button
              type="button"
              onClick={async () => {
                setDiscardOpen(false);
                await discard();
              }}
              className="h-10 rounded-full bg-danger px-4 text-sm font-medium text-white hover:opacity-90"
            >
              Abandonner
            </button>
          </>
        }
      >
        <span className="sr-only">Confirmation</span>
      </Dialog>
    </div>
  );
}

function leftTabFor(group: string): "sections" | "theme" | "quality" {
  return group === "header" || group === "footer" ? "sections" : "theme";
}

function PanelTitle({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="sticky top-0 z-[1] flex items-center gap-1 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur">
      <button type="button" onClick={onBack} className={iconBtn} aria-label="Fermer">
        <X className="size-4" aria-hidden />
      </button>
      <div className="min-w-0">
        <p className="truncate text-[12px] text-ink-muted">Réglages du thème</p>
        <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
      </div>
    </div>
  );
}

const STATUS = {
  saved: { icon: Check, label: "Enregistré", tone: "text-ink-muted" },
  dirty: { icon: Loader2, label: "Modifications…", tone: "text-ink-muted" },
  saving: { icon: Loader2, label: "Enregistrement…", tone: "text-ink-muted" },
  error: { icon: CloudOff, label: "Non enregistré", tone: "text-danger" },
  invalid: { icon: AlertCircle, label: "À corriger", tone: "text-warning" },
} as const;

/** État d'enregistrement à largeur fixe (aucun décalage des boutons voisins). */
function SaveStatus({ status, compact = false, onRetry }: { status: keyof typeof STATUS; compact?: boolean; onRetry: () => void }) {
  const s = STATUS[status];
  const Icon = s.icon;
  const spinning = status === "saving";
  const content = (
    <>
      <Icon className={cn("size-3.5 shrink-0", spinning && "animate-spin", status === "dirty" && "opacity-0")} aria-hidden />
      <span className={cn(compact ? "sr-only" : "truncate")}>{s.label}</span>
    </>
  );
  const cls = cn("inline-flex shrink-0 items-center gap-1.5 text-[12.5px]", compact ? "size-11 justify-center" : "w-[132px]", s.tone);
  return (
    <span role="status" className="contents">
      {status === "error" ? (
        <button type="button" onClick={onRetry} className={cn(cls, "rounded-full hover:underline")} title="Réessayer l'enregistrement">
          {content}
        </button>
      ) : (
        <span className={cls}>{content}</span>
      )}
    </span>
  );
}

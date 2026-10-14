"use client";

import * as React from "react";
import type { TemplateId, ThemeDocument } from "@/lib/theme-engine/types";
import {
  inlineRejectMessage,
  parseImageDrop,
  parseInlineChange,
  parseSectionAction,
  type InlineTarget,
  type SectionActionId,
} from "@/lib/theme-engine/preview-messages";
import { compressThemeImage, uploadImage, UploadFailedError } from "@/lib/storage/client";
import { sectionLabel } from "./section-tree";
import { checkInlineValue } from "./inline-check";

/**
 * Lot 4 §8 : côté ÉDITEUR de l'édition directe. L'aperçu propose, l'éditeur décide :
 * chaque `axi:inline-change` est revalidé contre le schéma du champ (type, longueur, source dynamique)
 * avant d'être appliqué au document ; un refus renvoie `axi:inline-reject` et l'aperçu restaure la valeur.
 */

export { checkInlineValue, type InlineCheck } from "./inline-check";

export type InlineBridgeActions = {
  storeId: string;
  doc: ThemeDocument;
  template: TemplateId;
  /** Poste un message vers l'aperçu (fourni par `Preview`). */
  post: (message: unknown) => void;
  setSection: (sectionId: string, key: string, value: string, coalesceKey: string) => void;
  setBlock: (sectionId: string, blockId: string, key: string, value: string, coalesceKey: string) => void;
  setImage: (target: InlineTarget, value: { url: string; alt: string }) => void;
  sectionAction: (sectionId: string, action: SectionActionId) => void;
  select: (sectionId: string) => void;
  notify: (kind: "error" | "info", message: string, detail?: string) => void;
};

/**
 * Gestionnaire des messages d'édition directe reçus de l'aperçu. Renvoie une fonction à appeler
 * avec `event.data` (l'origine et la source sont déjà vérifiées par `Preview`).
 */
export function useInlineBridge(a: InlineBridgeActions): (data: unknown) => void {
  const ref = React.useRef(a);
  React.useEffect(() => {
    ref.current = a;
  });

  return React.useCallback(async (data: unknown) => {
    const api = ref.current;

    const change = parseInlineChange(data);
    if (change) {
      const check = checkInlineValue(api.doc, change.template ?? api.template, change.target, change.value);
      if (!check.ok) {
        api.post(inlineRejectMessage(change.target, check.message));
        return;
      }
      const coalesce = `inline:${change.target.sectionId}:${change.target.blockId ?? "-"}:${change.target.settingId}`;
      api.select(change.target.sectionId);
      if (change.target.blockId) api.setBlock(change.target.sectionId, change.target.blockId, change.target.settingId, check.value, coalesce);
      else api.setSection(change.target.sectionId, change.target.settingId, check.value, coalesce);
      return;
    }

    const drop = parseImageDrop(data);
    if (drop) {
      const section = api.doc.templates[api.template]?.sections[drop.target.sectionId];
      if (!section) {
        api.post(inlineRejectMessage(drop.target, "Cette section n'existe plus."));
        return;
      }
      api.notify("info", "Envoi de l'image…");
      try {
        // Compression dans le navigateur (comme le champ image de l'inspecteur) avant l'envoi au stockage.
        const { url } = await uploadImage(api.storeId, "theme", await compressThemeImage(drop.file));
        const label = sectionLabel(section);
        api.setImage(drop.target, { url, alt: label.detail || label.name });
        api.notify("info", "Image remplacée");
      } catch (e) {
        api.post(inlineRejectMessage(drop.target, e instanceof UploadFailedError ? e.message : "Envoi de l'image impossible."));
      }
      return;
    }

    const action = parseSectionAction(data);
    if (action) api.sectionAction(action.id, action.action);
  }, []);
}

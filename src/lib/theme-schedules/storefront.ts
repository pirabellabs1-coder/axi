import "server-only";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { parsePreviewAt, scheduledThemeAt } from "./service";

/**
 * Lot 4 §11 : branchement des thèmes programmés sur le rendu de la boutique (un seul appel par page).
 *
 *  - visiteur : la programmation active à l'instant de la requête remplace le document (`startsAt ≤ now < endsAt`) ;
 *  - membre en aperçu (`?preview=1&at=…`) : la programmation active À CETTE DATE, ce qui permet de voir le thème de
 *    fête avant l'heure et de vérifier le retour au thème normal.
 *
 * Aucune écriture, aucun cron : le retour au thème normal est exact à la seconde.
 */
export type ScheduleInfo = { id: string; name: string; occasion: string | null; endsAt: Date; at: Date; previewed: boolean };

export async function applyScheduledTheme(
  store: { id: string },
  doc: ThemeDocument,
  opts: { now: Date; preview: boolean; at?: string | string[] | undefined },
): Promise<{ doc: ThemeDocument; schedule: ScheduleInfo | null }> {
  const previewAt = opts.preview ? parsePreviewAt(opts.at) : null;
  // En aperçu SANS `at`, le brouillon du marchand reste prioritaire : on ne superpose aucune programmation.
  if (opts.preview && !previewAt) return { doc, schedule: null };
  const at = previewAt ?? opts.now;
  const active = await scheduledThemeAt(store.id, at);
  if (!active) return { doc, schedule: null };
  return {
    doc: active.doc,
    schedule: { id: active.id, name: active.name, occasion: active.occasion, endsAt: active.endsAt, at, previewed: !!previewAt },
  };
}

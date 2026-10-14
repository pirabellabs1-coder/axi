/**
 * Pont entre l'éditeur et les actions serveur de l'équipe Données (sections enregistrées, bibliothèque),
 * contrat : docs/vague2/D-donnees.md. L'éditeur insère ensuite la charge avec `insertSavedSection` (operations.ts),
 * qui la revalide et génère de nouveaux identifiants.
 */
import { deleteSavedSection, getSavedSectionForInsert, saveSection } from "@/lib/saved-sections/actions";
import { getLibraryItemForInsert } from "@/lib/section-library/actions";
import { SECTION_SCHEMAS } from "@/lib/theme-engine/schemas";
import type { SectionInstance } from "@/lib/theme-engine/types";
import type { EditorSavedSection } from "./types";

type Fail = { ok: false; error: string; field?: string };
const LOST: Fail = { ok: false, error: "Connexion perdue. Réessayez." };

export async function saveSectionToLibrary(storeId: string, name: string, section: SectionInstance): Promise<{ ok: true; item: EditorSavedSection; message?: string } | Fail> {
  const r = await saveSection(storeId, { name, section }).catch(() => null);
  if (!r) return LOST;
  if (!r.ok) return { ok: false, error: r.fieldErrors?.name?.[0] ?? r.error };
  return {
    ok: true,
    message: r.message,
    item: { id: r.data!.id, name: r.data!.name, sectionType: section.type, sectionName: SECTION_SCHEMAS[section.type]?.name ?? section.type, createdAt: new Date().toISOString() },
  };
}

export async function deleteSavedSectionItem(storeId: string, id: string): Promise<{ ok: true } | Fail> {
  const r = await deleteSavedSection(storeId, id).catch(() => null);
  if (!r) return LOST;
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function fetchSavedPayload(storeId: string, id: string): Promise<{ ok: true; payload: unknown; removedRefs: number } | Fail> {
  const r = await getSavedSectionForInsert(storeId, id).catch(() => null);
  if (!r) return LOST;
  return r.ok ? { ok: true, payload: r.data!.payload, removedRefs: r.data!.removedRefs } : { ok: false, error: r.error };
}

export async function fetchLibraryPayload(storeId: string, itemId: string): Promise<{ ok: true; payload: unknown; removedRefs: number } | Fail> {
  const r = await getLibraryItemForInsert(storeId, itemId).catch(() => null);
  if (!r) return LOST;
  return r.ok ? { ok: true, payload: r.data!.payload, removedRefs: r.data!.removedRefs } : { ok: false, error: r.error };
}

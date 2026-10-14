"use server";

import { requireStore } from "@/lib/auth/permissions";
import { guard, fail, success, zRawId, type ActionResult } from "@/lib/action";
import type { SectionPayload } from "@/lib/saved-sections/payload";
import { libraryItemForStore, listPublishedLibrary, type LibraryItemDTO } from "./service";

/**
 * Bibliothèque de sections, côté éditeur de thème (équipe T2). Capacité `theme.manage`.
 * La bibliothèque est gratuite pour tous ; les éléments premium et `minPlan` sont contrôlés ICI, à l'insertion.
 */

export async function listSectionLibrary(storeId: string): Promise<ActionResult<{ items: LibraryItemDTO[] }>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "theme.manage");
    return success({ items: await listPublishedLibrary(ctx.planId) });
  });
}

/**
 * Charge à insérer (refus si le plan ne le permet pas). L'éditeur clone ensuite avec de nouveaux identifiants :
 * `clonePayload(payload, uniqueIdFactory(doc))` (`src/lib/saved-sections/payload.ts`).
 */
export async function getLibraryItemForInsert(storeId: string, itemId: string): Promise<ActionResult<{ item: LibraryItemDTO; payload: SectionPayload; removedRefs: number }>> {
  return guard(async () => {
    if (!zRawId.safeParse(storeId).success || !zRawId.safeParse(itemId).success) return fail("Identifiant invalide");
    const ctx = await requireStore(storeId, "theme.manage");
    const r = await libraryItemForStore(ctx.store.id, ctx.planId, itemId);
    if (!r.ok) return fail(r.error);
    return success({ item: r.item, payload: r.payload, removedRefs: r.removedRefs });
  });
}

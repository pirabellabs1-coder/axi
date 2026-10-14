/**
 * Lot 4 §8 : marquage d'édition directe (module PUR). Les composants de section appellent
 * `editAttrs(ctx, { sectionId, blockId, settingId, kind })` sur l'élément qui affiche un réglage.
 * Les attributs ne sont produits QU'EN APERÇU (`ctx.preview === true`) : le HTML public n'en contient jamais.
 *
 * Attributs : `data-edit="{sectionId}:{blockId|-}:{settingId}"` et `data-edit-kind`. Un identifiant hors
 * `^[\w-]{1,64}$` ne produit rien (défense : jamais d'attribut construit à partir d'une valeur arbitraire).
 */

export const EDIT_KINDS = ["text", "textarea", "richtext", "image"] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

export type EditTarget = { sectionId: string; blockId?: string | null; settingId: string; kind: EditKind };

const ID_RE = /^[\w-]{1,64}$/;

export function editAttrs(ctx: { preview?: boolean } | null | undefined, t: EditTarget): { "data-edit"?: string; "data-edit-kind"?: EditKind } {
  if (ctx?.preview !== true) return {};
  if (!ID_RE.test(t.sectionId) || !ID_RE.test(t.settingId) || (t.blockId != null && !ID_RE.test(t.blockId))) return {};
  if (!(EDIT_KINDS as readonly string[]).includes(t.kind)) return {};
  return { "data-edit": `${t.sectionId}:${t.blockId ?? "-"}:${t.settingId}`, "data-edit-kind": t.kind };
}

/** Lecture inverse (aperçu → éditeur) : `"hero-1:-:heading"` → cible, ou `null` si invalide. */
export function parseEditAttr(v: unknown): { sectionId: string; blockId: string | null; settingId: string } | null {
  if (typeof v !== "string" || v.length > 200) return null;
  const parts = v.split(":");
  if (parts.length !== 3) return null;
  const [sectionId, block, settingId] = parts;
  if (!ID_RE.test(sectionId) || !ID_RE.test(settingId) || (block !== "-" && !ID_RE.test(block))) return null;
  return { sectionId, blockId: block === "-" ? null : block, settingId };
}

/**
 * Menus de navigation de la boutique (`StoreMenu.items`) : types, validation et utilitaires purs.
 * Deux niveaux maximum (élément > sous-éléments). Les cibles collection/produit/page sont des ids,
 * vérifiés côté serveur (appartenance à la boutique).
 */
import { z } from "zod";
import { isSafeLink } from "@/lib/theme-engine/validate";

export const MENU_LINK_TYPES = ["home", "catalog", "collection", "product", "page", "url"] as const;
export type MenuLinkType = (typeof MENU_LINK_TYPES)[number];

export const MENU_LINK_LABELS: Record<MenuLinkType, string> = {
  home: "Accueil",
  catalog: "Catalogue",
  collection: "Collection",
  product: "Produit",
  page: "Page",
  url: "Adresse web",
};

export type MenuItem = { id: string; label: string; type: MenuLinkType; target?: string; children?: MenuItem[] };

/** Menus fournis par défaut (non supprimables). */
export const CORE_MENUS: { handle: string; title: string; description: string }[] = [
  { handle: "main", title: "Menu principal", description: "Affiché dans l'en-tête de la boutique." },
  { handle: "footer", title: "Pied de page", description: "Liens utiles en bas de chaque page." },
];

export const MAX_MENU_ITEMS = 20;
export const MAX_MENU_CHILDREN = 15;
export const MAX_CUSTOM_MENUS = 6;
export const MENU_HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function menuTitle(handle: string): string {
  return CORE_MENUS.find((m) => m.handle === handle)?.title ?? handle.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

const label = z.string().trim().min(1, "Libellé requis.").max(60, "Libellé : 60 caractères maximum.");
const itemId = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, "Identifiant invalide.");

function itemSchema<C extends z.ZodType>(children: C) {
  return z
    .object({
      id: itemId,
      label,
      type: z.enum(MENU_LINK_TYPES, { error: "Type de lien inconnu." }),
      target: z.string().max(2000).optional(),
      children,
    })
    .strict()
    .superRefine((it, ctx) => {
      if (it.type === "url" && !(it.target && isSafeLink(it.target))) {
        ctx.addIssue({ code: "custom", path: ["target"], message: `« ${it.label} » : chemin de la boutique (/catalogue) ou adresse https.` });
      }
      if ((it.type === "collection" || it.type === "product" || it.type === "page") && !(it.target && /^[A-Za-z0-9_-]{1,64}$/.test(it.target))) {
        ctx.addIssue({ code: "custom", path: ["target"], message: `« ${it.label} » : choisissez la ${MENU_LINK_LABELS[it.type].toLowerCase()} liée.` });
      }
    });
}

const childSchema = itemSchema(z.undefined().optional());
const topSchema = itemSchema(z.array(childSchema).max(MAX_MENU_CHILDREN, `${MAX_MENU_CHILDREN} sous-éléments maximum.`).optional());

export const menuItemsSchema = z
  .array(topSchema)
  .max(MAX_MENU_ITEMS, `${MAX_MENU_ITEMS} éléments maximum par menu.`)
  .superRefine((items, ctx) => {
    const ids = new Set<string>();
    for (const it of items) {
      for (const id of [it.id, ...(it.children ?? []).map((c) => c.id)]) {
        if (ids.has(id)) ctx.addIssue({ code: "custom", message: "Élément de menu en double." });
        ids.add(id);
      }
    }
  });

export type MenuRefs = { collectionIds: Set<string>; productIds: Set<string>; pageIds: Set<string> };

export function menuTargets(items: MenuItem[]): { collectionIds: string[]; productIds: string[]; pageIds: string[] } {
  const out = { collectionIds: new Set<string>(), productIds: new Set<string>(), pageIds: new Set<string>() };
  const visit = (it: MenuItem) => {
    if (it.target && it.type === "collection") out.collectionIds.add(it.target);
    if (it.target && it.type === "product") out.productIds.add(it.target);
    if (it.target && it.type === "page") out.pageIds.add(it.target);
    it.children?.forEach(visit);
  };
  items.forEach(visit);
  return { collectionIds: [...out.collectionIds], productIds: [...out.productIds], pageIds: [...out.pageIds] };
}

export type MenuValidation = { ok: true; items: MenuItem[] } | { ok: false; error: string };

/** Valide un menu ; avec `refs`, vérifie que chaque cible appartient à la boutique. */
export function validateMenuItems(input: unknown, refs?: MenuRefs): MenuValidation {
  const parsed = menuItemsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Menu invalide." };
  const items = parsed.data.map((it) => {
    const { children, target, ...rest } = it;
    const top: MenuItem = { ...rest, ...(needsTarget(it.type) ? { target } : {}) };
    if (children?.length) top.children = children.map((ch) => ({ id: ch.id, label: ch.label, type: ch.type, ...(needsTarget(ch.type) ? { target: ch.target } : {}) }));
    return top;
  });
  if (refs) {
    const bad = (it: MenuItem) =>
      (it.type === "collection" && !refs.collectionIds.has(it.target!)) ||
      (it.type === "product" && !refs.productIds.has(it.target!)) ||
      (it.type === "page" && !refs.pageIds.has(it.target!));
    for (const it of items) {
      const culprit = bad(it) ? it : it.children?.find(bad);
      if (culprit) return { ok: false, error: `« ${culprit.label} » : la cible n'existe plus dans votre boutique.` };
    }
  }
  return { ok: true, items };
}

function needsTarget(t: MenuLinkType): boolean {
  return t !== "home" && t !== "catalog";
}

/** Lecture tolérante de `StoreMenu.items` (Json) : ignore les entrées invalides. */
export function readMenuItems(raw: unknown): MenuItem[] {
  const v = validateMenuItems(raw);
  if (v.ok) return v.items;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const one = validateMenuItems([x]);
    return one.ok ? one.items : [];
  });
}

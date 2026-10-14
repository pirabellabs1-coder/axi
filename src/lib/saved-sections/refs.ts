import "server-only";
import { db, type Tx } from "@/lib/db";
import { CORE_MENUS } from "@/lib/theme/menu-schema";
import { payloadRefs, stripMissingRefs, type SectionPayload } from "./payload";

/**
 * Vérifie les références d'une charge contre la boutique (produits, collections, menus) et retire celles qui
 * n'existent pas (ou plus). Menus : menus de base (CORE_MENUS) toujours valides, comme à l'enregistrement du thème. Partagé par les sections enregistrées et la bibliothèque (insertion).
 */
export async function verifyPayloadRefs(storeId: string, payload: SectionPayload, client: Tx | typeof db = db): Promise<{ payload: SectionPayload; removed: number }> {
  const refs = payloadRefs(payload);
  if (!refs.productIds.length && !refs.collectionIds.length && !refs.menuHandles.length) return { payload, removed: 0 };
  const [products, collections, menus] = await Promise.all([
    refs.productIds.length ? client.product.findMany({ where: { storeId, id: { in: refs.productIds } }, select: { id: true } }) : [],
    refs.collectionIds.length ? client.category.findMany({ where: { storeId, id: { in: refs.collectionIds } }, select: { id: true } }) : [],
    refs.menuHandles.length ? client.storeMenu.findMany({ where: { storeId, handle: { in: refs.menuHandles } }, select: { handle: true } }) : [],
  ]);
  return stripMissingRefs(payload, {
    productIds: new Set(products.map((p) => p.id)),
    collectionIds: new Set(collections.map((c) => c.id)),
    menuHandles: new Set([...CORE_MENUS.map((m) => m.handle), ...menus.map((m) => m.handle)]),
  });
}

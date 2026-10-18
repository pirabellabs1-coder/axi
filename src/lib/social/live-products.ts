import "server-only";
import { db } from "@/lib/db";
import { effectivePrice } from "@/lib/commerce/pricing";
import { canSell } from "@/lib/inventory/policy";
import { clientIp, rateLimitAll } from "@/lib/rate-limit";

/**
 * Ajout au panier depuis la section « Direct » : GET /s/{slug}/feeds/live-products.json?ids=a,b,c
 *
 * Données PUBLIQUES (déjà sur les fiches produits) nécessaires au bouton « Ajouter » : prix affiché (unité mineure de
 * la devise de la boutique), quantité minimale, et `quickAdd` — vrai seulement pour un produit physique simple (sans
 * variante, sans option, hors carte cadeau) vendable maintenant. Sinon la vitrine propose « Choisir » (fiche produit).
 * Le panier reste recalculé côté serveur à la commande (prix, stock) : le prix renvoyé ici sert à l'affichage.
 * Boutique publique uniquement, filtré par boutique, 12 produits au plus, débit limité par IP, jamais mis en cache.
 */

export type LiveCartProduct = { id: string; slug: string; name: string; price: number; image: string | null; minQty: number; quickAdd: boolean };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{8,64}$/.test(s)))].slice(0, 12);
}

export async function serveLiveProducts(slug: string, idsParam: string | null): Promise<Response> {
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) return json({ products: [] }, 404);
  const ids = parseIds(idsParam);
  if (!ids.length) return json({ products: [] });
  const ip = await clientIp();
  const rl = await rateLimitAll([{ key: `live:products:${slug}:${ip}`, limit: 120, windowSec: 600 }]);
  if (!rl.ok) return json({ products: [] }, 429);

  const store = await db.store.findUnique({ where: { slug }, select: { id: true, status: true } });
  if (!store || store.status !== "PUBLISHED") return json({ products: [] }, store ? 200 : 404);

  const now = new Date();
  const rows = await db.product.findMany({
    where: { storeId: store.id, id: { in: ids }, status: "ACTIVE" },
    select: {
      id: true, slug: true, name: true, price: true, promoPrice: true, promoStart: true, promoEnd: true, images: true, minQty: true,
      trackStock: true, stock: true, inventoryPolicy: true, isGiftCard: true, kind: true,
      _count: { select: { variants: true, optionGroups: true } },
    },
  });
  const products: LiveCartProduct[] = rows.map((p) => {
    const first = Array.isArray(p.images) ? (p.images[0] as { url?: unknown } | undefined)?.url : undefined;
    const image = typeof first === "string" && (first.startsWith("https://") || first.startsWith("/")) ? first : null;
    const minQty = Math.max(1, p.minQty);
    const simple = p._count.variants === 0 && p._count.optionGroups === 0 && !p.isGiftCard && p.kind === "PHYSICAL";
    const sellable = canSell({ trackStock: p.trackStock, stock: p.stock, policy: String(p.inventoryPolicy) }, minQty);
    return { id: p.id, slug: p.slug, name: p.name, price: effectivePrice(p, now).price, image, minQty, quickAdd: simple && sellable };
  });
  return json({ products });
}

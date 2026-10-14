import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import type { StorageDriver } from "@/lib/storage/drivers";
import { returnMediaPrefix } from "@/lib/storage/keys";
import { bytesToKb } from "@/lib/storage/quota";
import { releaseMediaQuota } from "@/lib/storage/usage";

/**
 * Purge des photos de retour orphelines (audit sécurité lot 1).
 * Un acheteur téléverse ses photos AVANT d'envoyer sa demande ; s'il abandonne, l'objet occuperait le quota de la
 * boutique indéfiniment. Toute photo de `stores/{id}/returns/` plus vieille que 24 h et citée par aucune demande de
 * retour de la boutique est supprimée, et son espace rendu au compteur (`releaseMediaQuota` : décrément atomique,
 * jamais sous zéro). Un objet déjà absent n'est jamais décompté (pas de double remboursement).
 *
 * Appelée par le balayage de /api/jobs/run (verrou global `claimSweep` : un seul exécutant à la fois).
 * Boutiques examinées : celles qui ont (ou ont eu) une politique de retours, seules à recevoir ces photos.
 */
export const RETURN_PHOTO_GRACE_MS = 24 * 3600_000;

export type PhotoPurgeResult = { stores: number; scanned: number; deleted: number; releasedKb: number; errors: number };

/** Clé de stockage citée par une URL de photo (`…/stores/{id}/returns/…`), ou null. */
export function keyFromPhotoUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const i = url.indexOf("stores/");
  return i >= 0 ? url.slice(i) : null;
}

export async function purgeOrphanReturnPhotos(opts: { driver?: StorageDriver; now?: Date; graceMs?: number; maxDeletes?: number } = {}): Promise<PhotoPurgeResult> {
  const driver = opts.driver ?? getStorage();
  const now = (opts.now ?? new Date()).getTime();
  const grace = opts.graceMs ?? RETURN_PHOTO_GRACE_MS;
  const maxDeletes = opts.maxDeletes ?? 500;
  const stores = await db.store.findMany({ where: { NOT: { returnPolicy: { equals: Prisma.AnyNull } } }, select: { id: true } });
  const out: PhotoPurgeResult = { stores: stores.length, scanned: 0, deleted: 0, releasedKb: 0, errors: 0 };

  for (const store of stores) {
    if (out.deleted >= maxDeletes) break;
    const rows = await db.returnRequest.findMany({ where: { storeId: store.id, NOT: { photos: { equals: Prisma.AnyNull } } }, select: { photos: true } });
    const referenced = new Set<string>();
    for (const r of rows) {
      for (const p of Array.isArray(r.photos) ? (r.photos as { url?: unknown }[]) : []) {
        const key = keyFromPhotoUrl(p?.url);
        if (key) referenced.add(key);
      }
    }
    try {
      for await (const obj of driver.list(returnMediaPrefix(store.id))) {
        if (!obj.key.startsWith(returnMediaPrefix(store.id))) continue;
        out.scanned++;
        if (referenced.has(obj.key)) continue;
        // Date inconnue : prudence, on ne supprime pas.
        if (!obj.lastModified || now - obj.lastModified.getTime() < grace) continue;
        if (await driver.remove(obj.key)) {
          const kb = bytesToKb(obj.size);
          await releaseMediaQuota(store.id, kb);
          out.deleted++;
          out.releasedKb += kb;
          if (out.deleted >= maxDeletes) break;
        }
      }
    } catch (e) {
      out.errors++;
      console.error("[returns] purge photos", store.id, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

import type { PlanId } from "@/config/plans";

/**
 * Espace de stockage des médias par boutique (module pur).
 *
 * `src/config/plans.ts` ne définit pas de limite de stockage : plafonds raisonnables ci-dessous
 * (photos compressées à ~300 Ko côté navigateur), augmentés de 10 Go par option STORAGE_10GB active.
 * Le quota bloque les NOUVEAUX envois, jamais l'affichage. Réservation atomique avant l'écriture (usage.ts :
 * UPDATE conditionnel), remboursée si l'écriture échoue : des envois simultanés ne peuvent pas le dépasser.
 * Usage compté en Kio dans UsageCounter (metric `media_kb`, period `all`) : un Int de Postgres plafonne à
 * 2^31, soit 2 To en Kio (en octets il déborderait dès 2 Go). Les fichiers orphelins restent comptés
 * tant qu'ils ne sont pas supprimés (pas de suppression automatique en v1).
 */
export const MEDIA_USAGE_METRIC = "media_kb";
export const MEDIA_USAGE_PERIOD = "all";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const STORAGE_QUOTA_BYTES: Record<PlanId, number | null> = {
  FREE: 100 * MB,
  STARTER: 1 * GB,
  BUSINESS: 5 * GB,
  SCALE: 20 * GB,
  ENTERPRISE: null, // illimité
};

export const STORAGE_ADDON_BYTES = 10 * GB;

export function storageQuotaBytes(planId: PlanId, storageAddOns = 0): number | null {
  const base = STORAGE_QUOTA_BYTES[planId];
  return base == null ? null : base + Math.max(0, storageAddOns) * STORAGE_ADDON_BYTES;
}

export function bytesToKb(bytes: number): number {
  return Math.ceil(bytes / 1024);
}

/** Vrai si l'ajout de `bytes` reste dans le quota (usage en Kio). */
export function withinQuota(usedKb: number, bytes: number, quotaBytes: number | null): boolean {
  return quotaBytes == null || (usedKb + bytesToKb(bytes)) * 1024 <= quotaBytes;
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go`;
  if (bytes >= MB) return `${(bytes / MB).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
  if (bytes <= 0) return "0 Ko";
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("fr-FR")} Ko`;
}

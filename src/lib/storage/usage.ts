import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { MEDIA_USAGE_METRIC as METRIC, MEDIA_USAGE_PERIOD as PERIOD } from "./quota";

/**
 * Compteur d'espace des médias (UsageCounter `media_kb` / `all`), en Kio.
 * Réservation ATOMIQUE avant l'écriture de l'objet : un seul UPDATE conditionnel (`value + kb <= quota`), donc
 * deux envois simultanés ne peuvent pas dépasser le quota ensemble. Remboursement si l'écriture échoue.
 */
async function ensureRow(storeId: string) {
  try {
    await db.usageCounter.upsert({
      where: { storeId_metric_period: { storeId, metric: METRIC, period: PERIOD } },
      create: { storeId, metric: METRIC, period: PERIOD, value: 0 },
      update: {},
    });
  } catch (e) {
    // Création concurrente de la même ligne : elle existe désormais, c'est tout ce qu'on voulait.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
}

/** Réserve `kb` Kio ; false si le quota (en octets, null = illimité) serait dépassé. */
export async function reserveMediaQuota(storeId: string, kb: number, quotaBytes: number | null): Promise<boolean> {
  await ensureRow(storeId);
  const n =
    quotaBytes == null
      ? await db.$executeRaw`UPDATE "UsageCounter" SET "value" = "value" + ${kb} WHERE "storeId" = ${storeId} AND "metric" = ${METRIC} AND "period" = ${PERIOD}`
      : await db.$executeRaw`UPDATE "UsageCounter" SET "value" = "value" + ${kb} WHERE "storeId" = ${storeId} AND "metric" = ${METRIC} AND "period" = ${PERIOD} AND "value" + ${kb} <= ${Math.floor(quotaBytes / 1024)}`;
  return n === 1;
}

/** Rend une réservation (écriture de l'objet échouée). Jamais sous zéro. */
export async function releaseMediaQuota(storeId: string, kb: number): Promise<void> {
  await db.$executeRaw`UPDATE "UsageCounter" SET "value" = GREATEST("value" - ${kb}, 0) WHERE "storeId" = ${storeId} AND "metric" = ${METRIC} AND "period" = ${PERIOD}`;
}

/** Ajout sans plafond (migration des anciennes images : elles occupent déjà la base). */
export async function addMediaUsage(storeId: string, kb: number): Promise<void> {
  await reserveMediaQuota(storeId, kb, null);
}

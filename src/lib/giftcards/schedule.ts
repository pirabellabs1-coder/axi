import "server-only";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";

/**
 * Planification quotidienne des balayages (giftcard.expire_sweep, tenders.unpaid_sweep) : un seul enqueue par jour
 * UTC, quel que soit le nombre d'appels concurrents à /api/jobs/run. Réservation atomique par upsert conditionnel
 * sur `PlatformSetting` (`giftcards.daily_sweep` = { day }), dans la même transaction que les enqueue.
 */
const KEY = "giftcards.daily_sweep";

export async function scheduleDailyGiftCardSweeps(now = new Date()): Promise<{ scheduled: boolean; day: string }> {
  const day = now.toISOString().slice(0, 10);
  const value = JSON.stringify({ day });
  const scheduled = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ key: string }[]>`
      INSERT INTO "PlatformSetting" ("key", "value", "updatedBy", "updatedAt")
      VALUES (${KEY}, ${value}::jsonb, 'system', now())
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now(), "updatedBy" = 'system'
      WHERE "PlatformSetting"."value"->>'day' IS DISTINCT FROM ${day}
      RETURNING "key"`;
    if (rows.length === 0) return false;
    await enqueue("giftcard.expire_sweep", { day }, {}, tx);
    await enqueue("tenders.unpaid_sweep", { day }, {}, tx);
    return true;
  });
  return { scheduled, day };
}

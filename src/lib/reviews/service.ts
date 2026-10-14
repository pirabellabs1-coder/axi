import "server-only";
import { db } from "@/lib/db";

/** Note moyenne et répartition des avis APPROUVÉS (réutilisable par la boutique publique). */
export async function getRatingSummary(storeId: string, productId?: string) {
  const rows = await db.review.groupBy({
    by: ["rating"],
    where: { storeId, status: "APPROVED", ...(productId ? { productId } : {}) },
    _count: { _all: true },
  });
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let sum = 0;
  for (const r of rows) {
    const k = Math.min(5, Math.max(1, r.rating)) as 1 | 2 | 3 | 4 | 5;
    distribution[k] += r._count._all;
    count += r._count._all;
    sum += k * r._count._all;
  }
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : null, distribution };
}

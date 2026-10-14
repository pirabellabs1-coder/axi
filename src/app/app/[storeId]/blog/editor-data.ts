import "server-only";
import { db } from "@/lib/db";
import { PLANS, type PlanId } from "@/config/plans";
import { getBalances } from "@/lib/credits";
import { isAiConfigured } from "@/lib/ai/client";
import { BLOG_AI_COST } from "@/lib/blog/constants";
import { utcToZonedLocal } from "@/lib/blog/visibility";

/** Données communes de l'éditeur d'article : catégories, état de l'assistant IA, bornes de programmation. */
export async function editorData(storeId: string, planId: PlanId, timezone: string) {
  const tz = timezone || "UTC";
  const [categories, ai] = await Promise.all([
    db.blogCategory.findMany({ where: { storeId }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    (async () => {
      if (!isAiConfigured()) return { available: false, reason: "L'assistant IA n'est pas encore activé sur la plateforme.", balance: null };
      if (!PLANS[planId].features.aiAssistant) return { available: false, reason: "La rédaction par l'IA est incluse à partir du plan Business.", balance: null };
      const balance = (await getBalances(storeId)).AI;
      return balance >= BLOG_AI_COST
        ? { available: true, reason: null, balance }
        : { available: false, reason: `Crédits IA insuffisants (${balance} sur ${BLOG_AI_COST} nécessaires) : achetez un pack depuis Options et crédits.`, balance };
    })(),
  ]);
  const now = Date.now();
  return {
    categories,
    ai,
    timezone: tz,
    minSchedule: utcToZonedLocal(new Date(now + 5 * 60_000), tz),
    defaultSchedule: utcToZonedLocal(new Date(Math.ceil((now + 60 * 60_000) / 3_600_000) * 3_600_000), tz),
  };
}

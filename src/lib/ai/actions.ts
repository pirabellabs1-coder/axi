"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { debitCredits, refundCredits } from "@/lib/credits";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { randomToken } from "@/lib/utils";
import { AiError, callClaudeJson, isAiConfigured } from "./client";
import { AI_MODEL, aiCost, parseDescribeResponse, type DescribeOutput } from "./parse";
import { DESCRIBE_JSON_SCHEMA, DESCRIBE_SYSTEM, buildDescribePrompt } from "./prompts";

/**
 * Assistant de rédaction (V4 §20). Propose un texte que le commerçant relit et applique lui-même :
 * rien n'est jamais écrit automatiquement dans la fiche produit.
 * Crédits IA : 1 par description, 2 avec la traduction anglaise ; débités avant l'appel,
 * remboursés si l'appel échoue.
 */

export type AiStatus = { available: boolean; reason: string | null; balance: number | null };

/** État de l'assistant pour l'interface (bouton actif ou non, et pourquoi). */
export async function getAiStatus(storeId: string): Promise<ActionResult<AiStatus>> {
  return guard<AiStatus>(async () => {
    const ctx = await requireStore(storeId, "products.manage");
    if (!isAiConfigured()) return success({ available: false, reason: "L'assistant IA n'est pas encore activé sur la plateforme.", balance: null });
    if (!PLANS[ctx.planId].features.aiAssistant) return success({ available: false, reason: "L'assistant de rédaction est inclus à partir du plan Business.", balance: null });
    const { getBalances } = await import("@/lib/credits");
    const balance = (await getBalances(ctx.store.id)).AI;
    return success({ available: balance > 0, reason: balance > 0 ? null : "Crédits IA épuisés : achetez un pack depuis la page Abonnement.", balance });
  });
}

const schema = z.object({
  storeId: z.string().min(8).max(64),
  name: z.string().trim().min(2, "Indiquez d'abord le nom du produit.").max(120),
  category: z.string().trim().max(60).nullable().optional(),
  keywords: z.string().trim().max(400, "400 caractères maximum").nullable().optional(),
  translate: z.boolean().default(false),
  productId: z.string().max(64).nullable().optional(),
});

export type DescribeInput = z.input<typeof schema>;

export async function generateProductDescription(input: DescribeInput): Promise<ActionResult<DescribeOutput & { creditsUsed: number }>> {
  return guard<DescribeOutput & { creditsUsed: number }>(async () => {
    const p = schema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Demande invalide.");
    const d = p.data;
    const ctx = await requireStore(d.storeId, "products.manage");
    if (!isAiConfigured()) return fail("L'assistant IA n'est pas encore activé sur la plateforme.");
    if (!PLANS[ctx.planId].features.aiAssistant) return fail(`L'assistant de rédaction est inclus à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}).`);

    const rl = await rateLimit(`ai:store:${ctx.store.id}`, 30, 10 * 60);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const cost = aiCost(d.translate);
    const reference = `ai:${randomToken(8)}`;
    const debit = await db.$transaction((tx) => debitCredits(ctx.store.id, "AI", cost, reference, tx));
    if (!debit.ok) return fail(debit.error);

    const log = (ok: boolean, extra: Record<string, unknown>) =>
      audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "ai.product_description", target: d.productId ?? undefined, metadata: { ok, model: AI_MODEL, credits: ok ? cost : 0, translate: d.translate, ...extra } }).catch(() => {});

    try {
      const res = await callClaudeJson({
        system: DESCRIBE_SYSTEM,
        user: buildDescribePrompt({ name: d.name, category: d.category, keywords: d.keywords, storeName: ctx.store.name, translate: d.translate }),
        schema: DESCRIBE_JSON_SCHEMA as unknown as Record<string, unknown>,
      });
      const parsed = parseDescribeResponse(res.text, { translate: d.translate });
      if (!parsed.ok) {
        await refundCredits(ctx.store.id, reference, null);
        await log(false, { error: "parse", inputTokens: res.usage.input, outputTokens: res.usage.output });
        return fail(parsed.error);
      }
      await log(true, { inputTokens: res.usage.input, outputTokens: res.usage.output, removed: parsed.data.removed.length });
      return success({ ...parsed.data, creditsUsed: cost }, "Proposition prête : relisez-la avant de l'utiliser.");
    } catch (e) {
      await refundCredits(ctx.store.id, reference, null);
      await log(false, { error: e instanceof AiError ? e.message : "exception" });
      if (e instanceof AiError) return fail(`${e.message} Vos crédits n'ont pas été débités.`);
      throw e;
    }
  });
}

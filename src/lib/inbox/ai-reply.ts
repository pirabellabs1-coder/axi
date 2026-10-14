"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { debitCredits, refundCredits } from "@/lib/credits";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { formatMoney } from "@/lib/money";
import { randomToken } from "@/lib/utils";
import { AiError, callClaudeJson, isAiConfigured } from "@/lib/ai/client";
import { AI_MODEL } from "@/lib/ai/parse";

/**
 * Agent IA de la boîte de réception — palier 1 : SUGGESTION de réponse.
 * L'IA rédige une proposition à partir de la conversation, des informations de la boutique et d'un extrait
 * du catalogue réel ; le commerçant la relit, la modifie et l'envoie lui-même. Garde-fous :
 *  - jamais d'envoi automatique, aucune action (commande, paiement, stock) déclenchée par l'IA ;
 *  - consigne de ne pas inventer de prix, de stock ni de délai absents du contexte ;
 *  - 1 crédit IA débité avant l'appel, remboursé en cas d'échec ; débit limité par boutique.
 */

const SUGGEST_COST = 1;
const MAX_HISTORY = 14;
const MAX_PRODUCTS = 25;

const SYSTEM = `Tu es l'assistant de vente d'une boutique qui vend sur WhatsApp. Tu rédiges UNE réponse courte, chaleureuse et professionnelle, en français (ou dans la langue du client si elle est clairement différente), que le commerçant relira avant envoi.
Règles strictes :
- N'invente jamais de prix, de stock, de délai, de frais ou de promotion : utilise uniquement les informations fournies. Si une information manque, propose de la vérifier ("je vérifie et je reviens vers vous").
- Ne confirme jamais un paiement reçu et ne promets jamais un remboursement : ces décisions appartiennent au commerçant.
- Pas de liens inventés. 1 à 4 phrases, style messagerie, sans formule administrative.
Réponds uniquement en JSON : {"reply": "..."}`;

const SCHEMA = {
  type: "object",
  properties: { reply: { type: "string", description: "Texte de la réponse proposée" } },
  required: ["reply"],
  additionalProperties: false,
} as const;

const inputSchema = z.object({ storeId: z.string().min(8).max(64), conversationId: z.string().min(8).max(64) });

export async function suggestInboxReply(input: { storeId: string; conversationId: string }): Promise<ActionResult<{ reply: string }>> {
  return guard<{ reply: string }>(async () => {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return fail("Demande invalide.");
    const ctx = await requireStore(parsed.data.storeId, "orders.manage");
    const features = PLANS[ctx.planId].features;
    if (!features.inbox) return fail("La boîte de réception est incluse à partir du plan Business.");
    if (!features.aiAssistant) return fail(`L'assistant IA est inclus à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}).`);
    if (!isAiConfigured()) return fail("L'assistant IA n'est pas encore activé sur la plateforme.");

    const rl = await rateLimit(`ai:inbox:${ctx.store.id}`, 60, 10 * 60);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const conversation = await db.conversation.findFirst({
      where: { id: parsed.data.conversationId, storeId: ctx.store.id },
      select: { id: true, name: true },
    });
    if (!conversation) return fail("Conversation introuvable.");

    const [messages, products] = await Promise.all([
      db.message.findMany({
        where: { conversationId: conversation.id, direction: { in: ["INBOUND", "OUTBOUND"] } },
        orderBy: { createdAt: "desc" },
        take: MAX_HISTORY,
        select: { direction: true, body: true, attachmentUrl: true },
      }),
      db.product.findMany({
        where: { storeId: ctx.store.id, status: "ACTIVE" },
        orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
        take: MAX_PRODUCTS,
        select: { name: true, price: true, trackStock: true, stock: true, inventoryPolicy: true },
      }),
    ]);
    const lastInbound = messages.find((m) => m.direction === "INBOUND");
    if (!lastInbound) return fail("Aucun message du client à qui répondre.");

    const history = messages
      .slice()
      .reverse()
      .map((m) => `${m.direction === "INBOUND" ? "Client" : "Boutique"} : ${m.body || (m.attachmentUrl ? "[image]" : "")}`.slice(0, 600))
      .join("\n");
    const catalog = products
      .map((p) => {
        const out = p.trackStock && p.inventoryPolicy === "DENY" && p.stock <= 0;
        return `- ${p.name} : ${formatMoney(p.price, ctx.store.currency)}${out ? " (épuisé)" : ""}`;
      })
      .join("\n");
    const user = [
      `Boutique : ${ctx.store.name}${ctx.store.tagline ? ` — ${ctx.store.tagline}` : ""}`,
      ctx.store.city ? `Ville : ${ctx.store.city}` : null,
      `Client : ${conversation.name || "client"}`,
      catalog ? `Extrait du catalogue (prix réels) :\n${catalog}` : "Catalogue : non fourni.",
      `Conversation (du plus ancien au plus récent) :\n${history}`,
      "Rédige la prochaine réponse de la boutique.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const reference = `ai:inbox:${randomToken(8)}`;
    const debit = await db.$transaction((tx) => debitCredits(ctx.store.id, "AI", SUGGEST_COST, reference, tx));
    if (!debit.ok) return fail(debit.error);

    const log = (ok: boolean, extra: Record<string, unknown>) =>
      audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "ai.inbox_suggestion", target: conversation.id, metadata: { ok, model: AI_MODEL, credits: ok ? SUGGEST_COST : 0, ...extra } }).catch(() => {});

    try {
      const res = await callClaudeJson({ system: SYSTEM, user, schema: SCHEMA as unknown as Record<string, unknown>, maxTokens: 400, effort: "low" });
      let reply = "";
      try {
        const obj = JSON.parse(res.text) as { reply?: unknown };
        reply = typeof obj.reply === "string" ? obj.reply.trim() : "";
      } catch {
        reply = "";
      }
      if (!reply) {
        await refundCredits(ctx.store.id, reference, null);
        await log(false, { error: "parse" });
        return fail("L'assistant n'a pas pu proposer de réponse. Réessayez. Vos crédits n'ont pas été débités.");
      }
      await log(true, { inputTokens: res.usage.input, outputTokens: res.usage.output });
      return success({ reply: reply.slice(0, 2000) }, "Proposition prête : relisez-la avant d'envoyer.");
    } catch (e) {
      await refundCredits(ctx.store.id, reference, null);
      await log(false, { error: e instanceof AiError ? e.message : "exception" });
      if (e instanceof AiError) return fail(`${e.message} Vos crédits n'ont pas été débités.`);
      throw e;
    }
  });
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ConversationStage, ConversationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, type Capability } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zOptionalString, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";
import { getCountry } from "@/config/site";
import { normalizePhone } from "@/lib/utils";
import { isStoredMediaUrl } from "@/lib/storage/public-url";
import { parseMoneyInput } from "@/lib/money";
import { STAGES, MAX_MESSAGE_LENGTH, MAX_LABELS } from "./constants";
import { CreditError, dispatchWhatsappNow, ensureConversation, isWhatsappApiActive, queueOutboundMessage, scheduleDispatch } from "./service";

async function inboxContext(storeId: string, cap: Capability, feature: "inbox" | "pipeline" = "inbox") {
  const ctx = await requireStore(storeId, cap);
  const f = PLANS[ctx.planId].features;
  if (!f[feature]) {
    return { ctx, error: fail(`Cette fonctionnalité est incluse à partir du plan Business. Changez de plan : /app/${ctx.store.id}/abonnement`) };
  }
  return { ctx, error: null };
}

function revalidateInbox(storeId: string) {
  revalidatePath(`/app/${storeId}/conversations`);
  revalidatePath(`/app/${storeId}/entonnoir`);
}

/* ───────────── Envoi d'un message / d'une note ───────────── */

const sendSchema = z.object({
  storeId: z.string().min(1),
  conversationId: z.string().min(1),
  mode: z.enum(["reply", "note"]),
  // Texte optionnel : une réponse peut être une image seule (ou une image + légende).
  body: z.string().trim().max(MAX_MESSAGE_LENGTH, `${MAX_MESSAGE_LENGTH} caractères maximum`).optional().default(""),
  // Image jointe (réponse uniquement) : URL du stockage de la boutique.
  imageUrl: zOptionalString,
});

export type SendResult = { status: "QUEUED" | "LINK_ONLY" | "NOTE"; messageId: string };

export async function sendInboxMessage(_prev: ActionResult<SendResult> | undefined, formData: FormData): Promise<ActionResult<SendResult>> {
  return guard<SendResult>(async () => {
    const parsed = parseForm(sendSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { ctx, error } = await inboxContext(parsed.data.storeId, "orders.manage");
    if (error) return error;
    const conversation = await db.conversation.findFirst({ where: { id: parsed.data.conversationId, storeId: ctx.store.id }, select: { id: true, phone: true } });
    if (!conversation) return fail("Conversation introuvable");

    const body = parsed.data.body ?? "";

    if (parsed.data.mode === "note") {
      if (!body.trim()) return fail("Écrivez une note.");
      const note = await db.message.create({
        data: { conversationId: conversation.id, direction: "NOTE", body, status: "RECEIVED", authorId: ctx.user.id },
      });
      revalidateInbox(ctx.store.id);
      return success({ status: "NOTE", messageId: note.id }, "Note interne ajoutée");
    }

    // Réponse : image jointe facultative (URL du stockage de la boutique uniquement).
    const imageUrl = parsed.data.imageUrl && isStoredMediaUrl(parsed.data.imageUrl) ? parsed.data.imageUrl : null;
    if (parsed.data.imageUrl && !imageUrl) return fail("Image non reconnue.");
    if (!body.trim() && !imageUrl) return fail("Écrivez un message ou joignez une image.");

    const apiActive = await isWhatsappApiActive(ctx.store.id);
    try {
      const message = await db.$transaction(async (tx) => {
        const m = await queueOutboundMessage(tx, {
          storeId: ctx.store.id,
          conversationId: conversation.id,
          phone: conversation.phone,
          body,
          authorId: ctx.user.id,
          apiActive,
          creditType: "WA_UTILITY",
          template: "inbox.reply",
          attachmentUrl: imageUrl,
          attachmentType: imageUrl ? "image" : null,
        });
        if (apiActive) await scheduleDispatch(ctx.store.id, tx);
        return m;
      });
      // Envoi immédiat (sans attendre le worker/cron) ; repli sur la file en cas d'aléa.
      if (apiActive) await dispatchWhatsappNow(ctx.store.id).catch(() => undefined);
      revalidateInbox(ctx.store.id);
      return apiActive
        ? success({ status: "QUEUED", messageId: message.id }, "Message mis en file d'envoi")
        : success({ status: "LINK_ONLY", messageId: message.id }, "Message prêt : ouvrez WhatsApp pour l'envoyer");
    } catch (e) {
      if (e instanceof CreditError) return fail(e.message);
      throw e;
    }
  });
}

/* ───────────── Lecture, attribution, statut, étape ───────────── */

export async function markConversationRead(storeId: string, conversationId: string): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, error } = await inboxContext(storeId, "orders.view");
    if (error) return error;
    await db.conversation.updateMany({ where: { id: conversationId, storeId: ctx.store.id, unreadCount: { gt: 0 } }, data: { unreadCount: 0 } });
    return success();
  });
}

export async function assignConversation(storeId: string, conversationId: string, userId: string | null): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, error } = await inboxContext(storeId, "orders.assign");
    if (error) return error;
    if (userId) {
      const member = await db.membership.findUnique({ where: { userId_storeId: { userId, storeId: ctx.store.id } }, select: { role: true } });
      if (!member || member.role === "SUPPORT") return fail("Ce membre ne fait pas partie de l'équipe");
    }
    const r = await db.conversation.updateMany({ where: { id: conversationId, storeId: ctx.store.id }, data: { assignedToId: userId } });
    if (r.count === 0) return fail("Conversation introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "conversation.assigned", target: conversationId, metadata: { assignedToId: userId } });
    revalidateInbox(ctx.store.id);
    return success(undefined, userId ? "Conversation attribuée" : "Attribution retirée");
  });
}

/** Raccourci « me l'attribuer » utilisable par tout membre qui peut répondre. */
export async function assignToMe(storeId: string, conversationId: string): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, error } = await inboxContext(storeId, "orders.manage");
    if (error) return error;
    const r = await db.conversation.updateMany({ where: { id: conversationId, storeId: ctx.store.id }, data: { assignedToId: ctx.user.id } });
    if (r.count === 0) return fail("Conversation introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "conversation.assigned", target: conversationId, metadata: { assignedToId: ctx.user.id } });
    revalidateInbox(ctx.store.id);
    return success(undefined, "Conversation attribuée à vous");
  });
}

export async function setConversationStatus(storeId: string, conversationId: string, status: ConversationStatus): Promise<ActionResult> {
  return guard(async () => {
    if (!["OPEN", "PENDING", "CLOSED"].includes(status)) return fail("Statut invalide");
    const { ctx, error } = await inboxContext(storeId, "orders.manage");
    if (error) return error;
    const r = await db.conversation.updateMany({ where: { id: conversationId, storeId: ctx.store.id }, data: { status, ...(status === "CLOSED" ? { unreadCount: 0 } : {}) } });
    if (r.count === 0) return fail("Conversation introuvable");
    revalidateInbox(ctx.store.id);
    return success(undefined, status === "CLOSED" ? "Conversation fermée" : status === "PENDING" ? "Conversation mise en attente" : "Conversation rouverte");
  });
}

export async function setConversationStage(storeId: string, conversationId: string, stage: ConversationStage): Promise<ActionResult> {
  return guard(async () => {
    if (!STAGES.includes(stage)) return fail("Étape invalide");
    const { ctx, error } = await inboxContext(storeId, "orders.manage", "pipeline");
    if (error) return error;
    const r = await db.conversation.updateMany({ where: { id: conversationId, storeId: ctx.store.id }, data: { stage } });
    if (r.count === 0) return fail("Conversation introuvable");
    revalidateInbox(ctx.store.id);
    return success();
  });
}

/* ───────────── Étiquettes et valeur estimée ───────────── */

const labelSchema = z.string().trim().min(1).max(24);

export async function setConversationLabels(storeId: string, conversationId: string, labels: string[]): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z.array(labelSchema).max(MAX_LABELS, `${MAX_LABELS} étiquettes maximum`).safeParse(labels);
    if (!parsed.success) return fail("Étiquette invalide (24 caractères maximum, 8 étiquettes maximum)");
    const { ctx, error } = await inboxContext(storeId, "orders.manage");
    if (error) return error;
    const unique = Array.from(new Set(parsed.data.map((l) => l.toLowerCase())));
    const r = await db.conversation.updateMany({ where: { id: conversationId, storeId: ctx.store.id }, data: { labels: unique } });
    if (r.count === 0) return fail("Conversation introuvable");
    revalidateInbox(ctx.store.id);
    return success();
  });
}

const valueSchema = z.object({
  storeId: z.string().min(1),
  conversationId: z.string().min(1),
  estimatedValue: zOptionalString,
});

export async function setEstimatedValue(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(valueSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { ctx, error } = await inboxContext(parsed.data.storeId, "orders.manage", "pipeline");
    if (error) return error;
    let amount: number | null = null;
    if (parsed.data.estimatedValue) {
      amount = parseMoneyInput(parsed.data.estimatedValue, ctx.store.currency);
      if (amount == null || amount > 1_000_000_000) return fail("Montant invalide", { estimatedValue: ["Montant invalide"] });
    }
    const r = await db.conversation.updateMany({ where: { id: parsed.data.conversationId, storeId: ctx.store.id }, data: { estimatedValue: amount } });
    if (r.count === 0) return fail("Conversation introuvable");
    revalidateInbox(ctx.store.id);
    return success(undefined, "Valeur estimée enregistrée");
  });
}

/* ───────────── Nouvelle conversation ───────────── */

const startSchema = z.object({
  storeId: z.string().min(1),
  phone: z.string().trim().min(6, "Numéro requis").max(24),
  name: zOptionalString,
});

export async function startConversation(_prev: ActionResult<{ id: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return guard<{ id: string }>(async () => {
    const parsed = parseForm(startSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { ctx, error } = await inboxContext(parsed.data.storeId, "orders.manage");
    if (error) return error;
    const phone = normalizePhone(parsed.data.phone, getCountry(ctx.store.country).dialCode);
    if (!phone) return fail("Numéro invalide pour ce pays", { phone: ["Numéro invalide"] });
    const customer = await db.customer.findUnique({ where: { storeId_phone: { storeId: ctx.store.id, phone } }, select: { id: true, name: true } });
    const name = (parsed.data.name ?? "").trim().slice(0, 80) || customer?.name || `+${phone}`;
    const conversation = await db.$transaction((tx) => ensureConversation(tx, { storeId: ctx.store.id, phone, name, customerId: customer?.id }));
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "conversation.started", target: conversation.id });
    revalidateInbox(ctx.store.id);
    return success({ id: conversation.id }, "Conversation ouverte");
  });
}

/* ───────────── Réponses rapides ───────────── */

const quickReplySchema = z.object({
  storeId: z.string().min(1),
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .transform((s) => s.replace(/^\//, ""))
    .pipe(z.string().regex(/^[a-z0-9-]{2,24}$/, "2 à 24 caractères : lettres, chiffres, tirets")),
  body: z.string().trim().min(2, "Texte requis").max(1000, "1 000 caractères maximum"),
});

export async function saveQuickReply(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(quickReplySchema, formData);
    if ("error" in parsed) return parsed.error;
    const { ctx, error } = await inboxContext(parsed.data.storeId, "store.settings");
    if (error) return error;
    const count = await db.quickReply.count({ where: { storeId: ctx.store.id } });
    const exists = await db.quickReply.findUnique({ where: { storeId_shortcut: { storeId: ctx.store.id, shortcut: parsed.data.shortcut } }, select: { id: true } });
    if (!exists && count >= 100) return fail("100 réponses rapides maximum");
    await db.quickReply.upsert({
      where: { storeId_shortcut: { storeId: ctx.store.id, shortcut: parsed.data.shortcut } },
      create: { storeId: ctx.store.id, shortcut: parsed.data.shortcut, body: parsed.data.body },
      update: { body: parsed.data.body },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "quick_reply.saved", target: parsed.data.shortcut });
    revalidateInbox(ctx.store.id);
    return success(undefined, exists ? "Réponse rapide mise à jour" : "Réponse rapide ajoutée");
  });
}

export async function deleteQuickReply(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, error } = await inboxContext(storeId, "store.settings");
    if (error) return error;
    const r = await db.quickReply.deleteMany({ where: { id, storeId: ctx.store.id } });
    if (r.count === 0) return fail("Réponse rapide introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "quick_reply.deleted", target: id });
    revalidateInbox(ctx.store.id);
    return success(undefined, "Réponse rapide supprimée");
  });
}


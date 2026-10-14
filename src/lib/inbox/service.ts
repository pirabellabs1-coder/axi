import "server-only";
import type { CreditType, MessageStatus, Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { debitCredits, refundCredits } from "@/lib/credits";
import { truncate } from "@/lib/utils";

/**
 * Services de la boîte de réception (sans contrôle d'accès : les appelants l'ont déjà fait).
 *
 * Envoi sortant :
 *  - intégration `whatsapp_cloud` active → Message QUEUED + Notification whatsapp + job
 *    `notification.send`, crédits débités dans la même transaction (remboursés si l'envoi échoue) ;
 *  - sinon → Message LINK_ONLY : le marchand l'envoie lui-même via wa.me. Jamais présenté comme envoyé.
 *
 * Le worker d'envoi réel vers l'API Meta (src/lib/jobs.ts, hors périmètre) doit, après l'appel
 * API, renseigner `providerRef` puis appeler `recordOutboundStatus()`. Les statuts suivants
 * (distribué, lu, échec) arrivent par le webhook /api/webhooks/whatsapp.
 */

export class CreditError extends Error {}

export async function isWhatsappApiActive(storeId: string, client: Tx | typeof db = db): Promise<boolean> {
  const i = await client.integration.findUnique({ where: { storeId_kind: { storeId, kind: "whatsapp_cloud" } }, select: { status: true } });
  return i?.status === "active";
}

export function previewOf(body: string) {
  return truncate(body.replace(/\s+/g, " ").trim(), 120);
}

type QueueParams = {
  storeId: string;
  conversationId: string;
  phone: string;
  body: string;
  authorId: string | null;
  apiActive: boolean;
  creditType: CreditType;
  template: string;
  orderId?: string | null;
  campaignId?: string | null;
  /** false quand les crédits sont débités en bloc par l'appelant (campagne). */
  debitPerMessage?: boolean;
  /** Pièce jointe image : URL publique (stockage de la boutique) + type court ("image"). */
  attachmentUrl?: string | null;
  attachmentType?: string | null;
};

/** Crée un message sortant. À appeler dans une transaction. Lève CreditError si solde insuffisant. */
export async function queueOutboundMessage(tx: Tx, p: QueueParams) {
  const status: MessageStatus = p.apiActive ? "QUEUED" : "LINK_ONLY";
  const message = await tx.message.create({
    data: {
      conversationId: p.conversationId,
      direction: "OUTBOUND",
      body: p.body,
      status,
      authorId: p.authorId,
      orderId: p.orderId ?? null,
      attachmentUrl: p.attachmentUrl ?? null,
      attachmentType: p.attachmentType ?? null,
    },
  });
  if (p.apiActive) {
    if (p.debitPerMessage !== false) {
      const debit = await debitCredits(p.storeId, p.creditType, 1, `message:${message.id}`, tx);
      if (!debit.ok) throw new CreditError(debit.error);
    }
    await tx.notification.create({
      data: {
        storeId: p.storeId,
        channel: "whatsapp",
        recipient: p.phone,
        template: p.template,
        payload: {
          messageId: message.id,
          conversationId: p.conversationId,
          creditType: p.creditType,
          campaignId: p.campaignId ?? null,
          text: p.body,
          attachmentUrl: p.attachmentUrl ?? null,
          attachmentType: p.attachmentType ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  }
  const preview = p.body.trim() ? previewOf(p.body) : p.attachmentUrl ? "📷 Photo" : "";
  await tx.conversation.update({
    where: { id: p.conversationId },
    data: { lastMessageAt: message.createdAt, lastPreview: preview, status: "OPEN" },
  });
  return message;
}

/** Programme le vidage de la file des notifications (une fois par lot d'envois). */
export async function scheduleDispatch(storeId: string, tx: Tx) {
  await enqueue("notification.send", {}, { storeId }, tx);
}

/**
 * Envoie IMMÉDIATEMENT les notifications WhatsApp en file pour une boutique (appelé juste après une
 * réponse marchand, pour que le message parte sans attendre le worker/cron). À appeler APRÈS la
 * transaction. Non bloquant pour l'appelant : en cas d'aléa, la notification reste en file et le
 * worker la rejouera. Le job `notification.send` déjà programmé reste le filet de sécurité.
 */
export async function dispatchWhatsappNow(storeId: string): Promise<void> {
  const pending = await db.notification.findMany({
    where: { storeId, channel: "whatsapp", status: "QUEUED", attempts: { lt: 3 } },
    take: 20,
    orderBy: { createdAt: "asc" },
  });
  if (pending.length === 0) return;
  const { sendWhatsappText, sendWhatsappImage } = await import("@/lib/whatsapp/send");
  for (const n of pending) {
    const payload = (n.payload ?? {}) as { messageId?: string; text?: string; attachmentUrl?: string };
    const res = payload.attachmentUrl
      ? await sendWhatsappImage(storeId, n.recipient, payload.attachmentUrl, payload.text ?? "")
      : await sendWhatsappText(storeId, n.recipient, payload.text ?? "");
    if (res.ok) {
      if (payload.messageId) await recordOutboundStatus({ storeId, messageId: payload.messageId, providerRef: res.providerRef ?? undefined, status: "SENT" });
      await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } } });
    } else if (res.permanent || n.attempts + 1 >= 3) {
      if (payload.messageId) await recordOutboundStatus({ storeId, messageId: payload.messageId, status: "FAILED", error: res.error });
      await db.notification.update({ where: { id: n.id }, data: { status: "FAILED", attempts: { increment: 1 }, error: res.error.slice(0, 500) } });
    } else {
      // Aléa transitoire : reste QUEUED, le worker/cron rejouera.
      await db.notification.update({ where: { id: n.id }, data: { attempts: { increment: 1 }, error: res.error.slice(0, 500) } });
    }
  }
}

const RANK: Record<MessageStatus, number> = { LINK_ONLY: -1, RECEIVED: -1, QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

/**
 * Applique un statut de distribution (worker d'envoi ou webhook Meta). Ne rétrograde jamais.
 * Échec : remboursement du crédit + compteur d'échecs de la campagne. Premier envoi confirmé :
 * compteur d'envois de la campagne.
 */
export async function recordOutboundStatus(params: { storeId: string; messageId?: string; providerRef?: string; status: MessageStatus; error?: string | null }) {
  const message = await db.message.findFirst({
    where: {
      conversation: { storeId: params.storeId },
      direction: "OUTBOUND",
      ...(params.messageId ? { id: params.messageId } : { providerRef: params.providerRef ?? "__none__" }),
    },
  });
  if (!message) return { updated: false };
  const from = message.status;
  const to = params.status;
  if (from === "FAILED" || RANK[to] <= RANK[from]) return { updated: false };

  // Transition conditionnelle : si un autre appel a déjà changé le statut, on ne fait rien
  // (évite double remboursement / double comptage en cas de notifications concurrentes).
  const moved = await db.message.updateMany({
    where: { id: message.id, status: from },
    data: { status: to, error: to === "FAILED" ? (params.error ?? "Échec signalé par WhatsApp").slice(0, 500) : null, ...(params.providerRef ? { providerRef: params.providerRef } : {}) },
  });
  if (moved.count !== 1) return { updated: false };

  const firstConfirm = from === "QUEUED" && (to === "SENT" || to === "DELIVERED" || to === "READ");
  if (to === "FAILED" || firstConfirm) {
    const notif = await db.notification.findFirst({
      where: { storeId: params.storeId, channel: "whatsapp", payload: { path: ["messageId"], equals: message.id } },
      select: { payload: true },
    });
    const campaignId = (notif?.payload as { campaignId?: string | null } | null)?.campaignId ?? null;
    if (to === "FAILED") {
      // Seuls les messages réellement débités (QUEUED → …) sont remboursés.
      if (RANK[from] >= 0) await refundCredits(params.storeId, campaignId ? `campaign:${campaignId}` : `message:${message.id}`, 1);
      if (campaignId) await db.campaign.updateMany({ where: { id: campaignId, storeId: params.storeId }, data: { failedCount: { increment: 1 }, creditsUsed: { decrement: 1 } } });
    } else if (campaignId) {
      await db.campaign.updateMany({ where: { id: campaignId, storeId: params.storeId }, data: { sentCount: { increment: 1 } } });
    }
  }
  return { updated: true };
}

/** Message entrant (webhook). Crée ou rouvre la conversation, rattache le client par téléphone. */
export async function recordInboundMessage(params: { storeId: string; phone: string; name?: string | null; body: string; providerRef: string; at: Date }) {
  const phone = params.phone.replace(/\D/g, "");
  return db.$transaction(async (tx) => {
    const dup = await tx.message.findFirst({ where: { providerRef: params.providerRef, conversation: { storeId: params.storeId } }, select: { id: true } });
    if (dup) return { duplicate: true as const };
    const customer = await tx.customer.findUnique({ where: { storeId_phone: { storeId: params.storeId, phone } }, select: { id: true, name: true } });
    const name = (customer?.name ?? params.name ?? "").trim() || `+${phone}`;
    const conversation = await tx.conversation.upsert({
      where: { storeId_phone_channel: { storeId: params.storeId, phone, channel: "whatsapp" } },
      create: { storeId: params.storeId, phone, name, customerId: customer?.id ?? null, unreadCount: 1, lastMessageAt: params.at, lastPreview: previewOf(params.body) },
      update: {
        unreadCount: { increment: 1 },
        lastMessageAt: params.at,
        lastPreview: previewOf(params.body),
        status: "OPEN",
        ...(customer ? { customerId: customer.id } : {}),
      },
    });
    const message = await tx.message.create({
      data: { conversationId: conversation.id, direction: "INBOUND", body: params.body, status: "RECEIVED", providerRef: params.providerRef, createdAt: params.at },
    });
    return { duplicate: false as const, conversationId: conversation.id, messageId: message.id };
  });
}

/** Ouvre (ou retrouve) la conversation d'un numéro. */
export async function ensureConversation(tx: Tx, params: { storeId: string; phone: string; name: string; customerId?: string | null }) {
  return tx.conversation.upsert({
    where: { storeId_phone_channel: { storeId: params.storeId, phone: params.phone, channel: "whatsapp" } },
    create: { storeId: params.storeId, phone: params.phone, name: params.name, customerId: params.customerId ?? null },
    update: params.customerId ? { customerId: params.customerId } : {},
  });
}

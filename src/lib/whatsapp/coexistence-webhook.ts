import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { previewOf } from "@/lib/inbox/service";
import { bodyOf, dateOf, type WaMessage } from "./webhook-message";

/**
 * Webhooks du mode COEXISTENCE (app WhatsApp Business + Cloud API sur le même numéro).
 *
 * Champs abonnés côté Meta :
 *  - `smb_message_echoes`  : messages envoyés par le marchand DEPUIS SON TÉLÉPHONE → messages SORTANTS dans la
 *    conversation du client (statut SENT). Rien n'est renvoyé, aucun crédit débité (envoyés par l'app = gratuits).
 *  - `history`             : historique importé (jusqu'à 6 mois) → messages anciens, entrants ou sortants, sans
 *    incrémenter les non-lus.
 *  - `smb_app_state_sync`  : carnet de contacts de l'app → client créé (ou nommé s'il n'a qu'un nom provisoire).
 *
 * Idempotence : ProviderEvent pour les échos (comme les messages entrants), et dans tous les cas contrôle par
 * `Message.providerRef` (id Meta) dans la transaction. Ces traitements ne lèvent JAMAIS : une erreur est
 * journalisée, le webhook répond 200 (Meta ne doit pas désactiver l'abonnement pour une donnée d'import).
 */

export const COEXISTENCE_FIELDS = ["smb_message_echoes", "history", "smb_app_state_sync"] as const;
export type CoexistenceField = (typeof COEXISTENCE_FIELDS)[number];

export function isCoexistenceField(field: string | undefined): field is CoexistenceField {
  return !!field && (COEXISTENCE_FIELDS as readonly string[]).includes(field);
}

export type CoexistenceValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  message_echoes?: WaMessage[];
  history?: {
    metadata?: { phase?: number; chunk_order?: number; progress?: number };
    threads?: { id?: string; messages?: WaMessage[] }[];
    errors?: { code?: number; title?: string; message?: string }[];
  }[];
  state_sync?: {
    type?: string;
    action?: string;
    contact?: { full_name?: string; first_name?: string; phone_number?: string };
  }[];
};

const digits = (v: string | undefined | null) => (v ?? "").replace(/\D/g, "");
const isPhone = (p: string) => /^\d{6,20}$/.test(p);

/** Enregistre l'événement Meta ; false si déjà traité (idempotence). */
export async function claimWhatsappEvent(eventId: string, type: string, payload: unknown): Promise<boolean> {
  try {
    await db.providerEvent.create({
      data: { provider: "whatsapp", eventId: eventId.slice(0, 190), type, payload: payload as Prisma.InputJsonValue, signatureValid: true, processedAt: new Date() },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

export async function releaseWhatsappEvent(eventId: string) {
  await db.providerEvent.deleteMany({ where: { provider: "whatsapp", eventId: eventId.slice(0, 190) } });
}

/**
 * Message synchronisé (écho du téléphone ou historique). Idempotent par id Meta. Ne crée ni Notification ni
 * débit de crédits : le message est déjà parti (ou reçu) via l'app WhatsApp Business.
 */
export async function recordSyncedMessage(params: {
  storeId: string;
  phone: string;
  name?: string | null;
  body: string;
  providerRef: string;
  at: Date;
  direction: "INBOUND" | "OUTBOUND";
  /** Écho en direct : le marchand a répondu depuis son téléphone → conversation lue. */
  markRead?: boolean;
}): Promise<{ duplicate: boolean }> {
  const phone = digits(params.phone);
  return db.$transaction(async (tx) => {
    const dup = await tx.message.findFirst({ where: { providerRef: params.providerRef, conversation: { storeId: params.storeId } }, select: { id: true } });
    if (dup) return { duplicate: true };
    const customer = await tx.customer.findUnique({ where: { storeId_phone: { storeId: params.storeId, phone } }, select: { id: true, name: true } });
    const name = (customer?.name ?? params.name ?? "").trim() || `+${phone}`;
    const conversation = await tx.conversation.upsert({
      where: { storeId_phone_channel: { storeId: params.storeId, phone, channel: "whatsapp" } },
      create: { storeId: params.storeId, phone, name, customerId: customer?.id ?? null, lastMessageAt: params.at, lastPreview: previewOf(params.body) },
      update: customer ? { customerId: customer.id } : {},
    });
    // Un message ancien (historique) ne doit pas remonter la conversation ni écraser l'aperçu plus récent.
    if (conversation.lastMessageAt <= params.at || params.markRead) {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          ...(conversation.lastMessageAt <= params.at ? { lastMessageAt: params.at, lastPreview: previewOf(params.body) } : {}),
          ...(params.markRead ? { unreadCount: 0, status: "OPEN" as const } : {}),
        },
      });
    }
    await tx.message.create({
      data: {
        conversationId: conversation.id,
        direction: params.direction,
        body: params.body,
        status: params.direction === "OUTBOUND" ? "SENT" : "RECEIVED",
        providerRef: params.providerRef,
        createdAt: params.at,
      },
    });
    return { duplicate: false };
  });
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * Bornes du traitement synchrone d'un `change` (réponse rapide à Meta). Au-delà, le reste est journalisé et
 * ignoré : l'ajout d'un job d'import différé exigerait un nouveau JobType dans src/lib/jobs.ts (hors accord).
 */
export const HISTORY_LIMITS = { maxMessages: 500, maxThreads: 200 } as const;

/** Enregistre un message synchronisé sous protection ProviderEvent (libéré en cas d'erreur). Ne lève pas. */
async function claimAndRecord(eventId: string, type: string, m: WaMessage, params: Parameters<typeof recordSyncedMessage>[0]): Promise<boolean> {
  if (!(await claimWhatsappEvent(eventId, type, m))) return false;
  try {
    const r = await recordSyncedMessage(params);
    return !r.duplicate;
  } catch (e) {
    await releaseWhatsappEvent(eventId).catch(() => undefined);
    console.error(`[whatsapp] ${type} non enregistré`, (e as Error).message);
    return false;
  }
}

/** Échos : messages envoyés par le marchand depuis l'app WhatsApp Business. */
async function handleEchoes(storeId: string, value: CoexistenceValue): Promise<number> {
  let processed = 0;
  for (const m of arr<WaMessage>(value.message_echoes).slice(0, HISTORY_LIMITS.maxMessages)) {
    const id = str(m?.id);
    const to = digits(str(m?.to));
    if (!id || !isPhone(to)) continue;
    const ok = await claimAndRecord(id, `echo.${str(m.type) ?? "unknown"}`, m, {
      storeId,
      phone: to,
      body: bodyOf(m),
      providerRef: id,
      at: dateOf(m.timestamp),
      direction: "OUTBOUND",
      markRead: true,
    });
    if (ok) processed++;
  }
  return processed;
}

/** Historique : messages des 6 derniers mois, par fil (id du fil = numéro du client). Traitement borné. */
async function handleHistory(storeId: string, value: CoexistenceValue): Promise<number> {
  let processed = 0;
  let budget = HISTORY_LIMITS.maxMessages;
  let threadsLeft = HISTORY_LIMITS.maxThreads;
  let skipped = 0;
  for (const chunk of arr<NonNullable<CoexistenceValue["history"]>[number]>(value.history)) {
    const errors = arr<{ code?: number; title?: string; message?: string }>(chunk?.errors);
    if (errors.length) {
      const err = errors[0];
      // Ex. : le marchand a refusé de partager son historique dans l'app. Tracé pour affichage.
      await markHistoryFailed(storeId, [str(err?.title), str(err?.message)].filter(Boolean).join(" : ") || `code ${typeof err?.code === "number" ? err.code : "?"}`);
      continue;
    }
    for (const thread of arr<{ id?: string; messages?: unknown }>(chunk?.threads)) {
      const messages = arr<WaMessage>(thread?.messages);
      if (threadsLeft <= 0 || budget <= 0) {
        skipped += messages.length;
        continue;
      }
      threadsLeft--;
      const customer = digits(str(thread?.id));
      if (!isPhone(customer)) continue;
      for (const m of messages) {
        if (budget <= 0) {
          skipped++;
          continue;
        }
        const id = str(m?.id);
        if (!id) continue;
        budget--;
        const from = digits(str(m.from));
        const ok = await claimAndRecord(`hist:${id}`, "history.message", m, {
          storeId,
          phone: customer,
          body: bodyOf(m),
          providerRef: id,
          at: dateOf(m.timestamp),
          direction: from && from !== customer ? "OUTBOUND" : "INBOUND",
        });
        if (ok) processed++;
      }
    }
  }
  if (skipped > 0) console.warn(`[whatsapp] history : ${skipped} message(s) ignoré(s) au-delà des limites (boutique ${storeId})`);
  return processed;
}

async function markHistoryFailed(storeId: string, reason: string) {
  const integ = await db.integration.findUnique({ where: { storeId_kind: { storeId, kind: "whatsapp_cloud" } }, select: { config: true } });
  const config = (integ?.config ?? {}) as Record<string, unknown>;
  const coexistence = (config.coexistence ?? {}) as Record<string, unknown>;
  await db.integration.update({
    where: { storeId_kind: { storeId, kind: "whatsapp_cloud" } },
    data: { config: { ...config, coexistence: { ...coexistence, historySync: `failed:${reason.slice(0, 200)}` } } as Prisma.InputJsonValue },
  });
}

/** Contacts de l'app : crée le client, ou remplace un nom provisoire (« +229… »). Les suppressions sont ignorées. */
async function handleStateSync(storeId: string, value: CoexistenceValue): Promise<number> {
  let processed = 0;
  for (const s of arr<NonNullable<CoexistenceValue["state_sync"]>[number]>(value.state_sync).slice(0, HISTORY_LIMITS.maxMessages)) {
    if (s?.type !== "contact" || s.action !== "add") continue;
    const phone = digits(str(s.contact?.phone_number));
    const name = (str(s.contact?.full_name) ?? str(s.contact?.first_name) ?? "").trim().slice(0, 80);
    if (!isPhone(phone) || !name) continue;
    try {
      const placeholder = [`+${phone}`, phone, ""];
      const existing = await db.customer.findUnique({ where: { storeId_phone: { storeId, phone } }, select: { id: true, name: true } });
      if (!existing) {
        await db.customer.create({ data: { storeId, phone, name } });
      } else if (placeholder.includes(existing.name.trim())) {
        await db.customer.update({ where: { id: existing.id }, data: { name } });
      }
      // Conversation au nom provisoire : on lui donne le nom du carnet.
      await db.conversation.updateMany({ where: { storeId, phone, channel: "whatsapp", name: { in: placeholder } }, data: { name } });
      processed++;
    } catch (e) {
      console.error("[whatsapp] contact coexistence non synchronisé", (e as Error).message);
    }
  }
  return processed;
}

/** Point d'entrée du webhook pour un `change` coexistence. Ne lève jamais. */
export async function handleCoexistenceChange(storeId: string, field: CoexistenceField, value: CoexistenceValue): Promise<number> {
  try {
    if (field === "smb_message_echoes") return await handleEchoes(storeId, value);
    if (field === "history") return await handleHistory(storeId, value);
    return await handleStateSync(storeId, value);
  } catch (e) {
    console.error(`[whatsapp] ${field} : traitement interrompu`, (e as Error).message);
    return 0;
  }
}

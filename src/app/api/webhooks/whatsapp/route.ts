import type { MessageStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { hmacSha256, isPlaceholderSecret, safeEqual } from "@/lib/crypto";
import { recordInboundMessage, recordOutboundStatus } from "@/lib/inbox/service";
import { handleCatalogOrderMessage } from "@/lib/social/whatsapp-order";
import { bodyOf, dateOf, type WaMessage } from "@/lib/whatsapp/webhook-message";
import {
  claimWhatsappEvent,
  releaseWhatsappEvent,
  handleCoexistenceChange,
  isCoexistenceField,
  type CoexistenceValue,
} from "@/lib/whatsapp/coexistence-webhook";

export const dynamic = "force-dynamic";

const MAX_BODY = 1_000_000; // 1 Mo

/**
 * Webhook WhatsApp Cloud API (Meta).
 *  - GET  : vérification de l'abonnement (hub.challenge) avec WHATSAPP_VERIFY_TOKEN.
 *  - POST : notifications signées (x-hub-signature-256 = HMAC-SHA256 du corps brut avec WHATSAPP_APP_SECRET).
 * La boutique est retrouvée via la colonne UNIQUE Integration.phoneNumberId, intégrations ACTIVES
 * uniquement (une intégration « pending » n'a pas été validée par la plateforme : M2).
 * Idempotence : ProviderEvent(provider = "whatsapp", eventId = id Meta [+ statut]) unique.
 * Coexistence (app WhatsApp Business + API) : champs `smb_message_echoes`, `history`, `smb_app_state_sync`
 * traités par src/lib/whatsapp/coexistence-webhook.ts, sans jamais faire échouer la réponse.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  if (mode === "subscribe" && expected && safeEqual(token, expected) && /^[\w-]{1,128}$/.test(challenge)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response("Forbidden", { status: 403 });
}

type WaValue = CoexistenceValue & {
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
  statuses?: { id?: string; status?: string; recipient_id?: string; errors?: { title?: string; message?: string }[] }[];
};

const STATUS_MAP: Record<string, MessageStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

/** Tableau ou [] : une charge utile inattendue ne doit jamais faire lever le webhook (pas de 500 en boucle). */
const arr = <T,>(v: T[] | undefined | unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const claimEvent = claimWhatsappEvent;
const releaseEvent = releaseWhatsappEvent;

const storeCache = new Map<string, { storeId: string | null; at: number }>();
async function storeForPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const hit = storeCache.get(phoneNumberId);
  if (hit && Date.now() - hit.at < 60_000) return hit.storeId;
  if (!/^\d{5,32}$/.test(phoneNumberId)) return null;
  const integration = await db.integration.findUnique({ where: { phoneNumberId }, select: { storeId: true, kind: true, status: true } });
  const storeId = integration && integration.kind === "whatsapp_cloud" && integration.status === "active" ? integration.storeId : null;
  // Seuls les numéros connus sont mis en cache : un numéro tout juste connecté (synchros coexistence lancées
  // juste après l'activation) ne doit pas rester « inconnu » 60 s. Les appels sont signés : pas d'abus possible.
  if (storeId) storeCache.set(phoneNumberId, { storeId, at: Date.now() });
  return storeId;
}

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  // Secret absent ou resté sur une valeur d'exemple : la signature serait forgeable, on refuse.
  if (!secret || isPlaceholderSecret(secret)) return new Response("Webhook non configuré", { status: 503 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return new Response("Payload Too Large", { status: 413 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > MAX_BODY) return new Response("Payload Too Large", { status: 413 });

  // Signature calculée sur les octets bruts reçus
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${hmacSha256(secret, bytes)}`;
  const raw = bytes.toString("utf8");
  if (!signature || !safeEqual(signature, expected)) return new Response("Invalid signature", { status: 401 });

  let body: { object?: string; entry?: { changes?: { field?: string; value?: WaValue }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (body.object !== "whatsapp_business_account") return new Response("ignored", { status: 200 });

  let processed = 0;
  for (const entry of arr<{ changes?: unknown }>(body.entry)) {
    for (const change of arr<{ field?: string; value?: WaValue }>(entry?.changes)) {
      const value = change?.value && typeof change.value === "object" ? change.value : undefined;
      const phoneNumberId = str(value?.metadata?.phone_number_id);
      if (!value || !phoneNumberId) continue;
      const storeId = await storeForPhoneNumberId(phoneNumberId);
      if (!storeId) continue;

      if (isCoexistenceField(change.field)) {
        processed += await handleCoexistenceChange(storeId, change.field, value);
        continue;
      }

      for (const m of arr<WaMessage>(value.messages)) {
        const id = str(m?.id);
        const from = str(m?.from);
        if (!id || !from) continue;
        if (!(await claimEvent(id, `message.${str(m.type) ?? "unknown"}`, m))) continue;
        const contact = arr<{ wa_id?: string; profile?: { name?: string } }>(value.contacts).find((c) => c?.wa_id === from);
        try {
          await recordInboundMessage({
            storeId,
            phone: from,
            name: str(contact?.profile?.name)?.slice(0, 80) ?? null,
            body: bodyOf(m),
            providerRef: id,
            at: dateOf(m.timestamp),
          });
        } catch (e) {
          // Libère l'événement : Meta le renverra (réponse non 2xx) et il sera retraité.
          await releaseEvent(id);
          throw e;
        }
        processed++;
        // Panier du catalogue (Meta Business Agent, catalogue WhatsApp) : lien de panier Axi en réponse. Jamais bloquant.
        if (m.type === "order") await handleCatalogOrderMessage({ storeId, phone: from, messageId: id, order: m.order }).catch((e) => console.error("[whatsapp] panier catalogue", (e as Error).message));
      }

      for (const s of arr<NonNullable<WaValue["statuses"]>[number]>(value.statuses)) {
        const status = str(s?.status) && Object.prototype.hasOwnProperty.call(STATUS_MAP, s.status!) ? STATUS_MAP[s.status!] : undefined;
        if (!str(s?.id) || !status) continue;
        const eventId = `${s.id}:${s.status}`;
        if (!(await claimEvent(eventId, `status.${s.status}`, s))) continue;
        const err = arr<{ title?: string; message?: string }>(s.errors)[0];
        try {
          const r = await recordOutboundStatus({ storeId, providerRef: s.id!, status, error: err ? [str(err.title), str(err.message)].filter(Boolean).join(" : ") || null : null });
          // Message pas (encore) relié à cet id Meta : l'événement n'est pas marqué comme traité.
          if (!r.updated) await releaseEvent(eventId);
        } catch (e) {
          await releaseEvent(eventId);
          throw e;
        }
        processed++;
      }
    }
  }
  return new Response(`ok ${processed}`, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

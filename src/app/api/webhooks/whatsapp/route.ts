import { Prisma, type MessageStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { hmacSha256, isPlaceholderSecret, safeEqual } from "@/lib/crypto";
import { recordInboundMessage, recordOutboundStatus } from "@/lib/inbox/service";
import { catalogOrderSummary, handleCatalogOrderMessage } from "@/lib/social/whatsapp-order";

export const dynamic = "force-dynamic";

const MAX_BODY = 1_000_000; // 1 Mo

/**
 * Webhook WhatsApp Cloud API (Meta).
 *  - GET  : vérification de l'abonnement (hub.challenge) avec WHATSAPP_VERIFY_TOKEN.
 *  - POST : notifications signées (x-hub-signature-256 = HMAC-SHA256 du corps brut avec WHATSAPP_APP_SECRET).
 * La boutique est retrouvée via la colonne UNIQUE Integration.phoneNumberId, intégrations ACTIVES
 * uniquement (une intégration « pending » n'a pas été validée par la plateforme : M2).
 * Idempotence : ProviderEvent(provider = "whatsapp", eventId = id Meta [+ statut]) unique.
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

type WaValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
  statuses?: { id?: string; status?: string; recipient_id?: string; errors?: { title?: string; message?: string }[] }[];
};
type WaMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  location?: { name?: string; address?: string };
  order?: unknown; // panier du catalogue WhatsApp (lot 1 bis, src/lib/social/whatsapp-order.ts)
};

const MEDIA_LABELS: Record<string, string> = {
  image: "Photo reçue",
  video: "Vidéo reçue",
  audio: "Message vocal reçu",
  voice: "Message vocal reçu",
  document: "Document reçu",
  sticker: "Autocollant reçu",
  location: "Position partagée",
  contacts: "Contact partagé",
  reaction: "Réaction",
};

function bodyOf(m: WaMessage): string {
  if (m.type === "order") return catalogOrderSummary(m.order);
  const text =
    m.text?.body ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    m.image?.caption ??
    m.video?.caption ??
    m.document?.caption ??
    (m.location ? [m.location.name, m.location.address].filter(Boolean).join(", ") : undefined);
  const label = MEDIA_LABELS[m.type ?? ""];
  if (text && label && m.type !== "text") return `[${label}] ${text}`.slice(0, 4000);
  return (text ?? (label ? `[${label}]` : "[Message non pris en charge]")).slice(0, 4000);
}

const STATUS_MAP: Record<string, MessageStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

/** Enregistre l'événement ; false si déjà traité (idempotence). */
async function claimEvent(eventId: string, type: string, payload: unknown): Promise<boolean> {
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

async function releaseEvent(eventId: string) {
  await db.providerEvent.deleteMany({ where: { provider: "whatsapp", eventId: eventId.slice(0, 190) } });
}

const storeCache = new Map<string, { storeId: string | null; at: number }>();
async function storeForPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const hit = storeCache.get(phoneNumberId);
  if (hit && Date.now() - hit.at < 60_000) return hit.storeId;
  if (!/^\d{5,32}$/.test(phoneNumberId)) return null;
  const integration = await db.integration.findUnique({ where: { phoneNumberId }, select: { storeId: true, kind: true, status: true } });
  const storeId = integration && integration.kind === "whatsapp_cloud" && integration.status === "active" ? integration.storeId : null;
  storeCache.set(phoneNumberId, { storeId, at: Date.now() });
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
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!value || !phoneNumberId) continue;
      const storeId = await storeForPhoneNumberId(phoneNumberId);
      if (!storeId) continue;

      for (const m of value.messages ?? []) {
        if (!m.id || !m.from) continue;
        if (!(await claimEvent(m.id, `message.${m.type ?? "unknown"}`, m))) continue;
        const contact = value.contacts?.find((c) => c.wa_id === m.from);
        const ts = Number(m.timestamp);
        try {
          await recordInboundMessage({
            storeId,
            phone: m.from,
            name: contact?.profile?.name?.slice(0, 80) ?? null,
            body: bodyOf(m),
            providerRef: m.id,
            at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
          });
        } catch (e) {
          // Libère l'événement : Meta le renverra (réponse non 2xx) et il sera retraité.
          await releaseEvent(m.id);
          throw e;
        }
        processed++;
        // Panier du catalogue (Meta Business Agent, catalogue WhatsApp) : lien de panier Axi en réponse. Jamais bloquant.
        if (m.type === "order") await handleCatalogOrderMessage({ storeId, phone: m.from, messageId: m.id, order: m.order }).catch((e) => console.error("[whatsapp] panier catalogue", (e as Error).message));
      }

      for (const s of value.statuses ?? []) {
        const status = s.status ? STATUS_MAP[s.status] : undefined;
        if (!s.id || !status) continue;
        const eventId = `${s.id}:${s.status}`;
        if (!(await claimEvent(eventId, `status.${s.status}`, s))) continue;
        const err = s.errors?.[0];
        try {
          const r = await recordOutboundStatus({ storeId, providerRef: s.id, status, error: err ? [err.title, err.message].filter(Boolean).join(" : ") : null });
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

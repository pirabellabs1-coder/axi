import "server-only";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { GRAPH_VERSION } from "@/lib/social/graph-client";

export type WaSendResult =
  | { ok: true; providerRef: string | null }
  | { ok: false; error: string; permanent: boolean };

type WaCreds = { phoneNumberId: string; token: string };

/** Charge l'intégration WhatsApp Cloud ACTIVE de la boutique et déchiffre le jeton (jamais journalisé). */
async function loadCreds(storeId: string): Promise<WaCreds | { error: string }> {
  const i = await db.integration.findUnique({
    where: { storeId_kind: { storeId, kind: "whatsapp_cloud" } },
    select: { status: true, phoneNumberId: true, secretsEncrypted: true },
  });
  if (!i || i.status !== "active" || !i.phoneNumberId || !i.secretsEncrypted) return { error: "Intégration WhatsApp Cloud inactive" };
  try {
    const parsed = JSON.parse(decryptSecret(i.secretsEncrypted)) as { token?: unknown };
    if (typeof parsed.token !== "string" || !parsed.token) return { error: "Jeton WhatsApp absent" };
    return { phoneNumberId: i.phoneNumberId, token: parsed.token };
  } catch {
    return { error: "Jeton WhatsApp illisible" };
  }
}

/** Appel Graph `/{phoneNumberId}/messages` commun aux messages texte et image. */
async function postMessage(creds: WaCreds, payload: Record<string, unknown>): Promise<WaSendResult> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneNumberId}/messages`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { ok: false, error: `Réseau : ${(e as Error).message}`.slice(0, 300), permanent: false };
  }
  const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
  if (res.ok && data.messages?.[0]?.id) return { ok: true, providerRef: data.messages[0].id };
  const error = (data.error?.message ?? `HTTP ${res.status}`).slice(0, 300);
  const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
  return { ok: false, error, permanent };
}

/** Message texte (fenêtre de service de 24 h). */
export async function sendWhatsappText(storeId: string, to: string, body: string): Promise<WaSendResult> {
  const creds = await loadCreds(storeId);
  if ("error" in creds) return { ok: false, error: creds.error, permanent: true };
  return postMessage(creds, { to, type: "text", text: { preview_url: false, body } });
}

/** Message image par URL publique (le lien doit être accessible depuis les serveurs Meta). */
export async function sendWhatsappImage(storeId: string, to: string, link: string, caption?: string): Promise<WaSendResult> {
  const creds = await loadCreds(storeId);
  if ("error" in creds) return { ok: false, error: creds.error, permanent: true };
  const image: Record<string, string> = { link };
  if (caption && caption.trim()) image.caption = caption.trim();
  return postMessage(creds, { to, type: "image", image });
}

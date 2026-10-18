import { readBodyLimited } from "@/lib/tiktok-shop/body";
import { handleTiktokWebhook, MAX_WEBHOOK_BODY } from "@/lib/tiktok-shop/webhook";

export const dynamic = "force-dynamic";

/**
 * Webhook TikTok Shop (URL déclarée dans le Partner Center, rubrique « Webhooks »).
 * Signature vérifiée sur les octets bruts ; voir src/lib/tiktok-shop/webhook.ts.
 */
export async function POST(req: Request) {
  const rawBody = await readBodyLimited(req, MAX_WEBHOOK_BODY);
  if (!rawBody) return new Response("Payload Too Large", { status: 413 });
  const r = await handleTiktokWebhook({ rawBody, authorization: req.headers.get("authorization") });
  return new Response(r.body, { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

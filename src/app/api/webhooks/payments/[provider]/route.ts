import { handleGatewayWebhook } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

const MAX_BODY = 1_000_000; // 1 Mo

/** Webhook passerelle : signature vérifiée et idempotence gérées par handleGatewayWebhook (corps brut requis). */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!/^[a-z0-9_-]{2,32}$/i.test(provider)) return new Response("unknown provider", { status: 404 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return new Response("Payload Too Large", { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response("Payload Too Large", { status: 413 });
  const r = await handleGatewayWebhook(provider, raw, req.headers);
  return new Response(r.body, { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

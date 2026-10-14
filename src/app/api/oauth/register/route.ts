import { normalizeIp, rateLimit } from "@/lib/rate-limit";
import { OAuthError, registerClient } from "@/lib/mcp/oauth";
import { CORS_HEADERS } from "@/lib/mcp/http";
import { getMcpKillSwitch } from "@/lib/mcp/runtime";

export const dynamic = "force-dynamic";

const H = { ...CORS_HEADERS, "Cache-Control": "no-store" };

/** Enregistrement dynamique de client OAuth (RFC 7591). Public, limité par IP. */
export async function POST(req: Request) {
  if ((await getMcpKillSwitch()).enabled) return Response.json({ error: "temporarily_unavailable", error_description: "AI connections are temporarily disabled." }, { status: 503, headers: H });
  const ip = normalizeIp(req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"));
  const rl = await rateLimit(`oauth:register:ip:${ip}`, 20, 3600);
  if (!rl.ok) return Response.json({ error: "slow_down", error_description: "Too many registrations." }, { status: 429, headers: { ...H, "Retry-After": String(rl.retryAfter) } });
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 20_000) throw new Error("too large");
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "Invalid JSON body." }, { status: 400, headers: H });
  }
  try {
    return Response.json(await registerClient(body), { status: 201, headers: H });
  } catch (e) {
    if (e instanceof OAuthError) return Response.json({ error: e.error, error_description: e.description }, { status: e.status, headers: H });
    console.error("[oauth/register]", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: H });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

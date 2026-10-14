import { normalizeIp, rateLimit } from "@/lib/rate-limit";
import { clientCredentials, OAuthError, revokeToken } from "@/lib/mcp/oauth";
import { CORS_HEADERS } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

const H = { ...CORS_HEADERS, "Cache-Control": "no-store" };

/** Révocation de jeton (RFC 7009) : 200 que le jeton existe ou non. */
export async function POST(req: Request) {
  const ip = normalizeIp(req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"));
  const rl = await rateLimit(`oauth:revoke:ip:${ip}`, 60, 60);
  if (!rl.ok) return Response.json({ error: "slow_down" }, { status: 429, headers: { ...H, "Retry-After": String(rl.retryAfter) } });
  let form: URLSearchParams;
  try {
    const text = await req.text();
    if (text.length > 20_000) throw new Error("too large");
    form = (req.headers.get("content-type") ?? "").includes("application/json") ? new URLSearchParams(Object.entries(JSON.parse(text) as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : new URLSearchParams(text);
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: H });
  }
  try {
    await revokeToken(form, clientCredentials(form, req.headers.get("authorization")));
    return new Response(null, { status: 200, headers: H });
  } catch (e) {
    if (e instanceof OAuthError) return Response.json({ error: e.error, error_description: e.description }, { status: e.status, headers: H });
    console.error("[oauth/revoke]", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: H });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

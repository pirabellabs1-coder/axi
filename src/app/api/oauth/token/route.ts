import { normalizeIp, rateLimit } from "@/lib/rate-limit";
import { clientCredentials, exchangeAuthorizationCode, OAuthError, refreshAccessToken } from "@/lib/mcp/oauth";
import { CORS_HEADERS } from "@/lib/mcp/http";
import { getMcpKillSwitch } from "@/lib/mcp/runtime";

export const dynamic = "force-dynamic";

const H = { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache" };

function error(e: OAuthError) {
  const headers: Record<string, string> = { ...H };
  if (e.status === 401) headers["WWW-Authenticate"] = 'Basic realm="axi"';
  return Response.json({ error: e.error, error_description: e.description }, { status: e.status, headers });
}

/** Point de jeton OAuth 2.1 : authorization_code (+ PKCE S256) et refresh_token (rotation). */
export async function POST(req: Request) {
  if ((await getMcpKillSwitch()).enabled) return Response.json({ error: "temporarily_unavailable", error_description: "AI connections are temporarily disabled." }, { status: 503, headers: H });
  const ip = normalizeIp(req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"));
  const rl = await rateLimit(`oauth:token:ip:${ip}`, 60, 60);
  if (!rl.ok) return Response.json({ error: "slow_down", error_description: "Too many requests." }, { status: 429, headers: { ...H, "Retry-After": String(rl.retryAfter) } });

  let form: URLSearchParams;
  try {
    const type = (req.headers.get("content-type") ?? "").toLowerCase();
    const text = await req.text();
    if (text.length > 20_000) throw new Error("too large");
    form = type.includes("application/json") ? new URLSearchParams(Object.entries(JSON.parse(text) as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : new URLSearchParams(text);
  } catch {
    return error(new OAuthError("invalid_request", "Unreadable request body (use application/x-www-form-urlencoded)."));
  }
  const creds = clientCredentials(form, req.headers.get("authorization"));
  try {
    const grant = form.get("grant_type");
    if (grant === "authorization_code") return Response.json(await exchangeAuthorizationCode(form, creds), { headers: H });
    if (grant === "refresh_token") return Response.json(await refreshAccessToken(form, creds), { headers: H });
    return error(new OAuthError("unsupported_grant_type", "Supported grant types: authorization_code, refresh_token."));
  } catch (e) {
    if (e instanceof OAuthError) return error(e);
    console.error("[oauth/token]", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: H });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

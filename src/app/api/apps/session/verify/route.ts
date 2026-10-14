import { db } from "@/lib/db";
import { normalizeIp, rateLimit } from "@/lib/rate-limit";
import { clientCredentials } from "@/lib/mcp/oauth";
import { verifyToken } from "@/lib/mcp/tokens";
import { effectiveScopes } from "@/lib/mcp/scopes";
import { effectivePlanId } from "@/lib/billing/rules";
import { verifySessionToken } from "@/lib/apps/session-token";

export const dynamic = "force-dynamic";

/**
 * POST /api/apps/session/verify — validation d'un jeton de session d'app embarquée (contrat docs/apps-v2/int.md §5).
 *
 * Authentification : client_id + client_secret de l'app (corps ou en-tête Basic), comme sur /api/oauth/token.
 * Corps : `token` (ou `session`), en application/x-www-form-urlencoded ou JSON.
 * Succès 200 : { active: true, shop, storeId, userId, appId, scopes, exp, iat }.
 * Refus : 401 invalid_client (identifiants), 400 invalid_request (corps), 401 invalid_token (jeton faux, expiré,
 * d'une autre app, ou app plus installée / membre retiré). Appel serveur à serveur uniquement (pas de CORS).
 */

const H = { "Cache-Control": "no-store", Pragma: "no-cache" };

function err(status: number, error: string, description: string, extra: Record<string, string> = {}) {
  return Response.json({ error, error_description: description }, { status, headers: { ...H, ...extra } });
}

export async function POST(req: Request) {
  const ip = normalizeIp(req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"));
  const rl = await rateLimit(`apps:session:ip:${ip}`, 120, 60);
  if (!rl.ok) return err(429, "slow_down", "Too many requests.", { "Retry-After": String(rl.retryAfter) });

  let form: URLSearchParams;
  try {
    const type = (req.headers.get("content-type") ?? "").toLowerCase();
    const text = await req.text();
    if (text.length > 8_000) throw new Error("too large");
    form = type.includes("application/json")
      ? new URLSearchParams(Object.entries(JSON.parse(text) as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : new URLSearchParams(text);
  } catch {
    return err(400, "invalid_request", "Unreadable request body (use JSON or application/x-www-form-urlencoded).");
  }

  // Authentification du client : confidentiel obligatoire (le secret prouve l'identité de l'app).
  const creds = clientCredentials(form, req.headers.get("authorization"));
  const client = creds.clientId ? await db.oAuthClient.findUnique({ where: { clientId: creds.clientId }, select: { clientId: true, clientSecretHash: true, disabledAt: true } }) : null;
  const app = client ? await db.app.findUnique({ where: { oauthClientId: client.clientId }, select: { id: true, status: true } }) : null;
  if (!client || !app || app.status === "SUSPENDED" || client.disabledAt || !client.clientSecretHash || !creds.clientSecret || !verifyToken(creds.clientSecret, client.clientSecretHash)) {
    const f = await rateLimit(`apps:session:fail:${ip}`, 30, 60);
    if (!f.ok) return err(429, "slow_down", "Too many failed authentications.", { "Retry-After": String(f.retryAfter) });
    return err(401, "invalid_client", "Client authentication failed.", { "WWW-Authenticate": 'Basic realm="axi"' });
  }

  const token = form.get("token") ?? form.get("session");
  if (!token) return err(400, "invalid_request", "token is required.");
  const v = verifySessionToken(token, app.id);
  if (!v.ok) return err(401, "invalid_token", v.reason === "expired" ? "Session token expired." : "Invalid session token.");
  const c = v.claims;

  // État courant : app toujours installée, membre toujours actif, boutique non archivée.
  const [install, member, store] = await Promise.all([
    db.appInstallation.findUnique({ where: { appId_storeId: { appId: app.id, storeId: c.sid } }, select: { status: true, grantedScopes: true } }),
    db.membership.findUnique({ where: { userId_storeId: { userId: c.sub, storeId: c.sid } }, select: { role: true, expiresAt: true } }),
    db.store.findUnique({ where: { id: c.sid }, select: { slug: true, status: true, subscription: true } }),
  ]);
  if (!install || install.status !== "ACTIVE") return err(401, "invalid_token", "The app is not installed on this store anymore.");
  if (!member || (member.expiresAt && member.expiresAt <= new Date())) return err(401, "invalid_token", "The user no longer has access to this store.");
  if (!store || store.status === "ARCHIVED") return err(401, "invalid_token", "This store is not available.");

  return Response.json(
    {
      active: true,
      shop: store.slug,
      storeId: c.sid,
      userId: c.sub,
      appId: app.id,
      scopes: effectiveScopes(install.grantedScopes, effectivePlanId(store.subscription), member.role),
      iat: c.iat,
      exp: c.exp,
    },
    { headers: H },
  );
}

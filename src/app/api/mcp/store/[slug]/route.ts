import { normalizeIp } from "@/lib/rate-limit";
import { handleMcpPayload, messageCount } from "@/lib/mcp/protocol";
import { loadPublicStore, publicStoreServer } from "@/lib/mcp/public/server";
import { jsonResponse, methodNotAllowed, preflight, rateLimited, readJsonRpcBody, respond, unavailable } from "@/lib/mcp/http";
import { checkPublicQuota, getMcpKillSwitch } from "@/lib/mcp/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * MCP vitrine public d'une boutique (commerce agentique), sans authentification.
 * Lecture du catalogue public + lien de panier ; jamais de commande ni de paiement. Limité par IP.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const kill = await getMcpKillSwitch();
  if (kill.enabled) return unavailable(kill.message || "AI assistants access is temporarily unavailable.");

  const ip = normalizeIp(req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"));
  const body = await readJsonRpcBody(req);
  if (!body.ok) return body.response;
  // Débit par IP compté par message.
  const rl = await checkPublicQuota(ip, slug.slice(0, 48), messageCount(body.payload));
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const store = await loadPublicStore(slug);
  if (!store) return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "Store not found, not published, or not open to AI assistants." } }, 404);

  const result = await handleMcpPayload(publicStoreServer, { store, ip }, body.payload, body.protocolVersion);
  return respond(result, body.protocolVersion);
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function OPTIONS() {
  return preflight();
}

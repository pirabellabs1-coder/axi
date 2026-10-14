import { protectedResourceMetadata } from "@/lib/mcp/oauth";
import { CORS_HEADERS } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/**
 * Métadonnées de ressource protégée (RFC 9728) du serveur MCP marchand.
 * Servies sur /.well-known/oauth-protected-resource et /.well-known/oauth-protected-resource/api/mcp.
 */
export async function GET() {
  return Response.json(protectedResourceMetadata(), { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

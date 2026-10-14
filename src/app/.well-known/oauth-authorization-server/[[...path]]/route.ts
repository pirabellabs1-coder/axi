import { authorizationServerMetadata } from "@/lib/mcp/oauth";
import { CORS_HEADERS } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/** Métadonnées du serveur d'autorisation OAuth 2.1 (RFC 8414). */
export async function GET() {
  return Response.json(authorizationServerMetadata(), { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

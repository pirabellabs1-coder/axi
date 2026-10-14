import { getMcpKillSwitch } from "@/lib/mcp/runtime";
import { buildStoreLlmsTxt } from "@/lib/mcp/public/llms";

export const dynamic = "force-dynamic";

/** Description de la boutique pour les assistants IA (llms.txt). 404 si non publiée ou option désactivée. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if ((await getMcpKillSwitch()).enabled) return new Response("Service temporarily unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300" } });
  const { slug } = await params;
  const body = await buildStoreLlmsTxt(slug);
  if (!body) return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=300" } });
}

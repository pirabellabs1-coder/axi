import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { requireStore } from "@/lib/auth/permissions";
import { appBaseUrl } from "@/lib/tiktok-shop/config";
import { checkState, completeAuthorization } from "@/lib/tiktok-shop/oauth";
import { STATE_COOKIE } from "@/lib/tiktok-shop/state";
import { TiktokShopError } from "@/lib/tiktok-shop/types";

export const dynamic = "force-dynamic";

/**
 * Retour d'autorisation TikTok Shop (URL de callback déclarée dans le Partner Center).
 * Refus si : state invalide / expiré, nonce du cookie absent ou différent, utilisateur connecté différent de celui
 * qui a lancé l'autorisation, ou capacité `integrations.manage` perdue entre-temps. Le cookie est toujours effacé.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const user = await getCurrentUser();
  const check = checkState(params.get("state"), req.cookies.get(STATE_COOKIE)?.value, user?.id);

  const done = (url: string) => {
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/tiktok-shop/callback", maxAge: 0 });
    return res;
  };
  if (!check.ok) return done(`${appBaseUrl()}/app?tiktok=state_${check.reason}`);

  const storeId = check.state.storeId;
  const page = `${appBaseUrl()}/app/${encodeURIComponent(storeId)}/integrations/tiktok-shop`;
  try {
    await requireStore(storeId, "integrations.manage");
  } catch {
    return done(`${appBaseUrl()}/app`);
  }
  const code = params.get("code") ?? "";
  if (!code || code.length > 512) return done(`${page}?error=denied`);

  try {
    const r = await completeAuthorization({ storeId, userId: check.state.userId, code });
    if (!r.ok) return done(`${page}?error=market`);
    return done(`${page}?connected=${r.status === "active" ? "1" : "choose"}`);
  } catch (e) {
    console.error("[tiktok-shop] callback", e instanceof TiktokShopError ? `${e.kind} ${e.code ?? ""} ${e.message}` : (e as Error).message);
    return done(`${page}?error=exchange`);
  }
}

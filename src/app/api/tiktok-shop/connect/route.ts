import { NextResponse, type NextRequest } from "next/server";
import { requireStore } from "@/lib/auth/permissions";
import { appBaseUrl, authorizeUrl, isFakeMode, platformConfig } from "@/lib/tiktok-shop/config";
import { beginAuthorization } from "@/lib/tiktok-shop/oauth";
import { STATE_COOKIE } from "@/lib/tiktok-shop/state";

export const dynamic = "force-dynamic";

/**
 * Démarre l'autorisation TikTok Shop d'une boutique : réservé aux membres ayant `integrations.manage`.
 * Le nonce du state est posé dans un cookie httpOnly limité au callback (SameSite=Lax : il accompagne la
 * redirection de premier niveau depuis TikTok).
 */
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("storeId") ?? "";
  const back = (q: string) => NextResponse.redirect(`${appBaseUrl()}/app/${encodeURIComponent(storeId)}/integrations/tiktok-shop?${q}`, 303);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(storeId)) return NextResponse.redirect(`${appBaseUrl()}/app`, 303);
  let userId: string;
  let country: string;
  try {
    const ctx = await requireStore(storeId, "integrations.manage");
    userId = ctx.user.id;
    country = ctx.store.country;
  } catch {
    return NextResponse.redirect(`${appBaseUrl()}/app`, 303);
  }
  const platform = platformConfig();
  if (!platform) return back("error=config");

  const { state, nonce } = beginAuthorization({ storeId, userId });
  const target = isFakeMode()
    ? `${appBaseUrl()}/api/tiktok-shop/callback?code=${encodeURIComponent(`fake_code_${nonce.slice(0, 8)}`)}&state=${encodeURIComponent(state)}`
    : authorizeUrl({ serviceId: platform.serviceId, state, country });
  const res = NextResponse.redirect(target, 303);
  res.cookies.set(STATE_COOKIE, nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/tiktok-shop/callback", maxAge: 600 });
  return res;
}

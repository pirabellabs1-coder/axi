import { NextResponse } from "next/server";
import { AUTHORIZE_KEYS, OAUTH_RESUME_COOKIE } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

/**
 * Connexion pendant une demande OAuth : la demande (souvent longue) est mise de côté dans un cookie
 * HttpOnly de 15 min, puis l'utilisateur passe par /connexion?next=/oauth/authorize?reprendre=1.
 * Aucune confiance n'est accordée au cookie : la page revalide intégralement la demande.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kept = new URLSearchParams();
  for (const k of AUTHORIZE_KEYS) {
    const v = url.searchParams.get(k);
    if (v && v.length <= 2000) kept.set(k, v);
  }
  const base = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/+$/, "");
  const res = NextResponse.redirect(`${base}/connexion?next=${encodeURIComponent("/oauth/authorize?reprendre=1")}`, 303);
  res.cookies.set(OAUTH_RESUME_COOKIE, kept.toString().slice(0, 3500), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/oauth",
    maxAge: 15 * 60,
  });
  return res;
}

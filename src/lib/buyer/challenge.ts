import "server-only";
import { rateLimit } from "@/lib/rate-limit";
import { challengeThreshold } from "./otp";

/**
 * Défi anti-robot (Cloudflare Turnstile) sur la demande de code acheteur. POINT D'INTÉGRATION, sans dépendance :
 *  - inactif tant que TURNSTILE_SECRET_KEY n'est pas défini ;
 *  - exigé au-delà de AXI_OTP_CHALLENGE_AFTER demandes (défaut 3) par IP et par heure ;
 *  - jeton lu dans le champ `cf-turnstile-response` (posé par le widget si NEXT_PUBLIC_TURNSTILE_SITE_KEY est défini) ;
 *  - vérification serveur par fetch sur l'API siteverify (délai 5 s ; en cas d'indisponibilité : refus prudent).
 * CSP : next.config.ts ajoute https://challenges.cloudflare.com à script-src et frame-src si une clé Turnstile est définie au build.
 */
export const TURNSTILE_FIELD = "cf-turnstile-response";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function challengeConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

export async function verifyTurnstile(token: unknown, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown" && !ip.includes("/")) body.set("remoteip", ip);
    const res = await fetch(SITEVERIFY, { method: "POST", body, signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: unknown };
    return data.success === true;
  } catch {
    return false;
  }
}

/** Contrôle complet : null si la demande peut continuer, sinon le message à renvoyer. */
export async function requireChallenge(ip: string, token: unknown): Promise<string | null> {
  if (!challengeConfigured()) return null;
  const rl = await rateLimit(`buyer-otp:challenge:${ip}`, challengeThreshold(), 3600);
  if (rl.ok) return null;
  return (await verifyTurnstile(token, ip)) ? null : "Confirmez que vous n'êtes pas un robot, puis réessayez.";
}

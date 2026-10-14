/**
 * Contrôle « même origine » des envois authentifiés par cookie (POST /api/stores/{id}/media).
 * Origin est comparé à l'hôte de NEXT_PUBLIC_APP_URL (l'espace marchand), jamais à l'en-tête Host envoyé par
 * le client ; Sec-Fetch-Site, s'il est présent, doit valoir same-origin.
 */
export function appHost(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").host.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function sameOrigin(req: Request, expectedHost: string | null = appHost()): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true; // navigateurs anciens : SameSite=Lax empêche déjà l'envoi du cookie en cross-site
  if (!expectedHost) return false; // NEXT_PUBLIC_APP_URL absente : on refuse plutôt que de croire l'en-tête Host
  try {
    return new URL(origin).host.toLowerCase() === expectedHost;
  } catch {
    return false;
  }
}

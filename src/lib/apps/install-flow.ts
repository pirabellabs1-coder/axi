/**
 * Choix du flux d'installation d'une app (module pur, testé).
 *
 * Installation OAuth (redirection vers l'app) si et seulement si le client OAuth de l'app est CONFIDENTIEL
 * (secret haché présent : l'échange du code se fait sans PKCE, avec client_secret) et possède une URI de
 * redirection web (https, ou http://localhost / 127.0.0.1 pour le développement). La PREMIÈRE URI web
 * enregistrée est utilisée. Sinon : installation directe (comportement historique).
 */
export function installRedirectUri(client: { clientSecretHash: string | null; redirectUris: readonly string[] }): string | null {
  if (!client.clientSecretHash) return null;
  for (const raw of client.redirectUris) {
    try {
      const u = new URL(raw);
      if (u.hash) continue;
      if (u.protocol === "https:") return raw;
      if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return raw;
    } catch {
      // URI invalide : ignorée
    }
  }
  return null;
}

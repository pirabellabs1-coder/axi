/**
 * Liste blanche des services de notification push — module PUR (tests/push-endpoints.test.ts).
 *
 * Correctif mineur n° 10 de l'audit de la vague 3 : `subscribeToPush` acceptait n'importe quelle URL
 * https comme point de terminaison. Deux conséquences :
 *  - le worker d'envoi (`src/lib/push/send.ts`) émettait ensuite des requêtes POST, depuis le serveur,
 *    vers une adresse choisie par l'attaquant — une SSRF aveugle utilisable pour sonder le réseau
 *    interne ou faire relayer du trafic par la plateforme ;
 *  - un point de terminaison est unique en base : s'inscrire avec l'endpoint d'un tiers permettait de
 *    le réattribuer, donc de le détourner ou de le désabonner.
 *
 * Seuls les services des navigateurs sont acceptés. La comparaison porte sur l'HÔTE normalisé, jamais
 * sur une sous-chaîne de l'URL (`https://evil.test/?x=android.googleapis.com` ne passe pas).
 */

/** Domaines des services de push des navigateurs (sous-domaines compris). */
export const PUSH_ENDPOINT_HOSTS: readonly string[] = [
  // Chrome, Edge, Brave, Opera, navigateurs Chromium d'Android
  "googleapis.com",
  "fcm.googleapis.com",
  // Safari / iOS
  "push.apple.com",
  // Firefox
  "push.services.mozilla.com",
  // Windows / Edge historique
  "notify.windows.com",
];

/** L'hôte appartient-il au domaine (égal, ou sous-domaine strict) ? */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Le point de terminaison est-il un service de push légitime ?
 * Exige https, aucun identifiant dans l'URL, un hôte de la liste blanche, et pas de port explicite
 * non standard (un port arbitraire est le marqueur d'un balayage de réseau interne).
 */
export function isAllowedPushEndpoint(endpoint: string, hosts: readonly string[] = PUSH_ENDPOINT_HOSTS): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return hosts.some((domain) => hostMatches(host, domain));
}

/** Message de refus (français), pour une boutique comme pour un test. */
export const PUSH_ENDPOINT_REJECTED = "Service de notification non reconnu : réactivez les notifications depuis votre navigateur.";

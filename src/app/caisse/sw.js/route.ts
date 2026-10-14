export const dynamic = "force-static";

/**
 * Service worker DÉDIÉ à la caisse (lot 3 §2), de portée `/caisse/`.
 *
 * Correctif mineur n° 13 de l'audit de la vague 3 : le service worker mettait en cache la RÉPONSE HTML
 * de `/caisse/{storeId}`, page authentifiée qui contient le catalogue, les appareils enregistrés et le
 * contexte du membre connecté. Après déconnexion — ou sur un appareil partagé entre caissiers, voire
 * perdu — le cache du navigateur restituait ces données hors de toute session.
 *
 * Désormais : seule la COQUE STATIQUE est mise en cache (manifeste, actifs `/_next/static`, immuables et
 * sans donnée). Le DOCUMENT est servi en RÉSEAU D'ABORD et n'est JAMAIS écrit en cache ; sans réseau,
 * une page d'attente locale est rendue (la file de ventes vit dans IndexedDB, pas dans le cache HTTP).
 */
const SW = `
const CACHE = "axi-pos-v2";
const SHELL = ["/caisse/manifest.webmanifest"];

const OFFLINE_HTML = \`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Caisse hors ligne</title>
<style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0b0c;color:#f4f4f5;padding:24px;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#a1a1aa;margin:0 0 16px;max-width:32rem}button{min-height:44px;padding:0 20px;border:0;border-radius:10px;background:#f4f4f5;color:#0b0b0c;font-size:16px;font-weight:600}</style>
</head><body><main><h1>Caisse hors ligne</h1>
<p>Reconnectez-vous au réseau pour ouvrir la caisse. Les ventes déjà encaissées restent enregistrées sur cet appareil et seront synchronisées automatiquement.</p>
<button onclick="location.reload()">Réessayer</button></main></body></html>\`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // Les anciens caches (axi-pos-v1) contenaient du HTML authentifié : ils sont supprimés à l'activation.
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Jamais de cache pour les API de la caisse (catalogue, ventes, sessions).
  if (url.pathname.startsWith("/api/")) return;

  // Coque statique uniquement : actifs immuables et manifeste. Aucune donnée, aucune session.
  const isShell = url.pathname.startsWith("/_next/static/") || url.pathname === "/caisse/manifest.webmanifest";
  if (isShell) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response && response.ok && response.type === "basic") {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (!url.pathname.startsWith("/caisse")) return;

  // DOCUMENT (page de caisse) : réseau d'abord, SANS AUCUNE écriture en cache — la page est
  // authentifiée. Hors réseau : page d'attente locale, jamais une copie des données du marchand.
  if (request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(request).catch(() => new Response(OFFLINE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })),
    );
    return;
  }

  // Tout le reste sous /caisse/ (RSC, données) : réseau seul.
  event.respondWith(fetch(request));
});
`;

export async function GET() {
  return new Response(SW, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "service-worker-allowed": "/caisse/",
      "cache-control": "no-cache",
    },
  });
}

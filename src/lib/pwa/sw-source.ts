/**
 * Service worker de la boutique (lot 4 §14), produit par `src/app/s/[slug]/sw.js/route.ts`.
 * Tout est PUR ici : `swStrategy` décide d'une stratégie pour une requête, `serviceWorkerSource`
 * sérialise le script. Les deux sont testés (`tests/pwa-sw.test.ts`), ce qui permet de garantir par test
 * que certains chemins ne sont JAMAIS mis en cache.
 *
 * Stratégies :
 *  - `never`   : passage direct au réseau, aucune écriture de cache (commande, compte, API, actions serveur,
 *                toute requête non GET, requêtes authentifiées/avec paramètres sensibles) ;
 *  - `html`    : réseau d'abord, repli sur la page hors ligne si le réseau échoue ;
 *  - `image`   : cache puis revalidation en arrière-plan (60 entrées) ;
 *  - `asset`   : actifs immuables de Next (`/_next/static/…`), cache d'abord ;
 *  - `pass`    : réseau, sans cache (CSS/JS tiers, polices, flux…).
 */

export type SwStrategy = "never" | "html" | "image" | "asset" | "pass";

/** Chemins (relatifs à la portée) jamais mis en cache : contiennent des données de commande ou de compte. */
export const NEVER_CACHE_SEGMENTS = ["commander", "compte", "panier", "merci", "connexion", "api"] as const;

const IMAGE_EXT = /\.(avif|webp|png|jpe?g|gif|svg|ico)(\?|$)/i;

export type SwRequestLike = {
  /** URL absolue de la requête. */
  url: string;
  method?: string;
  /** `request.destination` (« document », « image », « script »…). */
  destination?: string;
  /** `request.mode` (« navigate » pour une navigation). */
  mode?: string;
};

/** Chemin relatif à la portée, sans le `/` initial (« commander/paiement »), ou null hors portée. */
export function scopedPath(pathname: string, scope: string): string | null {
  const s = scope.endsWith("/") ? scope : `${scope}/`;
  if (pathname === s.slice(0, -1)) return "";
  if (!pathname.startsWith(s)) return null;
  return pathname.slice(s.length);
}

/**
 * Stratégie appliquée à une requête. `origin` est l'origine du service worker : tout ce qui vient
 * d'une autre origine n'est jamais mis en cache, sauf les images (CDN du catalogue).
 */
export function swStrategy(req: SwRequestLike, opts: { scope: string; origin: string }): SwStrategy {
  if ((req.method ?? "GET").toUpperCase() !== "GET") return "never";
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return "never";
  }
  const sameOrigin = url.origin === opts.origin;
  const isImage = req.destination === "image" || IMAGE_EXT.test(url.pathname);

  if (!sameOrigin) return isImage ? "image" : "pass";

  // API et données de navigation Next : jamais en cache.
  if (url.pathname.startsWith("/api/") || url.pathname === "/api") return "never";
  if (url.pathname.startsWith("/_next/data/") || url.searchParams.has("_rsc")) return "never";
  if (url.pathname.startsWith("/_next/static/")) return "asset";
  if (url.pathname.startsWith("/_next/image")) return "image";

  const rel = scopedPath(url.pathname, opts.scope);
  if (rel !== null) {
    const first = rel.split("/")[0]?.toLowerCase() ?? "";
    if ((NEVER_CACHE_SEGMENTS as readonly string[]).includes(first)) return "never";
    // Lien de reprise de panier et jetons : jamais en cache (contenu propre au visiteur).
    if (url.searchParams.has("panier") || url.searchParams.has("token")) return "never";
  }
  // Médias de la boutique (`/media/…`, hors portée mais immuables) et images des pages.
  if (isImage) return "image";
  if (rel === null) return "pass"; // hors portée de la boutique (console, site vitrine…)
  if (req.mode === "navigate" || req.destination === "document" || rel === "" || !/\.[a-z0-9]{2,5}$/i.test(rel)) return "html";
  return "pass";
}

export type SwSourceOptions = {
  scope: string;
  /** Version du script : change le nom des caches et force la mise à jour. */
  version: string;
  /** Page servie quand le réseau est indisponible. */
  offlineUrl: string;
  /** Icône des notifications push (logo de la boutique). */
  notificationIcon: string | null;
  storeName: string;
};

export const SW_IMAGE_CACHE_MAX_ENTRIES = 60;

/**
 * JSON sérialisé pour être injecté dans du code : `<`, `>`, `&` et les séparateurs de ligne Unicode sont
 * échappés. Le script est servi en `text/javascript` (jamais en ligne dans du HTML), mais un nom de boutique
 * ne doit jamais pouvoir sortir de sa chaîne, quel que soit le contexte d'inclusion futur.
 */
function safeJson(value: unknown): string {
  const BS = String.fromCharCode(92);
  const risky = new RegExp("[<>&]|" + String.fromCharCode(0x2028) + "|" + String.fromCharCode(0x2029), "g");
  const escape = (c: string) => BS + "u" + c.charCodeAt(0).toString(16).padStart(4, "0");
  return JSON.stringify(value).replace(risky, escape);
}

/**
 * Script du service worker. Écrit en JavaScript simple (pas de transpilation), sans dépendance,
 * et sans donnée du visiteur. Les notifications push (§19) sont gérées ici : affichage et clic.
 */
export function serviceWorkerSource(o: SwSourceOptions): string {
  const cfg = safeJson({
    scope: o.scope,
    version: o.version,
    offlineUrl: o.offlineUrl,
    icon: o.notificationIcon,
    storeName: o.storeName,
    never: NEVER_CACHE_SEGMENTS,
    maxImages: SW_IMAGE_CACHE_MAX_ENTRIES,
    liteQuality: 40,
    liteWidth: 640,
  });
  return `/* Axi — service worker de boutique (lot 4 §14). Généré : ne pas modifier à la main. */
'use strict';
var CFG = ${cfg};
var HTML_CACHE = 'axi-html-' + CFG.version;
var IMG_CACHE = 'axi-img-' + CFG.version;
var ASSET_CACHE = 'axi-asset-' + CFG.version;
var KEEP = [HTML_CACHE, IMG_CACHE, ASSET_CACHE];
var IMAGE_EXT = /\\.(avif|webp|png|jpe?g|gif|svg|ico)(\\?|$)/i;
/* Mode économie de données : annoncé par chaque page contrôlée (postMessage), conservé en mémoire. */
var lite = false;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(HTML_CACHE).then(function (c) { return c.add(new Request(CFG.offlineUrl, { cache: 'reload' })); }).catch(function () {}).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k.indexOf('axi-') === 0 && KEEP.indexOf(k) < 0 ? caches.delete(k) : null; }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  var d = e.data;
  if (d && d.type === 'axi:lite') lite = d.lite === true;
});

function scopedPath(pathname) {
  var s = CFG.scope.charAt(CFG.scope.length - 1) === '/' ? CFG.scope : CFG.scope + '/';
  if (pathname === s.slice(0, -1)) return '';
  if (pathname.indexOf(s) !== 0) return null;
  return pathname.slice(s.length);
}

function strategy(request) {
  if (request.method !== 'GET') return 'never';
  var url;
  try { url = new URL(request.url); } catch (err) { return 'never'; }
  var sameOrigin = url.origin === self.location.origin;
  var isImage = request.destination === 'image' || IMAGE_EXT.test(url.pathname);
  if (!sameOrigin) return isImage ? 'image' : 'pass';
  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/api') return 'never';
  if (url.pathname.indexOf('/_next/data/') === 0 || url.searchParams.has('_rsc')) return 'never';
  if (url.pathname.indexOf('/_next/static/') === 0) return 'asset';
  if (url.pathname.indexOf('/_next/image') === 0) return 'image';
  var rel = scopedPath(url.pathname);
  if (rel !== null) {
    var first = (rel.split('/')[0] || '').toLowerCase();
    if (CFG.never.indexOf(first) >= 0) return 'never';
    if (url.searchParams.has('panier') || url.searchParams.has('token')) return 'never';
  }
  if (isImage) return 'image';
  if (rel === null) return 'pass';
  if (request.mode === 'navigate' || request.destination === 'document' || rel === '' || !/\\.[a-z0-9]{2,5}$/i.test(rel)) return 'html';
  return 'pass';
}

/* Mode économie : les images du CDN sont demandées en qualité réduite et en largeur plafonnée. */
function liteImageRequest(request) {
  if (!lite) return request;
  try {
    var url = new URL(request.url);
    if (url.hostname !== 'images.unsplash.com') return request;
    var w = Number(url.searchParams.get('w')) || 0;
    var h = Number(url.searchParams.get('h')) || 0;
    if (w && w <= CFG.liteWidth && Number(url.searchParams.get('q')) <= CFG.liteQuality) return request;
    var target = Math.min(w || CFG.liteWidth, CFG.liteWidth);
    url.searchParams.set('w', String(target));
    if (w && h) url.searchParams.set('h', String(Math.round((h / w) * target)));
    url.searchParams.set('q', String(CFG.liteQuality));
    url.searchParams.set('auto', 'format');
    return new Request(url.toString(), { mode: request.mode, credentials: 'omit', headers: { 'Save-Data': 'on' } });
  } catch (err) {
    return request;
  }
}

async function trimCache(name, max) {
  var cache = await caches.open(name);
  var keys = await cache.keys();
  for (var i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/* Réseau d'abord : la page la plus fraîche gagne ; hors ligne, dernière version connue puis page de repli. */
async function htmlFirst(event) {
  var cache = await caches.open(HTML_CACHE);
  try {
    var res = await fetch(event.request);
    if (res && res.ok && res.type === 'basic') cache.put(event.request, res.clone()).catch(function () {});
    return res;
  } catch (err) {
    var hit = await cache.match(event.request, { ignoreSearch: true });
    if (hit) return hit;
    var offline = await cache.match(CFG.offlineUrl);
    if (offline) return offline;
    return new Response('<!doctype html><meta charset="utf-8"><title>Hors ligne</title><p>Vous êtes hors ligne.', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

/* Cache puis revalidation : réponse immédiate depuis le cache, mise à jour en arrière-plan. */
async function imageSwr(event) {
  var cache = await caches.open(IMG_CACHE);
  var request = liteImageRequest(event.request);
  var hit = await cache.match(request);
  var update = fetch(request).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).then(function () { return trimCache(IMG_CACHE, CFG.maxImages); }).catch(function () {});
    }
    return res;
  }).catch(function () { return null; });
  if (hit) {
    event.waitUntil(update);
    return hit;
  }
  var res = await update;
  return res || Response.error();
}

async function assetFirst(event) {
  var cache = await caches.open(ASSET_CACHE);
  var hit = await cache.match(event.request);
  if (hit) return hit;
  var res = await fetch(event.request);
  if (res && res.ok) cache.put(event.request, res.clone()).catch(function () {});
  return res;
}

self.addEventListener('fetch', function (event) {
  var mode = strategy(event.request);
  if (mode === 'never' || mode === 'pass') return; // le réseau fait son travail, rien n'est écrit
  if (mode === 'html') return event.respondWith(htmlFirst(event));
  if (mode === 'image') return event.respondWith(imageSwr(event));
  if (mode === 'asset') return event.respondWith(assetFirst(event));
});

/* Notifications push (§19) : charge utile JSON { title, body, url, icon, tag, topic }. */
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (err) { data = {}; }
  var title = typeof data.title === 'string' && data.title ? data.title : CFG.storeName;
  var url = typeof data.url === 'string' && data.url ? data.url : CFG.scope;
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    icon: data.icon || CFG.icon || undefined,
    badge: data.badge || undefined,
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    lang: 'fr',
    data: { url: url }
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || CFG.scope;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) {
        list[i].navigate(target).catch(function () {});
        return list[i].focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
`;
}

import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Origine des médias téléversés (pilote s3) : ajoutée explicitement à img-src. En https elle est déjà couverte
 * par `https:`, mais l'entrée explicite documente la dépendance et couvre un MinIO local en http.
 * Lue au démarrage/build : redémarrer (et rebâtir) après avoir changé STORAGE_PUBLIC_URL.
 */
function storageOrigin(): string {
  try {
    const raw = process.env.STORAGE_PUBLIC_URL?.trim();
    return raw ? new URL(raw).origin : "";
  } catch {
    return "";
  }
}
const STORAGE_ORIGIN = storageOrigin();

/**
 * Content Security Policy (m11). Compatible App Router sans nonce : Next injecte des scripts inline
 * (hydratation, script de thème), d'où `'unsafe-inline'` pour script-src ; les autres directives
 * restent strictes. Pixels marketing autorisés (Meta, Google Tag Manager / GA4).
 * En dev, `'unsafe-eval'` et WebSocket sont nécessaires au rechargement à chaud.
 */
const PIXEL_SCRIPTS = "https://connect.facebook.net https://www.googletagmanager.com";
const PIXEL_CONNECT = "https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.facebook.com";
/**
 * Défi anti-robot Cloudflare Turnstile (comptes acheteurs, src/lib/buyer/challenge.ts) : l'origine n'est ajoutée à
 * script-src et frame-src QUE si une clé Turnstile est définie au build ; sinon la politique reste inchangée.
 * Rebâtir après avoir défini NEXT_PUBLIC_TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY.
 */
const TURNSTILE_ORIGIN =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || process.env.TURNSTILE_SITE_KEY?.trim() || process.env.TURNSTILE_SECRET_KEY?.trim() ? " https://challenges.cloudflare.com" : "";
/**
 * Mode partenaire WhatsApp (Embedded Signup, src/lib/whatsapp/embedded-signup.ts) : le SDK JS Meta (déjà autorisé
 * dans script-src via connect.facebook.net) injecte une iframe cachée sur facebook.com. On n'élargit frame-src QUE
 * si l'App ID et la config Embedded Signup sont définis au build ; sinon la politique reste inchangée.
 * Rebâtir après avoir défini NEXT_PUBLIC_META_APP_ID / NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID.
 */
const META_ESIGNUP_ORIGIN =
  process.env.NEXT_PUBLIC_META_APP_ID?.trim() && process.env.NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID?.trim()
    ? " https://www.facebook.com https://web.facebook.com https://staticxx.facebook.com"
    : "";
const cspDirectives = (frameSrc: string) => [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} ${PIXEL_SCRIPTS}${TURNSTILE_ORIGIN}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https:${STORAGE_ORIGIN ? ` ${STORAGE_ORIGIN}` : ""}`,
  "font-src 'self' data:",
  `connect-src 'self' ${PIXEL_CONNECT}${isProd ? "" : " ws: wss:"}`,
  `frame-src ${frameSrc}`,
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");
const csp = cspDirectives(`'self'${TURNSTILE_ORIGIN}${META_ESIGNUP_ORIGIN}`);
/**
 * Applications embarquées de l'App Store (src/app/app/[storeId]/applications/[slug]/ouvrir) : SEULE route où une
 * iframe externe est permise (https ; http://localhost en dev pour la recette). L'URL de l'iframe est fixée par le
 * serveur (app.appUrl relue en base), jamais par le client.
 */
const embeddedAppCsp = cspDirectives(`'self' https:${isProd ? "" : " http://localhost:* http://127.0.0.1:*"}`);

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS uniquement en production (HTTPS) : en local il bloquerait http://localhost.
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // Application très dynamique (sessions, boutiques) : modèle de cache classique.
  cacheComponents: false,
  poweredByHeader: false,
  // Type-check tourne séparément (`pnpm typecheck`, exécuté avant livraison). Au `next build`, le worker
  // TypeScript de Next a un tas fixe (~512 Mo) et OOM sur ce gros projet ; on lui donne donc un tsconfig
  // de build minimal (tsconfig.build.json) qui ne scanne quasi rien. (Next 16 ne lance plus ESLint au build.)
  typescript: { ignoreBuildErrors: true, tsconfigPath: "tsconfig.build.json" },
  // Les images passent par POST /api/stores/{id}/media (hors Server Actions) ; la limite reste confortable
  // pour les produits hérités dont les images sont encore en data-URL (avant `pnpm media:migrate`).
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // App embarquée : remplace la CSP générale (frame-src élargi) pour cette route uniquement.
        source: "/app/:storeId/applications/:slug/ouvrir",
        headers: [{ key: "Content-Security-Policy", value: embeddedAppCsp }],
      },
      {
        // Médias téléversés (pilote local) : CSP minimale. Doit suivre la règle générale, qui l'écraserait sinon.
        source: "/media/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }],
      },
    ];
  },
};

export default nextConfig;

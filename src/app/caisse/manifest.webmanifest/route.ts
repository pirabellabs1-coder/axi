import { SITE } from "@/config/site";

export const dynamic = "force-static";

/**
 * Manifeste PWA de la caisse (lot 3 §2) : application installable, plein écran, portée `/caisse/`.
 * Distinct du manifeste de la vitrine (lot 4D) : la caisse est un outil interne au commerçant.
 */
export async function GET() {
  const manifest = {
    name: `Caisse ${SITE.name}`,
    short_name: "Caisse",
    description: "Encaissez au comptoir, même sans réseau.",
    start_url: "/caisse/",
    scope: "/caisse/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    // Icône de l'application : le favicon du produit (aucun fichier à générer ni à héberger).
    icons: [{ src: "/favicon.ico", sizes: "48x48", type: "image/x-icon", purpose: "any" }],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

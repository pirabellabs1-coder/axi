import type { MetadataRoute } from "next";
import { SITE } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  const base = SITE.url.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/app/", "/admin", "/admin/", "/api/", "/suivi/", "/connexion", "/inscription", "/verification", "/mot-de-passe-oublie", "/statut", "/d/", "/oauth/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

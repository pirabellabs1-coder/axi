import { PLANS, SELF_SERVE_PLANS } from "@/config/plans";
import { SITE } from "@/config/site";

const BASE = SITE.url.replace(/\/$/, "");

function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/**
 * Organization + WebSite : identité de l'éditeur, posée une seule fois (accueil).
 * Aucune donnée inventée : seuls les éléments présents dans `src/config/site.ts` sont publiés.
 */
export function OrganizationJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Organization",
            "@id": `${BASE}/#organization`,
            name: SITE.name,
            legalName: SITE.company,
            url: BASE,
            description: SITE.description,
            email: SITE.supportEmail,
            address: { "@type": "PostalAddress", addressLocality: "Cotonou", addressCountry: "BJ" },
          },
          {
            "@type": "WebSite",
            "@id": `${BASE}/#website`,
            url: BASE,
            name: SITE.name,
            inLanguage: "fr-FR",
            publisher: { "@id": `${BASE}/#organization` },
          },
        ],
      }}
    />
  );
}

/**
 * SoftwareApplication : la plateforme et ses offres en libre-service.
 * Les prix viennent de `src/config/plans.ts` (EUR en centimes, XOF entier) : jamais saisis à la main.
 */
export function SoftwareApplicationJsonLd() {
  const offers = SELF_SERVE_PLANS.flatMap((id) => {
    const plan = PLANS[id];
    return (["WORLD", "AFRICA"] as const)
      .map((zone) => {
        const amount = plan.price[zone];
        if (amount == null) return null;
        const currency = zone === "WORLD" ? "EUR" : "XOF";
        return {
          "@type": "Offer",
          name: `${SITE.name} ${plan.name}`,
          price: zone === "WORLD" ? (amount / 100).toFixed(2) : String(amount),
          priceCurrency: currency,
          description: plan.tagline,
          url: `${BASE}/tarifs`,
        };
      })
      .filter(Boolean);
  });

  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: SITE.name,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "E-commerce",
        operatingSystem: "Web",
        url: BASE,
        inLanguage: "fr-FR",
        description: SITE.description,
        publisher: { "@id": `${BASE}/#organization` },
        offers,
      }}
    />
  );
}

/** Fil d'Ariane des pages intérieures (une seule profondeur : accueil puis la page). */
export function BreadcrumbJsonLd({ items }: { items: { name: string; path: string }[] }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [{ name: "Accueil", path: "/" }, ...items].map((it, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: it.name,
          item: `${BASE}${it.path === "/" ? "" : it.path}`,
        })),
      }}
    />
  );
}

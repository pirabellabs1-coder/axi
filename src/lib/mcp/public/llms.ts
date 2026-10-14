import "server-only";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { effectivePrice } from "@/lib/commerce/pricing";
import { markdownToText } from "@/lib/products/markdown";
import { SITE } from "@/config/site";
import { appBaseUrl } from "../runtime";
import { hoursText, loadPublicStore, publicCollections, readOpeningHours } from "./server";

/**
 * llms.txt (https://llmstxt.org) : description d'une boutique destinée aux assistants IA.
 * Servi sur /s/{slug}/llms.txt et sur /llms.txt des sous-domaines / domaines personnalisés.
 */

function oneLine(md: string | null | undefined, n: number): string {
  if (!md) return "";
  const t = markdownToText(md).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Échappe les crochets d'un titre de lien Markdown. */
function label(s: string): string {
  return s.replace(/[[\]]/g, "").trim();
}

export async function buildStoreLlmsTxt(slug: string): Promise<string | null> {
  const store = await loadPublicStore(slug);
  if (!store) return null;
  const base = `${appBaseUrl()}/s/${store.slug}`;
  const [collections, products, zones, pages] = await Promise.all([
    publicCollections(store.id),
    db.product.findMany({
      where: { storeId: store.id, status: "ACTIVE" },
      orderBy: [{ isFeatured: "desc" }, { position: "asc" }],
      take: 60,
      select: { name: true, slug: true, description: true, price: true, promoPrice: true, promoStart: true, promoEnd: true },
    }),
    store.deliveryEnabled ? db.deliveryZone.findMany({ where: { storeId: store.id, active: true }, orderBy: { position: "asc" }, take: 20, select: { name: true, fee: true, etaLabel: true } }) : Promise.resolve([]),
    db.storePage.findMany({ where: { storeId: store.id, published: true }, orderBy: { position: "asc" }, take: 10, select: { slug: true, title: true, body: true } }),
  ]);
  const money = (n: number) => formatMoney(n, store.currency);
  const hours = readOpeningHours(store.openingHours);
  const out: string[] = [];
  out.push(`# ${store.name}`, "");
  out.push(`> ${oneLine(store.tagline || store.description, 240) || `Boutique en ligne ${store.city ? `à ${store.city}` : ""} sur ${SITE.name}.`}`, "");
  if (store.description) out.push(oneLine(store.description, 1200), "");
  out.push(
    `Boutique en ligne propulsée par ${SITE.name} (commerce sur WhatsApp). Devise : ${store.currency}. ${store.status === "PUBLISHED" ? "Commandes ouvertes." : "Commandes temporairement suspendues."}`,
    "",
    "## Boutique",
    `- [Accueil](${base}): vitrine et produits mis en avant`,
    `- [Catalogue](${base}/catalogue): tous les produits en vente`,
  );
  if (store.whatsappNumber) out.push(`- [WhatsApp](https://wa.me/${store.whatsappNumber}): contacter la boutique`);
  out.push("");

  if (collections.length) {
    out.push("## Collections");
    for (const c of collections) out.push(`- [${label(c.name)}](${base}/collections/${c.slug})${c.description ? `: ${oneLine(c.description, 160)}` : ""}`);
    out.push("");
  }
  if (products.length) {
    out.push("## Produits");
    for (const p of products) {
      const eff = effectivePrice(p);
      out.push(`- [${label(p.name)}](${base}/p/${p.slug}): ${money(eff.price)}${eff.isPromo ? ` (promotion, au lieu de ${money(p.price)})` : ""}${p.description ? `. ${oneLine(p.description, 160)}` : ""}`);
    }
    out.push("");
  }

  out.push("## Informations pratiques");
  if (store.city || store.address) out.push(`- Adresse : ${[store.address, store.city].filter(Boolean).join(", ")}`);
  if (Object.keys(hours).length) out.push(`- Horaires (${store.timezone}) : ${hoursText(hours)}`);
  out.push(`- Retrait en boutique : ${store.pickupEnabled ? "oui" : "non"}`);
  if (store.deliveryEnabled) out.push(`- Livraison : ${zones.length ? zones.map((z) => `${z.name} ${money(z.fee)}${z.etaLabel ? ` (${z.etaLabel})` : ""}`).join(" ; ") : "sur demande"}`);
  if (store.minOrderAmount) out.push(`- Commande minimum : ${money(store.minOrderAmount)}`);
  out.push("");

  if (pages.length) {
    out.push("## Conditions et pages");
    for (const p of pages) out.push(`- [${label(p.title)}](${base}/pages/${p.slug}): ${oneLine(p.body, 200)}`);
    out.push("");
  }

  out.push(
    "## Pour les assistants IA",
    `- Serveur MCP public : ${appBaseUrl()}/api/mcp/store/${store.slug} (transport Streamable HTTP, sans authentification). Outils : get_store_info, search_catalog, get_product, check_availability, get_delivery_options, create_checkout_link.`,
    "- Les prix sont recalculés par la boutique au moment de la commande. Un assistant peut préparer un lien de panier, mais c'est l'acheteur qui valide sa commande et son paiement.",
    "",
  );
  return out.join("\n");
}

export function buildPlatformLlmsTxt(): string {
  const base = appBaseUrl();
  return [
    `# ${SITE.name}`,
    "",
    `> ${SITE.tagline}`,
    "",
    SITE.description,
    "",
    "## Liens",
    `- [Fonctionnalités](${base}/fonctionnalites): boutique en ligne, commande WhatsApp, Mobile Money, livraison`,
    `- [Tarifs](${base}/tarifs): plans Gratuit, Starter, Business, Scale, Enterprise`,
    `- [Marketplace](${base}/marketplace): boutiques publiées sur ${SITE.name}`,
    `- [Développeurs et IA](${base}/developpeurs): connecter une boutique à Claude, ChatGPT, Cursor (MCP, jetons API, OAuth)`,
    "",
    "## Pour les assistants IA",
    `- Serveur MCP marchand : ${base}/api/mcp (authentification par jeton API ou OAuth 2.1, métadonnées ${base}/.well-known/oauth-protected-resource)`,
    `- Chaque boutique publiée expose un MCP public : ${base}/api/mcp/store/{slug} et une description ${base}/s/{slug}/llms.txt`,
    "",
  ].join("\n");
}

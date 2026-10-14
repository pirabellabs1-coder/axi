import "server-only";
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canPreviewStore, getStorefront } from "@/lib/storefront/data";
import { getThemeDocument, loadRenderData } from "@/lib/theme-engine/resolve";
import { requestCurrencyPicker } from "@/lib/storefront/currency-context";
import { effectivePlanId } from "@/lib/auth/permissions";
import { shareableImageUrl } from "@/lib/storage/public-url";
import { loadBlogPage, type BlogPageRequest } from "@/lib/blog/render-data";
import type { RenderDataWithBlog } from "@/lib/blog/render-types";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { isPreview, type SP } from "@/components/storefront/storefront-view";
import { loadPromotions, loadShopper } from "@/components/storefront/lot1-data";
import { LivePreview } from "@/components/storefront/live-preview";
import { StoreFrame } from "@/components/storefront/store-frame";
import { TemplateRenderer } from "@/components/storefront/template-renderer";

/**
 * Vue des routes du blog (/s/{slug}/blog, /blog/categorie/{c}, /blog/{article}) : même cadre et même moteur de sections
 * que le reste de la boutique (thème clair forcé et variables du commerçant), modèles `blog` et `article`.
 * Un article non public (brouillon, programmé, archivé) n'est visible que des membres de la boutique, avec un bandeau.
 */

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function pageParam(sp: SP): number {
  const n = Number(first(sp.page));
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export function tagParam(sp: SP): string | null {
  const t = first(sp.etiquette)?.trim().toLowerCase();
  return t && t.length <= 30 ? t : null;
}

/** Chargement mémorisé pour la requête (métadonnées + page). Arguments primitifs : clé de cache stable. */
const getBlogPage = cache(async (slug: string, kind: "list" | "article", key: string, page: number, tag: string | null) => {
  const sf = await getStorefront(slug);
  if (!sf) return null;
  const { store } = sf;
  const doc = getThemeDocument(store, { preview: !!sf.preview?.draft });
  let req: BlogPageRequest = kind === "list" ? { kind, page, categorySlug: key || null, tag } : { kind, slug: key, member: false };
  let res = await loadBlogPage(store, doc, req);
  // Article non public : seconde lecture réservée aux membres (aperçu), sans coût pour les visiteurs d'un article publié.
  if (!res.ok && res.reason === "not_found" && kind === "article" && (await canPreviewStore(store.id))) {
    req = { kind, slug: key, member: true };
    res = await loadBlogPage(store, doc, req);
  }
  return { sf, doc, res };
});

export async function blogMetadata(slug: string, kind: "list" | "article", key: string, sp: SP): Promise<Metadata> {
  const loaded = await getBlogPage(slug, kind, key, pageParam(sp), tagParam(sp));
  if (!loaded) return {};
  const { sf, res } = loaded;
  if (!res.ok) return { title: kind === "article" ? "Article introuvable" : "Blog", robots: { index: false, follow: false } };
  const m = res.meta;
  const image = shareableImageUrl(m.image);
  const title = m.seoTitle || m.title;
  const description = m.description?.replace(/\s+/g, " ").slice(0, 160) || undefined;
  return {
    title,
    description,
    alternates: { canonical: m.canonical, types: { "application/rss+xml": [{ url: `/s/${sf.store.slug}/blog/rss.xml`, title: `${sf.store.name} : le blog` }] } },
    openGraph: {
      title: `${title} · ${sf.store.name}`,
      description,
      siteName: sf.store.name,
      locale: "fr_FR",
      ...(kind === "article" ? { type: "article", publishedTime: m.publishedAt } : { type: "website" }),
      images: image ? [{ url: image }] : undefined,
    },
    twitter: { card: image ? "summary_large_image" : "summary" },
    ...(m.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

/** Modèle alternatif d'article (`BlogPost.templateSuffix` → `doc.alternates.article[suffix]`), sinon le modèle par défaut. */
function withArticleAlternate(doc: ThemeDocument, suffix: string | null | undefined): ThemeDocument {
  const alt = suffix ? doc.alternates?.article?.[suffix] : undefined;
  return alt ? { ...doc, templates: { ...doc.templates, article: alt } } : doc;
}

export async function BlogView({ slug, kind, keyParam, searchParams }: { slug: string; kind: "list" | "article"; keyParam: string; searchParams: SP }) {
  const loaded = await getBlogPage(slug, kind, keyParam, pageParam(searchParams), tagParam(searchParams));
  if (!loaded || !loaded.res.ok) notFound();
  const { sf, res } = loaded;
  const { store } = sf;
  const template = kind === "list" ? "blog" : "article";
  const preview = await isPreview(store.id, searchParams);
  const baseDoc = preview ? getThemeDocument(store, { preview: true }) : loaded.doc;
  const doc = template === "article" ? withArticleAlternate(baseDoc, res.meta.templateSuffix) : baseDoc;

  const data = await loadRenderData(store, doc, { template, searchParams, sample: preview }, { unpublished: !!sf.preview?.unpublished });
  if (!data) notFound();
  (data as RenderDataWithBlog).blog = res.blog;
  const ref = { id: store.id, slug: store.slug, accountsEnabled: store.accountsEnabled, currency: store.currency, timezone: store.timezone };
  const [shopper, promotions] = await Promise.all([loadShopper(ref, { preview }), loadPromotions({ ...ref, planId: effectivePlanId(store.subscription) }, data)]);
  data.shopper = shopper;
  data.promotions = promotions;

  if (preview) return <LivePreview initialDoc={doc} template={template} data={data} />;
  // Lot 2 (devises) : sélecteur de l'en-tête, même contexte que les prix (chargé une fois par requête).
  const currency = await requestCurrencyPicker(store).catch(() => null);
  return (
    <StoreFrame doc={doc} data={data} currency={currency}>
      <TemplateRenderer doc={doc} template={template} data={data} />
    </StoreFrame>
  );
}

import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { SITE } from "@/config/site";

export const dynamic = "force-dynamic";

const MARKETING_ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/fonctionnalites", priority: 0.9, changeFrequency: "monthly" },
  { path: "/tarifs", priority: 0.9, changeFrequency: "monthly" },
  { path: "/boutique-en-ligne", priority: 0.8, changeFrequency: "monthly" },
  { path: "/paiements", priority: 0.8, changeFrequency: "monthly" },
  { path: "/whatsapp", priority: 0.8, changeFrequency: "monthly" },
  { path: "/ia", priority: 0.8, changeFrequency: "monthly" },
  { path: "/marketplace", priority: 0.8, changeFrequency: "daily" },
  { path: "/developpeurs", priority: 0.7, changeFrequency: "monthly" },
  { path: "/aide", priority: 0.7, changeFrequency: "monthly" },
  { path: "/a-propos", priority: 0.5, changeFrequency: "yearly" },
  { path: "/contact", priority: 0.5, changeFrequency: "yearly" },
  { path: "/legal/cgu", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/confidentialite", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/cookies", priority: 0.2, changeFrequency: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url.replace(/\/$/, "");
  const now = new Date();

  const pages: MetadataRoute.Sitemap = MARKETING_ROUTES.map((r) => ({
    url: `${base}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  let stores: { slug: string; updatedAt: Date }[] = [];
  try {
    stores = await db.store.findMany({
      where: { status: "PUBLISHED", listedInMarketplace: true },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    });
  } catch (e) {
    console.error("[sitemap] stores", e);
  }

  const storePages: MetadataRoute.Sitemap = stores.map((s) => ({
    url: `${base}/s/${s.slug}`,
    lastModified: s.updatedAt,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...pages, ...storePages];
}

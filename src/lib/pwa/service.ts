import "server-only";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { getThemeDocument } from "@/lib/theme-engine/resolve";
import { shareableImageUrl } from "@/lib/storage/public-url";
import { isLiteRequest, liteOrigin, LITE_COOKIE } from "./lite";
import { buildManifest, installabilityIssues, pwaScope, readPwaConfig, type PwaConfig, type WebManifest } from "./config";

/**
 * Accès serveur aux réglages PWA et au mode économie (lot 4 §14).
 * Le plan est contrôlé ici : sans la fonction `pwa`, la boutique n'est jamais installable
 * (ni manifeste, ni service worker), quoi que contienne `Store.pwaConfig`.
 */

export const APP_DOMAIN = (process.env.NEXT_PUBLIC_APP_DOMAIN ?? "localhost:3000").toLowerCase();

export type PwaContext = {
  store: { id: string; slug: string; name: string; logoUrl: string | null };
  config: PwaConfig;
  /** Fonction incluse dans le plan effectif. */
  planIncluded: boolean;
  scope: string;
  manifest: WebManifest;
  issues: string[];
  /** Service worker et invitation à l'installation à servir. */
  active: boolean;
};

/** Contexte PWA d'une boutique publique, pour l'hôte servi. */
export async function pwaContextFor(slug: string, host: string | null): Promise<PwaContext | null> {
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) return null;
  const store = await db.store.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, name: true, tagline: true, description: true, logoUrl: true, bannerUrl: true, status: true,
      pwaConfig: true, subscription: true, sector: true, themeId: true, themeConfig: true, themeDoc: true, themeDocDraft: true, whatsappNumber: true,
    },
  });
  if (!store || (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY")) return null;

  const config = readPwaConfig(store.pwaConfig);
  const planIncluded = PLANS[effectivePlanId(store.subscription)].features.pwa;
  const scope = pwaScope({ slug: store.slug, host, appDomain: APP_DOMAIN });
  const doc = getThemeDocument(store);
  const manifest = buildManifest(
    { slug: store.slug, name: store.name, tagline: store.tagline, description: store.description, logoUrl: shareableImageUrl(store.logoUrl) ?? store.logoUrl },
    config,
    { scope, primary: doc.settings.colors.primary, background: doc.settings.colors.background },
  );
  const issues = installabilityIssues(config, manifest);
  return {
    store: { id: store.id, slug: store.slug, name: store.name, logoUrl: store.logoUrl },
    config,
    planIncluded,
    scope,
    manifest,
    issues,
    active: planIncluded && config.enabled,
  };
}

/** Hôte de la requête courante (en-tête `Host`, jamais une valeur dérivée du corps). */
export async function requestHost(): Promise<string | null> {
  const h = await headers();
  return h.get("host")?.toLowerCase() ?? null;
}

export type LiteState = { lite: boolean; origin: "cookie" | "header" | "off" };

/** Mode économie de données de la requête courante. */
export async function requestLite(): Promise<LiteState> {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const input = { saveDataHeader: h.get("save-data"), liteCookie: jar.get(LITE_COOKIE)?.value ?? null };
  return { lite: isLiteRequest(input), origin: liteOrigin(input) };
}

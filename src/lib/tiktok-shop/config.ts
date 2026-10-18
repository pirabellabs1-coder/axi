import { isPlaceholderSecret } from "@/lib/crypto";
import { marketFor } from "./markets";

/**
 * Configuration plateforme de l'application partenaire TikTok Shop (variables d'environnement, voir docs/TIKTOK-SHOP.md).
 * Aucune valeur n'est exposée au client hormis « configuré oui/non ».
 */
export const TIKTOK_SHOP_KIND = "tiktok_shop";
export const API_BASE = process.env.TIKTOK_SHOP_API_BASE || "https://open-api.tiktokglobalshop.com";
export const AUTH_BASE = process.env.TIKTOK_SHOP_AUTH_BASE || "https://auth.tiktok-shops.com";

export type PlatformConfig = { appKey: string; appSecret: string; serviceId: string };

/** Mode simulé : explicitement demandé ET jamais en production (garde double). */
export function isFakeMode(): boolean {
  return process.env.TIKTOK_SHOP_FAKE === "1" && process.env.NODE_ENV !== "production";
}

export function platformConfig(): PlatformConfig | null {
  if (isFakeMode()) return { appKey: "fake_app_key", appSecret: "fake_app_secret_0123456789abcdef", serviceId: "fake_service" };
  const appKey = process.env.TIKTOK_SHOP_APP_KEY?.trim();
  const appSecret = process.env.TIKTOK_SHOP_APP_SECRET?.trim();
  const serviceId = process.env.TIKTOK_SHOP_SERVICE_ID?.trim();
  if (!appKey || !appSecret || !serviceId || isPlaceholderSecret(appSecret) || appSecret.length < 16) return null;
  return { appKey, appSecret, serviceId };
}

export function isConfigured(): boolean {
  return platformConfig() !== null;
}

/**
 * URL d'autorisation vendeur (Partner Center → App → « Authorization link »). Les vendeurs US ont un hôte dédié ;
 * le choix suit le pays de la boutique Axi (un vendeur peut aussi coller le lien global, TikTok redirige).
 */
export function authorizeUrl(p: { serviceId: string; state: string; country: string | null }): string {
  const us = marketFor(p.country)?.authHost === "us";
  const host = process.env.TIKTOK_SHOP_AUTHORIZE_BASE || (us ? "https://services.tiktokshops.us" : "https://services.tiktokshop.com");
  const u = new URL("/open/authorize", host);
  u.searchParams.set("service_id", p.serviceId);
  u.searchParams.set("state", p.state);
  return u.toString();
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

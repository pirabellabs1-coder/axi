import "server-only";
import { isPlaceholderSecret } from "@/lib/crypto";

/**
 * Configuration de la connexion Page Facebook / Instagram pro (« commenter pour acheter », docs/LIVE-COMMERCE.md).
 *
 * MÊME application Meta que WhatsApp (Embedded Signup) ; configuration Facebook Login for Business DÉDIÉE :
 *   - NEXT_PUBLIC_META_APP_ID            : App ID (public, SDK JS) ;
 *   - NEXT_PUBLIC_META_SOCIAL_CONFIG_ID  : identifiant de la configuration Login for Business (public) ;
 *   - META_APP_SECRET (à défaut WHATSAPP_APP_SECRET) : échange code → jeton ET signature des webhooks ;
 *   - META_SOCIAL_VERIFY_TOKEN           : jeton de vérification du webhook /api/webhooks/meta.
 * Sans App ID / config, `socialLoginConfig()` renvoie null : l'UI explique ce qui manque, rien n'est cassé.
 */

export type SocialLoginConfig = { appId: string; configId: string };

export function socialLoginConfig(): SocialLoginConfig | null {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim();
  const configId = process.env.NEXT_PUBLIC_META_SOCIAL_CONFIG_ID?.trim();
  if (!appId || !configId) return null;
  if (!/^\d{5,32}$/.test(appId) || !/^\d{5,32}$/.test(configId)) return null;
  return { appId, configId };
}

/** Secret de l'application Meta, ou null s'il est absent / resté sur une valeur d'exemple. */
export function metaAppSecret(): string | null {
  const secret = process.env.META_APP_SECRET?.trim() || process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret || isPlaceholderSecret(secret)) return null;
  return secret;
}

export function metaSocialVerifyToken(): string | null {
  const v = process.env.META_SOCIAL_VERIFY_TOKEN?.trim();
  if (!v || isPlaceholderSecret(v)) return null;
  return v;
}

/** Champs de webhook de Page auxquels l'app est abonnée pour chaque Page connectée (`subscribed_apps`). */
export const PAGE_SUBSCRIBED_FIELDS = ["feed"] as const;

/** Permissions demandées par la configuration Login for Business (à reproduire dans le tableau de bord Meta). */
export const SOCIAL_PERMISSIONS = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_messaging",
  "pages_manage_engagement",
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "business_management",
] as const;

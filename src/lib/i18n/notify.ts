import { isPlatformLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import { rawDictionary, storefrontTranslator, type StorefrontKey } from "@/i18n/dictionary";

/**
 * Notifications transactionnelles dans la langue de la commande (lot 2 §1.1 « Commandes »).
 *
 * `Order.locale` est mémorisé au checkout (langue de l'URL). Un modèle n'existe dans cette langue QUE si le
 * dictionnaire la couvre réellement : sinon on retombe entièrement sur le français — jamais un message
 * moitié traduit. Module pur (aucun accès base), testable.
 */

/** Clés nécessaires à un message de changement de statut. Toutes présentes = « un modèle existe ». */
const ORDER_KEYS: StorefrontKey[] = ["notif.order.subject", "notif.order.greeting", "notif.order.body", "notif.order.track"];

/** Langue d'envoi : celle de la commande si un modèle complet existe, sinon le français. */
export function notificationLocale(orderLocale: string | null | undefined, statusKey?: string): string {
  if (!isPlatformLocale(orderLocale) || orderLocale === DEFAULT_LOCALE) return DEFAULT_LOCALE;
  const dict = rawDictionary(orderLocale);
  const keys = statusKey ? [...ORDER_KEYS, `notif.order.status.${statusKey}` as StorefrontKey] : ORDER_KEYS;
  return keys.every((k) => typeof dict[k] === "string" && dict[k] !== "") ? orderLocale : DEFAULT_LOCALE;
}

export type OrderStatusMessage = { locale: string; subject: string; text: string } | null;

/**
 * Message de changement de statut, dans la langue de la commande si possible.
 * Retourne null pour un statut qui ne donne pas lieu à notification (comportement inchangé).
 */
export function orderStatusMessage(p: {
  status: string;
  orderLocale: string | null | undefined;
  reference: string;
  customerName: string;
  storeName: string;
  trackUrl: string;
}): OrderStatusMessage {
  const statusKey = `notif.order.status.${p.status}` as StorefrontKey;
  if (!(statusKey in rawDictionary(DEFAULT_LOCALE))) return null;
  const locale = notificationLocale(p.orderLocale, p.status);
  const { t } = storefrontTranslator(locale);
  const status = t(statusKey);
  return {
    locale,
    subject: t("notif.order.subject", { reference: p.reference, status }),
    text: [t("notif.order.greeting", { name: p.customerName }), "", t("notif.order.body", { reference: p.reference, store: p.storeName, status }), "", `${t("notif.order.track")} ${p.trackUrl}`].join("\n"),
  };
}

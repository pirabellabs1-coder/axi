import type { CredentialField, GatewayCredentials, PaymentGateway } from "@/lib/payments/provider";
import { CHANNEL_LABELS, sanitizeChannels, type ChannelId } from "@/lib/payments/channels";
import { getCountry } from "@/config/site";

/**
 * Règles PURES de configuration d'un moyen « passerelle » (sans base) : fusion des identifiants,
 * portefeuilles par pays, compatibilité pays / devise. Utilisées par les actions et les tests.
 */

type GatewayShape = Pick<PaymentGateway, "id" | "label" | "credentialFields" | "supportedCurrencies" | "channelsByCountry">;

/**
 * Fusionne les champs saisis (`cred_<clé>`) avec les identifiants enregistrés : un champ laissé vide conserve
 * l'ancienne valeur, un champ saisi la remplace. Les listes fermées sont validées.
 */
export function mergeCredentials(gw: GatewayShape, read: (key: string) => string, previous: GatewayCredentials) {
  const creds: GatewayCredentials = { ...previous };
  const invalid: CredentialField[] = [];
  for (const f of gw.credentialFields) {
    const v = read(f.key).trim();
    if (!v) continue;
    if (f.options && !f.options.some((o) => o.value === v)) {
      invalid.push(f);
      continue;
    }
    creds[f.key] = v.slice(0, 2000);
  }
  // Seuls les champs déclarés sont conservés (jamais de clé héritée d'un autre fournisseur).
  const known = new Set(gw.credentialFields.map((f) => f.key));
  for (const k of Object.keys(creds)) if (!known.has(k)) delete creds[k];
  const missing = gw.credentialFields.filter((f) => !f.optional && !creds[f.key]);
  return { creds, missing, invalid };
}

/** Portefeuilles proposés par ce fournisseur dans le pays de la boutique ; null = fournisseur sans notion de portefeuille. */
export function channelsForCountry(gw: GatewayShape, country: string): ChannelId[] | null {
  if (!gw.channelsByCountry) return null;
  return (gw.channelsByCountry[country] ?? []) as ChannelId[];
}

export type GatewayStoreCheck = { ok: true; channels: ChannelId[] } | { ok: false; error: string; field: string };

/**
 * Compatibilité avec la boutique (agrégateurs du lot 1 bis) : pays couvert, devise acceptée, au moins un
 * portefeuille choisi, et pour CinetPay des identifiants du pays de la boutique.
 */
export function checkGatewayForStore(gw: GatewayShape, store: { country: string; currency: string }, creds: GatewayCredentials, requested: unknown[]): GatewayStoreCheck {
  const available = channelsForCountry(gw, store.country);
  if (available === null) return { ok: true, channels: [] };
  const countryName = getCountry(store.country).code === store.country ? getCountry(store.country).name : store.country;
  if (available.length === 0) return { ok: false, error: `${gw.label} n'encaisse pas dans le pays de votre boutique (${countryName}). Choisissez un autre fournisseur.`, field: "provider" };
  if (!gw.supportedCurrencies.includes(store.currency)) return { ok: false, error: `${gw.label} n'encaisse pas en ${store.currency}, la devise de votre boutique.`, field: "provider" };
  if (creds.country && creds.country !== store.country) {
    return { ok: false, error: `Les identifiants ${gw.label} doivent être ceux du pays de la boutique (${countryName}).`, field: "cred_country" };
  }
  const channels = sanitizeChannels(requested, available);
  if (channels.length === 0) {
    return { ok: false, error: `Cochez au moins un moyen proposé au client (${available.map((c) => CHANNEL_LABELS[c]).join(", ")}).`, field: "channels" };
  }
  return { ok: true, channels };
}

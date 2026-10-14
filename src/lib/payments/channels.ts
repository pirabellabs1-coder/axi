/**
 * Portefeuilles (canaux) de paiement proposés via un agrégateur : module PUR, importable côté client.
 *
 * Valeurs stockées dans `PaymentMethod.channels` et `PaymentAttempt.channel`.
 * Couverture par agrégateur et par pays : documentation officielle consultée le 11/10/2026
 *  - Paystack : Côte d'Ivoire, XOF, cartes + Mobile Money (MTN MoMo, Wave, Orange Money)
 *    (PaystackOSS/paystack-mcp-server, src/data/paystack-skill.md) ;
 *  - pawaPay : https://docs.pawapay.io/v2/docs/providers (fournisseurs XOF/XAF) ;
 *  - CinetPay : SDK officiel cinetpay-js (API v1), src/constants/payment-methods.ts.
 */

export const CHANNEL_IDS = ["wave", "orange_money", "mtn_momo", "moov_money", "card"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export const CHANNEL_LABELS: Record<ChannelId, string> = {
  wave: "Wave",
  orange_money: "Orange Money",
  mtn_momo: "MTN MoMo",
  moov_money: "Moov Money",
  card: "Carte bancaire",
};

export function isChannelId(v: unknown): v is ChannelId {
  return typeof v === "string" && (CHANNEL_IDS as readonly string[]).includes(v);
}

export function channelLabel(id: string): string {
  return isChannelId(id) ? CHANNEL_LABELS[id] : id;
}

/** Libellé client suggéré : « Wave, Orange Money ou MTN MoMo ». */
export function suggestedMethodLabel(channels: string[]): string {
  const labels = CHANNEL_IDS.filter((c) => channels.includes(c)).map((c) => (c === "card" ? "carte" : CHANNEL_LABELS[c]));
  if (labels.length === 0) return "Mobile Money ou carte en ligne";
  if (labels.length === 1) return labels[0] === "carte" ? "Carte bancaire" : labels[0];
  return `${labels.slice(0, -1).join(", ")} ou ${labels[labels.length - 1]}`.slice(0, 60);
}

/** Portefeuilles retenus : ceux demandés ET disponibles (ordre canonique, sans doublon). */
export function sanitizeChannels(requested: unknown[], available: readonly string[]): ChannelId[] {
  const set = new Set(requested.filter(isChannelId));
  return CHANNEL_IDS.filter((c) => set.has(c) && available.includes(c));
}

/** ISO 3166-1 alpha-2 → alpha-3 (pawaPay). */
export const ISO3: Record<string, string> = { CI: "CIV", SN: "SEN", BJ: "BEN", BF: "BFA", CM: "CMR", CD: "COD", GA: "GAB", CG: "COG", TG: "TGO", ML: "MLI", NE: "NER", GN: "GIN" };

/* ───────────────────────── Paystack ───────────────────────── */

export const PAYSTACK_CHANNELS: Record<string, ChannelId[]> = {
  CI: ["wave", "orange_money", "mtn_momo", "card"],
};

/** Paystack ne filtre que par famille de canal (`mobile_money`, `card`), jamais par opérateur. */
export function paystackChannelParam(channels: string[]): ("mobile_money" | "card")[] | undefined {
  if (channels.length === 0) return undefined;
  const out: ("mobile_money" | "card")[] = [];
  if (channels.some((c) => c !== "card" && isChannelId(c))) out.push("mobile_money");
  if (channels.includes("card")) out.push("card");
  return out.length ? out : undefined;
}

/* ───────────────────────── pawaPay ───────────────────────── */

/** Code fournisseur pawaPay par (pays, portefeuille) et type d'autorisation (docs.pawapay.io/v2/docs/providers). */
const PAWAPAY_PROVIDERS: Record<string, Partial<Record<ChannelId, { code: string; auth: "PROVIDER_AUTH" | "REDIRECT_AUTH" | "PREAUTH" }>>> = {
  CI: { mtn_momo: { code: "MTN_MOMO_CIV", auth: "PROVIDER_AUTH" }, orange_money: { code: "ORANGE_CIV", auth: "PROVIDER_AUTH" }, wave: { code: "WAVE_CIV", auth: "REDIRECT_AUTH" } },
  SN: { orange_money: { code: "ORANGE_SEN", auth: "PROVIDER_AUTH" }, wave: { code: "WAVE_SEN", auth: "REDIRECT_AUTH" } },
  BJ: { mtn_momo: { code: "MTN_MOMO_BEN", auth: "PROVIDER_AUTH" }, moov_money: { code: "MOOV_BEN", auth: "PROVIDER_AUTH" } },
  BF: { moov_money: { code: "MOOV_BFA", auth: "PROVIDER_AUTH" }, orange_money: { code: "ORANGE_BFA", auth: "PREAUTH" } },
  CM: { mtn_momo: { code: "MTN_MOMO_CMR", auth: "PROVIDER_AUTH" }, orange_money: { code: "ORANGE_CMR", auth: "PROVIDER_AUTH" } },
};

export const PAWAPAY_CHANNELS: Record<string, ChannelId[]> = Object.fromEntries(
  Object.entries(PAWAPAY_PROVIDERS).map(([country, m]) => [country, CHANNEL_IDS.filter((c) => !!m[c])]),
);

export function pawapayProvider(country: string | null | undefined, channel: string | null | undefined) {
  if (!country || !isChannelId(channel)) return null;
  return PAWAPAY_PROVIDERS[country]?.[channel] ?? null;
}

/* ───────────────────────── CinetPay ───────────────────────── */

const CINETPAY_PREFIX: Partial<Record<ChannelId, string>> = { wave: "WAVE", orange_money: "OM", mtn_momo: "MTN", moov_money: "MOOV" };

export const CINETPAY_CHANNELS: Record<string, ChannelId[]> = {
  CI: ["wave", "orange_money", "mtn_momo", "moov_money"],
  SN: ["wave", "orange_money"],
  BF: ["wave", "orange_money", "moov_money"],
  ML: ["orange_money", "moov_money"],
  TG: ["moov_money"],
  BJ: ["mtn_momo", "moov_money"],
  CM: ["orange_money", "mtn_momo"],
  GN: ["orange_money", "mtn_momo"],
  NE: ["moov_money"],
};

/** `payment_method` CinetPay (ex. WAVE_CI, OM_SN) ; null si le portefeuille n'existe pas dans ce pays. */
export function cinetpayPaymentMethod(country: string | null | undefined, channel: string | null | undefined): string | null {
  if (!country || !isChannelId(channel)) return null;
  if (!CINETPAY_CHANNELS[country]?.includes(channel)) return null;
  const prefix = CINETPAY_PREFIX[channel];
  return prefix ? `${prefix}_${country}` : null;
}

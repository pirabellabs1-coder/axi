import { randomBytes } from "node:crypto";
import type { GatewayCredentials, GatewayStatus, PaymentGateway, StatusContext, WebhookVerification } from "../provider";
import { CINETPAY_CHANNELS, cinetpayPaymentMethod, isChannelId } from "../channels";
import { digitsOnly, fitUrl, fromMajor, isAbandoned, networkErrorOf, payerEmail, providerFetch, safeEqualStr, sha256Hex, splitName } from "./util";

/**
 * CinetPay — Mobile Money UEMOA / CEMAC (Wave, Orange Money, MTN, Moov…), API v1.
 *
 * Sources officielles (11/10/2026 ; docs.cinetpay.com injoignable depuis l'environnement de développement) :
 * SDK officiels github.com/cinetpay/cinetpay-js et cinetpay-php-sdk (« API CinetPay v1 ») :
 *  - sandbox https://api.cinetpay.net (clés sk_test_…), production https://api.cinetpay.co (sk_live_…) ;
 *  - identifiants PAR PAYS (api_key / api_password) → POST /v1/oauth/login → jeton JWT (24 h) ;
 *  - POST /v1/payment → payment_url, payment_token, notify_token, transaction_id ;
 *  - GET /v1/payment/{merchant_transaction_id | transaction_id | payment_token} → status ;
 *  - notification POST { notify_token, merchant_transaction_id, transaction_id } vers notify_url ;
 *    authentification : notify_token (comparé en temps constant à celui reçu à l'initialisation) puis
 *    relecture du statut canonique et contrôle des identifiants (comme WebhookService du SDK PHP).
 * Contraintes : montant entier 100 à 2 500 000, merchant_transaction_id ≤ 30, URLs ≤ 120 caractères.
 * Pas d'API de remboursement dans la v1 (seulement des transferts) : remboursement manuel.
 */

const BASE = { test: "https://api.cinetpay.net", live: "https://api.cinetpay.co" } as const;
const CURRENCIES = ["XOF", "XAF", "GNF", "CDF"];
const TOKEN_TTL_MS = 23 * 3600_000;
export const CINETPAY_MIN_AMOUNT = 100;
export const CINETPAY_MAX_AMOUNT = 2_500_000;

const COUNTRY_NAMES: Record<string, string> = {
  CI: "Côte d'Ivoire",
  SN: "Sénégal",
  BF: "Burkina Faso",
  ML: "Mali",
  TG: "Togo",
  BJ: "Bénin",
  CM: "Cameroun",
  GN: "Guinée",
  NE: "Niger",
};

export function cinetpayMode(creds: GatewayCredentials): "test" | "live" | null {
  const k = creds.apiKey ?? "";
  return k.startsWith("sk_test_") ? "test" : k.startsWith("sk_live_") ? "live" : null;
}

function baseOf(creds: GatewayCredentials): string {
  return cinetpayMode(creds) === "live" ? BASE.live : BASE.test;
}

/* ── Jeton JWT par jeu d'identifiants (cache mémoire du processus, appels coalescés) ── */
const tokens = new Map<string, { token: string; exp: number }>();
const pending = new Map<string, Promise<{ token: string } | { error: string }>>();

function cacheKey(creds: GatewayCredentials) {
  return sha256Hex(`${baseOf(creds)}|${creds.apiKey}|${creds.apiPassword}`);
}

async function login(creds: GatewayCredentials, force = false): Promise<{ token: string } | { error: string }> {
  const key = cacheKey(creds);
  const hit = tokens.get(key);
  if (!force && hit && hit.exp > Date.now()) return { token: hit.token };
  const running = pending.get(key);
  if (running) return running;
  const p = (async () => {
    const r = await providerFetch(`${baseOf(creds)}/v1/oauth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ api_key: creds.apiKey, api_password: creds.apiPassword }),
    });
    const net = networkErrorOf(r);
    if (net) return { error: `CinetPay injoignable (${net})` };
    const token = r.json?.access_token;
    if (typeof token !== "string" || !token) {
      const st = String(r.json?.status ?? "");
      return { error: st === "INVALID_CREDENTIALS" || r.status === 401 ? "identifiants CinetPay refusés (clé API / mot de passe API du pays)" : `authentification CinetPay impossible (HTTP ${r.status})` };
    }
    tokens.set(key, { token, exp: Date.now() + TOKEN_TTL_MS });
    return { token };
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** Appel authentifié ; un jeton expiré (code 1003 / EXPIRED_TOKEN) est renouvelé une fois. */
async function call(creds: GatewayCredentials, path: string, init: RequestInit = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await login(creds, attempt > 0);
    if ("error" in auth) return { error: auth.error } as const;
    const r = await providerFetch(`${baseOf(creds)}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
    });
    const expired = r.json?.code === 1003 || r.json?.status === "EXPIRED_TOKEN" || r.json?.status === "INVALID_TOKEN";
    if (expired && attempt === 0) {
      tokens.delete(cacheKey(creds));
      continue;
    }
    return { r } as const;
  }
  return { error: "jeton CinetPay refusé" } as const;
}

/** Statut de transaction CinetPay → statut Axi. */
export function mapCinetpayStatus(status: unknown, ctx?: StatusContext, now = Date.now()): GatewayStatus | "UNKNOWN" {
  switch (status) {
    case "SUCCESS":
      return "CONFIRMED";
    case "FAILED":
      return "FAILED";
    case "EXPIRED":
      return "EXPIRED";
    case "INITIATED":
    case "PENDING":
      return isAbandoned(ctx, now) ? "EXPIRED" : "PENDING";
    case "NOT_FOUND":
      return isAbandoned(ctx, now) ? "EXPIRED" : "UNKNOWN";
    default:
      return "UNKNOWN";
  }
}

/** notify_token reçu vs empreinte SHA-256 conservée sur la tentative (le jeton n'est jamais stocké en clair). */
export function cinetpayNotifyTokenValid(received: unknown, expectedHash: unknown): boolean {
  if (typeof received !== "string" || !received || typeof expectedHash !== "string" || !expectedHash) return false;
  return safeEqualStr(sha256Hex(received), expectedHash);
}

/** Corps de notification : JSON (SDK officiels) ou formulaire, par tolérance. */
export function parseCinetpayNotification(rawBody: string): Record<string, unknown> | null {
  try {
    const j: unknown = JSON.parse(rawBody);
    return j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  } catch {
    if (!/^[\w%.+-]+=/.test(rawBody)) return null;
    return Object.fromEntries(new URLSearchParams(rawBody));
  }
}

async function readPayment(id: string, creds: GatewayCredentials) {
  const res = await call(creds, `/v1/payment/${encodeURIComponent(id)}`);
  if ("error" in res) return null;
  const j = res.r.json;
  if (!j) return null;
  if (j.code === 404 || j.status === "NOT_FOUND" || res.r.status === 404) return { status: "NOT_FOUND" as const, raw: j };
  if (!res.r.ok && j.status !== "SUCCESS" && j.status !== "FAILED") return null;
  return { status: j.status, merchantTransactionId: j.merchant_transaction_id, transactionId: j.transaction_id, amount: j.amount, currency: j.currency, raw: j };
}

export const cinetpay: PaymentGateway = {
  id: "cinetpay",
  label: "CinetPay",
  credentialFields: [
    { key: "apiKey", label: "Clé API (sk_test_… ou sk_live_…)", secret: true, placeholder: "sk_test_…", hint: "Espace marchand CinetPay, identifiants du pays choisi ci-dessous. sk_test_ = mode test." },
    { key: "apiPassword", label: "Mot de passe API", secret: true },
    {
      key: "country",
      label: "Pays du compte CinetPay",
      secret: false,
      options: Object.keys(CINETPAY_CHANNELS).map((c) => ({ value: c, label: COUNTRY_NAMES[c] ?? c })),
      hint: "Les identifiants CinetPay sont propres à un pays : ils doivent correspondre à ce pays.",
    },
  ],
  supportedCurrencies: CURRENCIES,
  supportedCountries: Object.keys(CINETPAY_CHANNELS),
  channelsByCountry: CINETPAY_CHANNELS,
  docsUrl: "https://github.com/cinetpay/cinetpay-js",
  modeOf: cinetpayMode,

  async initiate(input, creds) {
    if (!creds.apiKey || !creds.apiPassword) return { ok: false, error: "CinetPay : identifiants manquants." };
    if (!CURRENCIES.includes(input.currency)) return { ok: false, error: `CinetPay : devise ${input.currency} non prise en charge.` };
    const amount = Math.round(input.amount);
    if (amount < CINETPAY_MIN_AMOUNT || amount > CINETPAY_MAX_AMOUNT) return { ok: false, error: `CinetPay accepte de ${CINETPAY_MIN_AMOUNT} à ${CINETPAY_MAX_AMOUNT.toLocaleString("fr-FR")} ${input.currency} par paiement.` };
    const notifyUrl = input.callbackUrl;
    if (notifyUrl.length > 120) return { ok: false, error: "CinetPay : URL de notification trop longue (120 caractères max). Raccourcissez NEXT_PUBLIC_APP_URL." };
    const country = creds.country || input.country || "";
    // Identifiant marchand propre à CET appel (≤ 30 car.) : jamais TRANSACTION_EXIST après un échec réseau.
    const merchantTransactionId = `${input.attemptId.slice(0, 25)}-${randomBytes(2).toString("hex")}`;
    const wallets = (input.channels ?? []).filter((c) => isChannelId(c) && c !== "card");
    const method = cinetpayPaymentMethod(country, input.channel ?? (wallets.length === 1 ? wallets[0] : null));
    const { first, last } = splitName(input.customer.name);
    const phone = digitsOnly(input.customer.phone);
    const body: Record<string, unknown> = {
      currency: input.currency,
      merchant_transaction_id: merchantTransactionId,
      amount,
      lang: "fr",
      designation: input.description.slice(0, 120),
      client_email: payerEmail(input.customer.email, input.customer.phone),
      client_first_name: first,
      client_last_name: last,
      success_url: fitUrl(input.returnUrl, 120),
      failed_url: fitUrl(input.cancelUrl, 120),
      notify_url: notifyUrl,
      channel: "PUSH",
      ...(method ? { payment_method: method } : {}),
      ...(phone.length >= 8 ? { client_phone_number: `+${phone}` } : {}),
    };
    const res = await call(creds, "/v1/payment", { method: "POST", body: JSON.stringify(body) });
    if ("error" in res) return { ok: false, error: `CinetPay : ${res.error}.` };
    const j = res.r.json ?? {};
    const url = j.payment_url;
    const notifyToken = j.notify_token;
    if (typeof url !== "string" || !url.startsWith("https://") || typeof notifyToken !== "string" || !notifyToken) {
      const desc = typeof j.description === "string" ? j.description : typeof j.message === "string" ? j.message : String(j.status ?? `HTTP ${res.r.status}`);
      return { ok: false, error: `CinetPay : ${desc.slice(0, 160)}` };
    }
    return {
      ok: true,
      redirectUrl: url,
      providerRef: merchantTransactionId,
      metadata: { notifyTokenHash: sha256Hex(notifyToken), ...(typeof j.transaction_id === "string" ? { cinetpayTransactionId: j.transaction_id } : {}) },
    };
  },

  extractWebhookRefs(payload) {
    const p = (payload ?? {}) as { merchant_transaction_id?: unknown };
    return { providerRef: typeof p.merchant_transaction_id === "string" ? p.merchant_transaction_id : null };
  },

  async verifyWebhook(rawBody, _headers, creds, ctx): Promise<WebhookVerification> {
    const n = parseCinetpayNotification(rawBody);
    if (!n) return { ok: false, error: "Notification CinetPay illisible" };
    const mtid = typeof n.merchant_transaction_id === "string" ? n.merchant_transaction_id : "";
    const tid = typeof n.transaction_id === "string" ? n.transaction_id : "";
    if (!mtid || !tid) return { ok: false, error: "Identifiants de transaction CinetPay absents" };
    if (!ctx || ctx.providerRef !== mtid) return { ok: false, error: "Transaction CinetPay inattendue pour cette tentative" };
    if (!cinetpayNotifyTokenValid(n.notify_token, ctx.metadata?.notifyTokenHash)) return { ok: false, error: "Jeton de notification CinetPay invalide" };
    // Statut canonique relu auprès de CinetPay ; identifiants comparés (anti-substitution).
    const p = await readPayment(mtid, creds);
    if (!p) return { ok: false, error: "Statut CinetPay non vérifiable (API injoignable ou identifiants refusés)" };
    if (p.status !== "NOT_FOUND" && (p.merchantTransactionId !== mtid || p.transactionId !== tid)) return { ok: false, error: "Statut CinetPay incohérent avec la notification" };
    const mapped = mapCinetpayStatus(p.status);
    const status: GatewayStatus = mapped === "UNKNOWN" ? "PENDING" : mapped;
    const currency = typeof p.currency === "string" && p.currency ? p.currency.toUpperCase() : ctx.currency;
    // POINT D'INTÉGRATION : les SDK officiels ne documentent pas `amount` dans GET /v1/payment. S'il est
    // renvoyé, il fait foi. m1 : SANS montant, on ne recopie PAS celui de la tentative — le contrôle
    // « montant reçu = montant attendu » de handleGatewayWebhook deviendrait tautologique et un encaissement
    // PARTIEL passerait la commande en PAID pour la totalité. `confirmationHasAmount` refuse alors le
    // CONFIRMED : l'événement est enregistré avec son motif et le marchand rapproche à la main.
    const apiAmount = "amount" in (p.raw ?? {}) ? fromMajor(p.amount, currency) : null;
    return { ok: true, eventId: `${mtid}:${String(p.status).slice(0, 30)}`, type: `payment.${String(p.status).toLowerCase().slice(0, 30)}`, providerRef: mtid, status, amount: apiAmount ?? undefined, currency, raw: { merchant_transaction_id: mtid, transaction_id: tid } };
  },

  async fetchStatus(providerRef, creds, ctx) {
    if (!creds.apiKey || !creds.apiPassword) return "UNKNOWN";
    const p = await readPayment(providerRef, creds);
    if (!p) return "UNKNOWN";
    return mapCinetpayStatus(p.status, ctx);
  },

  async testConnection(creds) {
    const mode = cinetpayMode(creds);
    if (!mode) return { ok: false, error: "La clé API CinetPay doit commencer par sk_test_ (test) ou sk_live_ (production)." };
    if (!creds.apiPassword) return { ok: false, error: "Saisissez le mot de passe API CinetPay." };
    const auth = await login(creds, true);
    if ("error" in auth) return { ok: false, error: `Connexion CinetPay refusée : ${auth.error}.` };
    return {
      ok: true,
      message: `Connexion CinetPay réussie (${mode === "test" ? "mode test" : "production"}${creds.country ? `, ${COUNTRY_NAMES[creds.country] ?? creds.country}` : ""}).`,
      warnings: ["L'URL de notification est transmise à chaque paiement : rien à déclarer chez CinetPay. Vérifiez seulement que votre serveur est joignable en HTTPS."],
    };
  },
};

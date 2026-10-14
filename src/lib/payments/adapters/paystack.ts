import { createHmac, randomBytes } from "node:crypto";
import { currencyDecimals } from "@/lib/money";
import type { GatewayCredentials, GatewayStatus, PaymentGateway, StatusContext, WebhookVerification } from "../provider";
import { PAYSTACK_CHANNELS, paystackChannelParam } from "../channels";
import { isAbandoned, networkErrorOf, payerEmail, providerFetch, safeEqualStr } from "./util";

/**
 * Paystack — Côte d'Ivoire : Mobile Money (Wave, Orange Money, MTN MoMo) et cartes, en XOF.
 *
 * Sources officielles (11/10/2026 ; paystack.com/docs renvoie 403 aux robots, d'où les dépôts officiels) :
 *  - OpenAPI : github.com/PaystackOSS/openapi (dist/paystack.yaml) : POST /transaction/initialize,
 *    GET /transaction/verify/{reference}, POST /refund ;
 *  - extraits de la doc : github.com/PaystackOSS/doc-code-snippets (webhooks : HMAC-SHA512 du corps brut
 *    avec la clé secrète, en-tête `x-paystack-signature` ; événement `charge.success`) ;
 *  - serveur MCP officiel : « XOF has no subunit but amounts must still be multiplied by 100 ».
 *
 * Flux : initialisation serveur → redirection vers la page Paystack (le client choisit Wave, Orange,
 * MTN ou carte) → webhook signé `charge.success` → relecture du statut (verify) → confirmation.
 * Une même clé sert en test (sk_test_) et en production (sk_live_) : l'URL d'API est unique.
 */

const API = "https://api.paystack.co";

export function paystackMode(creds: GatewayCredentials): "test" | "live" | null {
  const k = creds.secretKey ?? "";
  return k.startsWith("sk_test_") ? "test" : k.startsWith("sk_live_") ? "live" : null;
}

/** Montant Axi → plus petite unité Paystack (XOF : ×100 malgré l'absence de centimes). */
export function paystackToMinor(amount: number, currency: string): number {
  return currencyDecimals(currency) === 0 ? Math.round(amount) * 100 : Math.round(amount);
}

/** Plus petite unité Paystack → montant Axi ; null si non entier (jamais d'arrondi silencieux). */
export function paystackFromMinor(value: unknown, currency: string): number | null {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  if (currencyDecimals(currency) !== 0) return n;
  return n % 100 === 0 ? n / 100 : null;
}

/** Signature `x-paystack-signature` : HMAC-SHA512 hexadécimal du corps brut, clé secrète. */
export function paystackSignatureValid(secretKey: string, rawBody: string, header: string | null): boolean {
  if (!secretKey || !header) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  return safeEqualStr(expected, header.trim().toLowerCase());
}

/** Statuts de transaction Paystack → statut Axi. `abandoned` = page ouverte, pas encore payée. */
export function mapPaystackStatus(status: unknown, ctx?: StatusContext, now = Date.now()): GatewayStatus {
  switch (status) {
    case "success":
      return "CONFIRMED";
    case "failed":
    case "reversed":
      return "FAILED";
    case "abandoned":
      return isAbandoned(ctx, now) ? "EXPIRED" : "PENDING";
    default:
      // ongoing | pending | processing | queued | inconnu : jamais final.
      return "PENDING";
  }
}

function authHeaders(creds: GatewayCredentials) {
  return { Authorization: `Bearer ${creds.secretKey}`, "Content-Type": "application/json", Accept: "application/json" };
}

async function verifyTransaction(reference: string, creds: GatewayCredentials) {
  const r = await providerFetch(`${API}/transaction/verify/${encodeURIComponent(reference)}`, { headers: authHeaders(creds) });
  if (!r.ok || r.json?.status !== true) return { found: false as const, httpStatus: r.status };
  const d = (r.json.data ?? {}) as { status?: string; amount?: unknown; currency?: string; reference?: string };
  return { found: true as const, status: d.status, amount: d.amount, currency: d.currency, reference: d.reference };
}

export const paystack: PaymentGateway = {
  id: "paystack",
  label: "Paystack",
  credentialFields: [
    {
      key: "secretKey",
      label: "Clé secrète (sk_test_… ou sk_live_…)",
      secret: true,
      placeholder: "sk_test_…",
      hint: "Tableau de bord Paystack → Settings → API Keys & Webhooks. Elle signe aussi les webhooks : aucun autre secret à saisir.",
    },
  ],
  supportedCurrencies: ["XOF"],
  supportedCountries: ["CI"],
  channelsByCountry: PAYSTACK_CHANNELS,
  docsUrl: "https://paystack.com/docs/payments/accept-payments/",
  modeOf: paystackMode,

  async initiate(input, creds) {
    if (!creds.secretKey) return { ok: false, error: "Paystack : clé secrète manquante." };
    if (input.currency !== "XOF") return { ok: false, error: `Paystack n'encaisse pas en ${input.currency} pour cette boutique (XOF uniquement en Côte d'Ivoire).` };
    // Référence propre à CET appel : une nouvelle initialisation après un échec réseau ne heurte jamais
    // « Duplicate Transaction Reference ». Le préfixe attemptId sert d'indice de rattachement.
    const reference = `${input.attemptId}.${randomBytes(3).toString("hex")}`;
    const wanted = input.channel ? [input.channel] : (input.channels ?? []);
    const body = {
      email: payerEmail(input.customer.email, input.customer.phone),
      amount: paystackToMinor(input.amount, input.currency),
      currency: input.currency,
      reference,
      callback_url: input.returnUrl,
      channels: paystackChannelParam(wanted),
      metadata: {
        attemptId: input.attemptId,
        orderReference: input.orderReference,
        cancel_action: input.cancelUrl,
        custom_fields: [{ display_name: "Commande", variable_name: "order_reference", value: input.orderReference }],
      },
    };
    // POINT D'INTÉGRATION (facultatif) : paiement poussé sans page Paystack via POST /charge
    // { mobile_money: { phone, provider } }. Les codes `provider` de Côte d'Ivoire ne sont pas publiés
    // dans les sources accessibles ; la page hébergée (qui couvre Wave, Orange, MTN et la carte) est utilisée.
    const r = await providerFetch(`${API}/transaction/initialize`, { method: "POST", headers: authHeaders(creds), body: JSON.stringify(body) });
    const net = networkErrorOf(r);
    if (net) return { ok: false, error: `Paystack injoignable (${net}). Réessayez dans un instant.` };
    if (r.status === 401) return { ok: false, error: "Paystack : clé secrète refusée. Vérifiez la configuration du moyen de paiement." };
    const data = (r.json?.data ?? {}) as { authorization_url?: string; reference?: string };
    if (!r.ok || r.json?.status !== true || typeof data.authorization_url !== "string" || !data.authorization_url.startsWith("https://")) {
      const msg = typeof r.json?.message === "string" ? r.json.message.slice(0, 160) : `HTTP ${r.status}`;
      return { ok: false, error: `Paystack : ${msg}` };
    }
    return { ok: true, redirectUrl: data.authorization_url, providerRef: data.reference ?? reference };
  },

  extractWebhookRefs(payload) {
    const data = ((payload as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
    const ref = data.reference ?? data.transaction_reference;
    const meta = data.metadata as { attemptId?: unknown } | undefined;
    return {
      providerRef: typeof ref === "string" ? ref : null,
      attemptId: typeof meta?.attemptId === "string" ? meta.attemptId : null,
    };
  },

  async verifyWebhook(rawBody, headers, creds, ctx): Promise<WebhookVerification> {
    if (!creds.secretKey || !paystackSignatureValid(creds.secretKey, rawBody, headers.get("x-paystack-signature"))) return { ok: false, error: "Signature Paystack invalide" };
    let evt: { event?: string; data?: Record<string, unknown> };
    try {
      evt = JSON.parse(rawBody) as typeof evt;
    } catch {
      return { ok: false, error: "Corps Paystack illisible" };
    }
    const data = evt.data ?? {};
    const reference = String(data.reference ?? data.transaction_reference ?? "");
    if (!reference) return { ok: false, error: "Référence Paystack absente" };
    if (ctx?.providerRef && reference !== ctx.providerRef) return { ok: false, error: "Référence Paystack inattendue pour cette tentative" };
    const type = String(evt.event ?? "unknown").slice(0, 60);
    const eventId = `${reference}:${type}:${String(data.id ?? data.status ?? "")}`.slice(0, 190);
    if (type !== "charge.success") {
      // refund.*, dispute… : tracés (idempotents) mais sans effet sur la tentative.
      return { ok: true, eventId, type, providerRef: reference, status: "PENDING", raw: evt };
    }
    // Statut et montant relus auprès de l'API (source de vérité) ; à défaut, le corps signé fait foi.
    const v = await verifyTransaction(reference, creds);
    const currency = String((v.found ? v.currency : undefined) ?? data.currency ?? ctx?.currency ?? "").toUpperCase();
    const status = mapPaystackStatus(v.found ? v.status : data.status);
    const amount = paystackFromMinor(v.found ? v.amount : data.amount, currency);
    return { ok: true, eventId, type, providerRef: reference, status, amount: amount ?? undefined, currency: currency || undefined, raw: evt };
  },

  async fetchStatus(providerRef, creds, ctx) {
    if (!creds.secretKey) return "UNKNOWN";
    const v = await verifyTransaction(providerRef, creds);
    if (!v.found) return v.httpStatus === 404 || v.httpStatus === 400 ? (isAbandoned(ctx) ? "EXPIRED" : "UNKNOWN") : "UNKNOWN";
    return mapPaystackStatus(v.status, ctx);
  },

  async refund(input, creds) {
    if (!creds.secretKey) return { ok: false, error: "Clé secrète manquante" };
    const r = await providerFetch(`${API}/refund`, {
      method: "POST",
      headers: authHeaders(creds),
      body: JSON.stringify({ transaction: input.providerRef, amount: paystackToMinor(input.amount, input.currency), merchant_note: (input.reason ?? `Remboursement ${input.refundId}`).slice(0, 200) }),
    });
    const net = networkErrorOf(r);
    if (net) return { ok: false, error: `Paystack injoignable (${net})` };
    if (!r.ok || r.json?.status !== true) return { ok: false, error: typeof r.json?.message === "string" ? r.json.message.slice(0, 160) : `HTTP ${r.status}` };
    const d = (r.json.data ?? {}) as { id?: unknown; status?: string };
    return { ok: true, providerRefundRef: String(d.id ?? ""), status: d.status === "processed" ? "DONE" : "PENDING" };
  },

  async testConnection(creds) {
    const mode = paystackMode(creds);
    if (!mode) return { ok: false, error: "La clé secrète Paystack doit commencer par sk_test_ (test) ou sk_live_ (production)." };
    const r = await providerFetch(`${API}/transaction?perPage=1`, { headers: authHeaders(creds) });
    const net = networkErrorOf(r);
    if (net) return { ok: false, error: `Paystack injoignable (${net}). Réessayez plus tard.` };
    if (r.status === 401) return { ok: false, error: "Clé secrète refusée par Paystack. Copiez-la à nouveau depuis Settings → API Keys & Webhooks." };
    if (!r.ok || r.json?.status !== true) return { ok: false, error: `Réponse inattendue de Paystack (HTTP ${r.status}).` };
    return {
      ok: true,
      message: mode === "test" ? "Connexion Paystack réussie en mode test (aucun argent réel)." : "Connexion Paystack réussie en production.",
      warnings: ["Déclarez l'URL de webhook ci-dessous dans Paystack (Settings → API Keys & Webhooks), sinon les paiements ne seront confirmés que par le rapprochement."],
    };
  },
};

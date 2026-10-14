import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayCredentials, GatewayId, PaymentGateway, WebhookVerification } from "./provider";
import { paystack } from "./adapters/paystack";
import { pawapay } from "./adapters/pawapay";
import { cinetpay } from "./adapters/cinetpay";

const LIVE_SANDBOX = [
  { value: "sandbox", label: "Test (sandbox)" },
  { value: "live", label: "Production" },
];

function hmacValid(secret: string, body: string, signature: string | null, algo: "sha256" = "sha256"): boolean {
  if (!signature) return false;
  const expected = createHmac(algo, secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.replace(/^sha256=/, ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

const NOT_CONFIGURED = (name: string) => ({
  ok: false as const,
  error: `${name} : adaptateur non finalisé. Complétez src/lib/payments/gateways.ts avec vos clés et la documentation du fournisseur.`,
});

/**
 * FedaPay (Bénin, Togo, Côte d'Ivoire…) — https://docs.fedapay.com
 * Flux : créer une transaction → générer un token/URL de paiement → webhook `transaction.approved`.
 */
export const fedapay: PaymentGateway = {
  id: "fedapay",
  label: "FedaPay",
  credentialFields: [
    { key: "secretKey", label: "Clé secrète (sk_live_…)", secret: true },
    { key: "webhookSecret", label: "Secret de webhook", secret: true },
    { key: "mode", label: "Environnement", secret: false, options: LIVE_SANDBOX },
  ],
  supportedCurrencies: ["XOF"],
  supportedCountries: ["BJ", "TG", "CI", "SN", "BF", "ML", "NE", "GN"],
  async initiate(input, creds) {
    if (!creds.secretKey) return NOT_CONFIGURED("FedaPay");
    const base = creds.mode === "sandbox" ? "https://sandbox-api.fedapay.com/v1" : "https://api.fedapay.com/v1";
    try {
      const res = await fetch(`${base}/transactions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          description: input.description,
          amount: input.amount,
          currency: { iso: input.currency },
          callback_url: input.returnUrl,
          customer: { firstname: input.customer.name, email: input.customer.email ?? undefined, phone_number: { number: input.customer.phone, country: "bj" } },
          custom_metadata: { attemptId: input.attemptId, reference: input.orderReference },
        }),
      });
      if (!res.ok) return { ok: false, error: `FedaPay ${res.status}` };
      const data = (await res.json()) as { "v1/transaction": { id: number } };
      const id = data["v1/transaction"].id;
      const tok = await fetch(`${base}/transactions/${id}/token`, { method: "POST", headers: { Authorization: `Bearer ${creds.secretKey}` } });
      if (!tok.ok) return { ok: false, error: `FedaPay token ${tok.status}` };
      const t = (await tok.json()) as { url: string };
      return { ok: true, redirectUrl: t.url, providerRef: String(id) };
    } catch (e) {
      return { ok: false, error: `FedaPay : ${(e as Error).message}` };
    }
  },
  async verifyWebhook(rawBody, headers, creds): Promise<WebhookVerification> {
    const sig = headers.get("x-fedapay-signature");
    if (!creds.webhookSecret || !hmacValid(creds.webhookSecret, rawBody, sig)) return { ok: false, error: "Signature FedaPay invalide" };
    const evt = JSON.parse(rawBody) as { id?: string; name: string; entity: { id: number; status: string; amount: number; currency?: { iso: string } } };
    const map: Record<string, "CONFIRMED" | "FAILED" | "PENDING" | "EXPIRED"> = { approved: "CONFIRMED", declined: "FAILED", canceled: "FAILED", pending: "PENDING", expired: "EXPIRED" };
    return {
      ok: true,
      eventId: evt.id ?? `${evt.name}:${evt.entity.id}:${evt.entity.status}`,
      type: evt.name,
      providerRef: String(evt.entity.id),
      status: map[evt.entity.status] ?? "PENDING",
      amount: evt.entity.amount,
      // FedaPay est configuré en XOF uniquement (supportedCurrencies) : devise implicite si absente du payload.
      currency: evt.entity.currency?.iso ?? "XOF",
      raw: evt,
    };
  },
  async fetchStatus(providerRef, creds) {
    if (!creds.secretKey) return "UNKNOWN";
    const base = creds.mode === "sandbox" ? "https://sandbox-api.fedapay.com/v1" : "https://api.fedapay.com/v1";
    const res = await fetch(`${base}/transactions/${providerRef}`, { headers: { Authorization: `Bearer ${creds.secretKey}` } });
    if (!res.ok) return "UNKNOWN";
    const data = (await res.json()) as { "v1/transaction": { status: string } };
    const s = data["v1/transaction"].status;
    return s === "approved" ? "CONFIRMED" : s === "pending" ? "PENDING" : s === "expired" ? "EXPIRED" : "FAILED";
  },
};

/**
 * KkiaPay (Bénin) — https://docs.kkiapay.me
 * Paiement via widget côté client + vérification serveur obligatoire (`/api/v1/transactions/status`).
 */
export const kkiapay: PaymentGateway = {
  id: "kkiapay",
  label: "KkiaPay",
  credentialFields: [
    { key: "publicKey", label: "Clé publique", secret: false },
    { key: "privateKey", label: "Clé privée", secret: true },
    { key: "secret", label: "Secret", secret: true },
    { key: "mode", label: "Environnement", secret: false, options: LIVE_SANDBOX },
  ],
  supportedCurrencies: ["XOF"],
  supportedCountries: ["BJ", "CI", "SN", "TG"],
  async initiate() {
    // KkiaPay fonctionne par widget : la page checkout charge le widget avec publicKey et
    // envoie la transactionId au serveur, qui appelle fetchStatus avant tout « PAID ».
    return NOT_CONFIGURED("KkiaPay");
  },
  async verifyWebhook(rawBody, headers, creds): Promise<WebhookVerification> {
    const sig = headers.get("x-kkiapay-signature") ?? headers.get("x-signature");
    if (!creds.secret || !hmacValid(creds.secret, rawBody, sig)) return { ok: false, error: "Signature KkiaPay invalide" };
    const evt = JSON.parse(rawBody) as { transactionId: string; event: string; status?: string; amount?: number };
    const status = evt.event === "transaction.success" || evt.status === "SUCCESS" ? "CONFIRMED" : evt.event?.includes("fail") ? "FAILED" : "PENDING";
    // KkiaPay n'opère qu'en XOF : devise implicite. Le montant reste obligatoire pour confirmer (m12).
    return { ok: true, eventId: `${evt.transactionId}:${evt.event}`, type: evt.event, providerRef: evt.transactionId, status, amount: evt.amount, currency: "XOF", raw: evt };
  },
  async fetchStatus(providerRef, creds) {
    if (!creds.privateKey) return "UNKNOWN";
    const base = creds.mode === "sandbox" ? "https://api-sandbox.kkiapay.me" : "https://api.kkiapay.me";
    const res = await fetch(`${base}/api/v1/transactions/status`, {
      method: "POST",
      headers: { "x-api-key": creds.publicKey ?? "", "x-private-key": creds.privateKey, "x-secret-key": creds.secret ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: providerRef }),
    });
    if (!res.ok) return "UNKNOWN";
    const data = (await res.json()) as { status: string };
    return data.status === "SUCCESS" ? "CONFIRMED" : data.status === "PENDING" ? "PENDING" : "FAILED";
  },
};

/** API de confirmation PayDunya : statut et montant faisant foi (jamais ceux du webhook). */
async function paydunyaConfirm(token: string, creds: GatewayCredentials): Promise<{ status: string; mapped: "CONFIRMED" | "FAILED" | "PENDING" | "EXPIRED"; amount?: number } | null> {
  if (!creds.masterKey || !creds.privateKey || !creds.token) return null;
  const base = creds.mode === "live" ? "https://app.paydunya.com/api/v1" : "https://app.paydunya.com/sandbox-api/v1";
  try {
    const res = await fetch(`${base}/checkout-invoice/confirm/${encodeURIComponent(token)}`, {
      headers: { "PAYDUNYA-MASTER-KEY": creds.masterKey, "PAYDUNYA-PRIVATE-KEY": creds.privateKey, "PAYDUNYA-TOKEN": creds.token },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response_code?: string; status?: string; invoice?: { total_amount?: number | string } };
    if (data.response_code !== "00" || !data.status) return null;
    const mapped = data.status === "completed" ? "CONFIRMED" : data.status === "cancelled" ? "FAILED" : data.status === "expired" ? "EXPIRED" : "PENDING";
    const amount = data.invoice?.total_amount != null ? Number(data.invoice.total_amount) : undefined;
    return { status: data.status, mapped, amount: Number.isFinite(amount) ? amount : undefined };
  } catch {
    return null;
  }
}

/** PayDunya (Sénégal, CI, Bénin, Togo…) — https://developers.paydunya.com */
export const paydunya: PaymentGateway = {
  id: "paydunya",
  label: "PayDunya",
  credentialFields: [
    { key: "masterKey", label: "Master key", secret: true },
    { key: "privateKey", label: "Clé privée", secret: true },
    { key: "token", label: "Token", secret: true },
    { key: "mode", label: "Environnement", secret: false, options: [{ value: "test", label: "Test" }, { value: "live", label: "Production" }] },
  ],
  supportedCurrencies: ["XOF"],
  supportedCountries: ["SN", "CI", "BJ", "TG", "BF", "ML"],
  async initiate() {
    return NOT_CONFIGURED("PayDunya");
  },
  async verifyWebhook(rawBody, _headers, creds): Promise<WebhookVerification> {
    // PayDunya envoie un hash SHA-512 du master key dans le payload (data.hash). Ce hash est STATIQUE
    // (rejouable) : il authentifie l'émetteur mais pas l'événement. Le statut et le montant sont donc
    // toujours relus via l'API de confirmation PayDunya (m13), jamais pris dans le payload.
    const evt = JSON.parse(rawBody) as { data?: { hash?: string; status?: string; invoice?: { token?: string; total_amount?: number | string } } };
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha512").update(creds.masterKey ?? "").digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(String(evt.data?.hash ?? ""));
    if (!creds.masterKey || a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: "Hash PayDunya invalide" };
    const token = evt.data?.invoice?.token ?? "";
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(token)) return { ok: false, error: "Jeton PayDunya invalide" };
    const confirmed = await paydunyaConfirm(token, creds);
    if (!confirmed) return { ok: false, error: "Statut PayDunya non vérifiable (API de confirmation)" };
    return { ok: true, eventId: `${token}:${confirmed.status}`, type: `invoice.${confirmed.status}`, providerRef: token, status: confirmed.mapped, amount: confirmed.amount, currency: "XOF", raw: evt };
  },
  async fetchStatus(providerRef, creds) {
    const r = await paydunyaConfirm(providerRef, creds);
    return r ? r.mapped : "UNKNOWN";
  },
};

/** Stripe (cartes, diaspora, EUR) — https://docs.stripe.com/webhooks */
export const stripe: PaymentGateway = {
  id: "stripe",
  label: "Stripe",
  credentialFields: [
    { key: "secretKey", label: "Clé secrète (sk_…)", secret: true },
    { key: "webhookSecret", label: "Secret de webhook (whsec_…)", secret: true },
  ],
  supportedCurrencies: ["EUR", "USD", "XOF"],
  supportedCountries: ["FR", "BJ", "CI", "SN"],
  async initiate(input, creds) {
    if (!creds.secretKey) return NOT_CONFIGURED("Stripe");
    const zeroDecimal = ["XOF", "XAF"].includes(input.currency);
    const params = new URLSearchParams({
      mode: "payment",
      success_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(zeroDecimal ? input.amount : input.amount),
      "line_items[0][price_data][product_data][name]": input.description,
      "line_items[0][quantity]": "1",
      "metadata[attemptId]": input.attemptId,
      "metadata[reference]": input.orderReference,
      client_reference_id: input.attemptId,
    });
    if (input.customer.email) params.set("customer_email", input.customer.email);
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) return { ok: false, error: `Stripe ${res.status}` };
    const s = (await res.json()) as { id: string; url: string };
    return { ok: true, redirectUrl: s.url, providerRef: s.id };
  },
  async verifyWebhook(rawBody, headers, creds): Promise<WebhookVerification> {
    const header = headers.get("stripe-signature") ?? "";
    const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
    const t = parts.t;
    const v1 = parts.v1;
    if (!creds.webhookSecret || !t || !v1) return { ok: false, error: "Signature Stripe absente" };
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return { ok: false, error: "Signature Stripe expirée" };
    if (!hmacValid(creds.webhookSecret, `${t}.${rawBody}`, v1)) return { ok: false, error: "Signature Stripe invalide" };
    const evt = JSON.parse(rawBody) as { id: string; type: string; data: { object: { id: string; payment_status?: string; amount_total?: number; currency?: string } } };
    const status = evt.type === "checkout.session.completed" && evt.data.object.payment_status === "paid" ? "CONFIRMED" : evt.type === "checkout.session.expired" ? "EXPIRED" : "PENDING";
    return { ok: true, eventId: evt.id, type: evt.type, providerRef: evt.data.object.id, status, amount: evt.data.object.amount_total, currency: evt.data.object.currency?.toUpperCase(), raw: evt };
  },
  async fetchStatus(providerRef, creds) {
    if (!creds.secretKey) return "UNKNOWN";
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${providerRef}`, { headers: { Authorization: `Bearer ${creds.secretKey}` } });
    if (!res.ok) return "UNKNOWN";
    const s = (await res.json()) as { payment_status: string; status: string };
    return s.payment_status === "paid" ? "CONFIRMED" : s.status === "expired" ? "EXPIRED" : "PENDING";
  },
};

/** Ordre d'affichage : agrégateurs Wave / Orange Money (lot 1 bis) puis passerelles historiques. */
export const GATEWAYS: Record<GatewayId, PaymentGateway> = { paystack, pawapay, cinetpay, fedapay, kkiapay, paydunya, stripe };

export { paystack, pawapay, cinetpay };

export function getGateway(id: string): PaymentGateway | null {
  return (GATEWAYS as Record<string, PaymentGateway>)[id] ?? null;
}

export function gatewayCredentials(json: string | null | undefined): GatewayCredentials {
  if (!json) return {};
  try {
    return JSON.parse(json) as GatewayCredentials;
  } catch {
    return {};
  }
}

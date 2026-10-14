import { createHash, randomUUID } from "node:crypto";
import { SITE } from "@/config/site";
import type { GatewayCredentials, GatewayStatus, PaymentGateway, StatusContext, WebhookVerification } from "../provider";
import { ISO3, PAWAPAY_CHANNELS, pawapayProvider } from "../channels";
import { alnumText, digitsOnly, fromMajor, isAbandoned, networkErrorOf, providerFetch, safeEqualStr, toMajorString } from "./util";

/**
 * pawaPay — dépôts Mobile Money multi-pays (Wave, Orange, MTN, Moov…), API v2.
 *
 * Source officielle : https://docs.pawapay.io (index llms.txt, pages .md, consultées le 11/10/2026)
 *  - sandbox https://api.sandbox.pawapay.io, production https://api.pawapay.io, jeton Bearer ;
 *  - POST /v2/paymentpage (page de paiement hébergée, session 15 min, `depositId` UUIDv4 fourni par nous) ;
 *  - POST /v2/deposits (demande poussée sur le téléphone : PROVIDER_AUTH) ;
 *  - GET /v2/deposits/{depositId} → { status: FOUND | NOT_FOUND, data: { status: ACCEPTED | PROCESSING |
 *    IN_RECONCILIATION | COMPLETED | FAILED, amount, currency, … } } ;
 *  - callback POST (statut final) vers l'URL déclarée dans le tableau de bord pawaPay ;
 *  - POST /v2/refunds ; GET /v2/active-conf (configuration du compte, sert au test de connexion).
 *
 * Authenticité du callback : le corps n'est JAMAIS cru sur parole. Le statut et le montant sont relus
 * via GET /v2/deposits/{depositId} avec le jeton de la boutique (source de vérité), après contrôle de
 * l'empreinte `Content-Digest` quand elle est présente.
 */

const BASE = { sandbox: "https://api.sandbox.pawapay.io", live: "https://api.pawapay.io" } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Session de page de paiement : 15 min (doc), marge incluse avant de la déclarer expirée. */
const PAGE_EXPIRY_MS = 20 * 60_000;

export function pawapayBase(creds: GatewayCredentials): string {
  return creds.mode === "live" ? BASE.live : BASE.sandbox;
}

function headersOf(creds: GatewayCredentials) {
  return { Authorization: `Bearer ${creds.apiToken}`, "Content-Type": "application/json", Accept: "application/json" };
}

/**
 * `Content-Digest` (RFC 9530) : « sha-512=:<base64>:, sha-256=:<base64>: ». Vrai si au moins un algorithme
 * pris en charge correspond au corps brut ; faux si l'en-tête est présent mais ne correspond pas.
 */
export function pawapayContentDigestValid(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  for (const part of header.split(",")) {
    const m = /^\s*(sha-512|sha-256)\s*=\s*:([A-Za-z0-9+/=]+):\s*$/i.exec(part);
    if (!m) continue;
    const algo = m[1].toLowerCase() === "sha-512" ? "sha512" : "sha256";
    const expected = createHash(algo).update(rawBody, "utf8").digest("base64");
    if (safeEqualStr(expected, m[2])) return true;
  }
  return false;
}

/** Résultat de GET /v2/deposits/{id} → statut Axi. Une page abandonnée reste NOT_FOUND (pas de callback). */
export function mapPawapayDeposit(search: unknown, dataStatus: unknown, ctx?: StatusContext, now = Date.now()): GatewayStatus {
  if (search === "NOT_FOUND") return isAbandoned(ctx, now, PAGE_EXPIRY_MS) ? "EXPIRED" : "PENDING";
  switch (dataStatus) {
    case "COMPLETED":
      return "CONFIRMED";
    case "FAILED":
      return "FAILED";
    default:
      // ACCEPTED | PROCESSING | IN_RECONCILIATION | inconnu : jamais final.
      return "PENDING";
  }
}

const FAILURE_FR: Record<string, string> = {
  INVALID_PHONE_NUMBER: "numéro de téléphone invalide pour cet opérateur",
  AMOUNT_OUT_OF_BOUNDS: "montant hors des limites de l'opérateur",
  INVALID_AMOUNT: "montant non accepté par l'opérateur",
  INVALID_CURRENCY: "devise non prise en charge par l'opérateur",
  PROVIDER_TEMPORARILY_UNAVAILABLE: "opérateur momentanément indisponible, réessayez plus tard",
  DEPOSITS_NOT_ALLOWED: "encaissement non activé sur le compte pawaPay pour cet opérateur",
  AUTHENTICATION_ERROR: "jeton d'API refusé",
  NO_AUTHENTICATION: "jeton d'API absent",
  AUTHORISATION_ERROR: "jeton d'API non autorisé pour cette opération",
  INVALID_PROVIDER: "opérateur non disponible",
};

function failureOf(json: Record<string, unknown> | null, status: number): string {
  const fr = json?.failureReason as { failureCode?: string; failureMessage?: string } | undefined;
  const code = fr?.failureCode ?? "";
  return FAILURE_FR[code] ?? (fr?.failureMessage ? String(fr.failureMessage).slice(0, 160) : `HTTP ${status}`);
}

/**
 * `depositId` DÉTERMINISTE par tentative (UUID v4-formaté dérivé de `attemptId`, aucun aléa).
 *
 * M : un identifiant neuf à chaque initiation désactive l'idempotence de pawaPay (`DUPLICATE_IGNORED`). Si la
 * demande aboutit chez pawaPay mais que la réponse dépasse notre délai réseau (la tentative repasse alors en
 * PENDING) et que le client reclique, deux push USSD sont envoyés et le client est débité deux fois. Avec un
 * identifiant dérivé de la tentative, la seconde initiation porte le MÊME `depositId` : pawaPay la refuse comme
 * doublon (aucun second débit) et notre rapprochement (callback, `fetchStatus`) retrouve le dépôt d'origine.
 * Une NOUVELLE tentative (échec définitif, expiration) a un nouvel `attemptId`, donc un nouveau dépôt.
 */
export function pawapayDepositId(attemptId: string): string {
  const h = createHash("sha256").update(`axi:pawapay:deposit:${attemptId}`, "utf8").digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function metadataOf(attemptId: string, orderReference: string) {
  return [{ attemptId }, { orderReference }];
}

async function readDeposit(depositId: string, creds: GatewayCredentials) {
  const r = await providerFetch(`${pawapayBase(creds)}/v2/deposits/${encodeURIComponent(depositId)}`, { headers: headersOf(creds) });
  if (networkErrorOf(r) || !r.ok || !r.json) return null;
  const data = (r.json.data ?? {}) as { status?: string; amount?: unknown; currency?: string; depositId?: string };
  return { search: r.json.status, status: data.status, amount: data.amount, currency: data.currency, depositId: data.depositId };
}

export const pawapay: PaymentGateway = {
  id: "pawapay",
  label: "pawaPay",
  credentialFields: [
    { key: "apiToken", label: "Jeton d'API", secret: true, hint: "Tableau de bord pawaPay → System configuration → API tokens. Le jeton sandbox ne fonctionne qu'en mode Test." },
    {
      key: "mode",
      label: "Environnement",
      secret: false,
      options: [
        { value: "sandbox", label: "Test (sandbox)" },
        { value: "live", label: "Production" },
      ],
    },
  ],
  supportedCurrencies: ["XOF", "XAF"],
  supportedCountries: Object.keys(PAWAPAY_CHANNELS),
  channelsByCountry: PAWAPAY_CHANNELS,
  docsUrl: "https://docs.pawapay.io/v2/docs/payment_page",
  modeOf: (creds) => (creds.mode === "live" ? "live" : creds.apiToken ? "test" : null),

  async initiate(input, creds) {
    if (!creds.apiToken) return { ok: false, error: "pawaPay : jeton d'API manquant." };
    if (!supportsCurrency(input.currency)) return { ok: false, error: `pawaPay : devise ${input.currency} non prise en charge.` };
    const depositId = pawapayDepositId(input.attemptId);
    const amount = toMajorString(input.amount, input.currency);
    const customerMessage = alnumText(`Commande ${input.orderReference}`, 22);
    const phone = digitsOnly(input.payerPhone);
    const provider = pawapayProvider(input.country, input.channel);
    const allowed = !input.channels?.length || (input.channel ? input.channels.includes(input.channel) : false);

    // Demande poussée sur le téléphone (USSD / notification) : seulement si l'opérateur l'autorise sans
    // redirection (PROVIDER_AUTH) et que le client a donné son numéro et son portefeuille.
    if (provider && provider.auth === "PROVIDER_AUTH" && phone.length >= 8 && allowed) {
      const r = await providerFetch(`${pawapayBase(creds)}/v2/deposits`, {
        method: "POST",
        headers: headersOf(creds),
        body: JSON.stringify({
          depositId,
          amount,
          currency: input.currency,
          payer: { type: "MMO", accountDetails: { phoneNumber: phone, provider: provider.code } },
          clientReferenceId: input.orderReference,
          ...(customerMessage.length >= 4 ? { customerMessage } : {}),
          metadata: metadataOf(input.attemptId, input.orderReference),
        }),
      });
      const net = networkErrorOf(r);
      if (net) return { ok: false, error: `pawaPay injoignable (${net}). Réessayez dans un instant.` };
      const st = r.json?.status;
      if (r.ok && (st === "ACCEPTED" || st === "DUPLICATE_IGNORED")) return { ok: true, redirectUrl: input.returnUrl, providerRef: depositId, pushed: true };
      return { ok: false, error: `pawaPay : ${failureOf(r.json, r.status)}` };
    }

    // Page de paiement hébergée : le client choisit son opérateur et saisit son numéro.
    const iso3 = input.country ? ISO3[input.country] : undefined;
    const r = await providerFetch(`${pawapayBase(creds)}/v2/paymentpage`, {
      method: "POST",
      headers: headersOf(creds),
      body: JSON.stringify({
        depositId,
        returnUrl: input.returnUrl,
        ...(customerMessage.length >= 4 ? { customerMessage } : {}),
        amountDetails: { amount, currency: input.currency },
        ...(iso3 ? { country: iso3 } : {}),
        ...(phone.length >= 8 && iso3 ? { phoneNumber: phone } : {}),
        language: "FR",
        reason: `Commande ${input.orderReference}`.slice(0, 50),
        metadata: metadataOf(input.attemptId, input.orderReference),
      }),
    });
    const net = networkErrorOf(r);
    if (net) return { ok: false, error: `pawaPay injoignable (${net}). Réessayez dans un instant.` };
    // Doublon : le dépôt déterministe de cette tentative existe déjà chez pawaPay (page déjà ouverte).
    if (r.json?.status === "DUPLICATE_IGNORED") return { ok: false, error: "pawaPay : un paiement est déjà en cours pour cette commande. Terminez-le ou réessayez dans quelques minutes." };
    const url = r.json?.redirectUrl;
    if (!r.ok || r.json?.status === "REJECTED" || typeof url !== "string" || !url.startsWith("https://")) return { ok: false, error: `pawaPay : ${failureOf(r.json, r.status)}` };
    return { ok: true, redirectUrl: url, providerRef: depositId };
  },

  extractWebhookRefs(payload) {
    const p = (payload ?? {}) as { depositId?: unknown };
    return { providerRef: typeof p.depositId === "string" ? p.depositId : null };
  },

  async verifyWebhook(rawBody, headers, creds, ctx): Promise<WebhookVerification> {
    if (!creds.apiToken) return { ok: false, error: "pawaPay : jeton d'API manquant" };
    const digest = headers.get("content-digest");
    if (digest && !pawapayContentDigestValid(rawBody, digest)) return { ok: false, error: "Empreinte Content-Digest pawaPay invalide" };
    let body: { depositId?: unknown; status?: unknown };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      return { ok: false, error: "Corps pawaPay illisible" };
    }
    const depositId = typeof body.depositId === "string" ? body.depositId : "";
    if (!UUID_RE.test(depositId)) return { ok: false, error: "depositId pawaPay invalide" };
    if (ctx?.providerRef && depositId !== ctx.providerRef) return { ok: false, error: "depositId inattendu pour cette tentative" };
    // POINT D'INTÉGRATION (défense en profondeur, facultatif) : signature RFC 9421 des callbacks
    // (en-têtes Signature / Signature-Input, clé publique GET /v2/public-key/http). Non exigée ici :
    // la relecture authentifiée ci-dessous fait foi et ne dépend pas du nom d'hôte vu derrière un proxy.
    const d = await readDeposit(depositId, creds);
    if (!d) return { ok: false, error: "Statut pawaPay non vérifiable (API de dépôt injoignable ou jeton refusé)" };
    if (d.search === "FOUND" && d.depositId && d.depositId !== depositId) return { ok: false, error: "Réponse pawaPay incohérente" };
    const status = mapPawapayDeposit(d.search, d.status);
    const currency = typeof d.currency === "string" ? d.currency.toUpperCase() : undefined;
    const amount = currency ? fromMajor(d.amount, currency) : null;
    const apiStatus = String(d.status ?? d.search ?? "UNKNOWN").slice(0, 30);
    return { ok: true, eventId: `${depositId}:${apiStatus}`, type: `deposit.${apiStatus.toLowerCase()}`, providerRef: depositId, status, amount: amount ?? undefined, currency, raw: body };
  },

  async fetchStatus(providerRef, creds, ctx) {
    if (!creds.apiToken || !UUID_RE.test(providerRef)) return "UNKNOWN";
    const d = await readDeposit(providerRef, creds);
    if (!d) return "UNKNOWN";
    return mapPawapayDeposit(d.search, d.status, ctx);
  },

  async refund(input, creds) {
    if (!creds.apiToken) return { ok: false, error: "Jeton d'API manquant" };
    if (!UUID_RE.test(input.providerRef)) return { ok: false, error: "Référence de dépôt invalide" };
    const refundId = randomUUID();
    const r = await providerFetch(`${pawapayBase(creds)}/v2/refunds`, {
      method: "POST",
      headers: headersOf(creds),
      body: JSON.stringify({ refundId, depositId: input.providerRef, amount: toMajorString(input.amount, input.currency), currency: input.currency, clientReferenceId: input.refundId, metadata: [{ refundId: input.refundId }] }),
    });
    const net = networkErrorOf(r);
    if (net) return { ok: false, error: `pawaPay injoignable (${net})` };
    const st = r.json?.status;
    if (r.ok && (st === "ACCEPTED" || st === "DUPLICATE_IGNORED")) return { ok: true, providerRefundRef: refundId, status: "PENDING" };
    return { ok: false, error: failureOf(r.json, r.status) };
  },

  async testConnection(creds) {
    if (!creds.apiToken) return { ok: false, error: "Saisissez le jeton d'API pawaPay." };
    const r = await providerFetch(`${pawapayBase(creds)}/v2/active-conf`, { headers: headersOf(creds) });
    const net = networkErrorOf(r);
    if (net) return { ok: false, error: `pawaPay injoignable (${net}). Réessayez plus tard.` };
    if (r.status === 401 || r.status === 403) {
      return { ok: false, error: `Jeton refusé par pawaPay (${creds.mode === "live" ? "production" : "sandbox"}). Un jeton sandbox ne fonctionne qu'en mode Test, et inversement.` };
    }
    if (!r.ok || !r.json) return { ok: false, error: `Réponse inattendue de pawaPay (HTTP ${r.status}).` };
    const countries = (Array.isArray(r.json.countries) ? r.json.countries : []) as { country?: string; providers?: { currencies?: { operationTypes?: unknown[] }[] }[] }[];
    const expected = `${SITE.url.replace(/\/$/, "")}/api/webhooks/payments/pawapay`;
    const callbackUrls = new Set<string>();
    for (const c of countries) for (const p of c.providers ?? []) for (const cur of p.currencies ?? []) for (const op of cur.operationTypes ?? []) collectCallback(op, callbackUrls);
    const warnings: string[] = [];
    if (countries.length === 0) warnings.push("Aucun pays n'est encore activé sur ce compte pawaPay.");
    if (!callbackUrls.has(expected)) warnings.push(`URL de rappel des dépôts à déclarer dans pawaPay : ${expected}`);
    const company = typeof r.json.companyName === "string" ? ` (${r.json.companyName.slice(0, 60)})` : "";
    const list = countries.map((c) => c.country).filter(Boolean).join(", ");
    return { ok: true, message: `Connexion pawaPay réussie${company}, ${creds.mode === "live" ? "production" : "mode test"}${list ? ` : ${list}` : ""}.`, warnings };
  },
};

function supportsCurrency(currency: string): boolean {
  return currency === "XOF" || currency === "XAF";
}

/** Les opérations de active-conf ont deux formes documentées : { DEPOSIT: {...} } ou { operationType, callbackUrl }. */
function collectCallback(op: unknown, out: Set<string>) {
  if (!op || typeof op !== "object") return;
  const o = op as Record<string, unknown>;
  if (o.operationType === "DEPOSIT" && typeof o.callbackUrl === "string") out.add(o.callbackUrl);
  const dep = o.DEPOSIT as { callbackUrl?: unknown } | undefined;
  if (dep && typeof dep.callbackUrl === "string") out.add(dep.callbackUrl);
}

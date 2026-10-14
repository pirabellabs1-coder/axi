import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secret de signature d'une application externe et signature HMAC des redirections d'installation.
 * Module PUR (aucun accès base ni `server-only`) : importable par les tests et par le serveur d'app de recette.
 * Contrat publié : docs/apps-v2/int.md.
 *
 * Secret de signature (`whsec_…`) : dérivé de APP_SECRET, de l'identifiant de l'app ET de l'empreinte du client_secret
 * (`OAuthClient.clientSecretHash`) — HMAC-SHA256, séparation de domaine « axi-app-signing:v2 ». Aucune colonne n'existe
 * pour le stocker (schéma gelé) : il est recalculable à la demande et affiché par le portail (onglet Identifiants).
 * Rotation : régénérer le client_secret change l'empreinte, donc renouvelle aussi ce secret.
 * Il signe (1) la redirection d'installation (`hmac`) et (2) les webhooks de cycle de vie (`Axi-Webhook-Signature`).
 */

const SIGNING_DOMAIN = "axi-app-signing:v2:";
/** Tolérance sur `timestamp` (anti-rejeu) recommandée au développeur. */
export const INSTALL_HMAC_TOLERANCE_SEC = 300;

function platformSecret(appSecret?: string): string {
  const s = appSecret ?? process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET manquant ou trop court (32 caractères minimum).");
  return s;
}

/**
 * Secret de signature de l'app : `whsec_` + 43 caractères base64url (même format que les webhooks de boutique).
 * `clientSecretHash` : empreinte actuelle du client_secret (null si l'app n'a pas de secret) — sa rotation fait tourner ce secret.
 */
export function appSigningSecret(appId: string, clientSecretHash: string | null, appSecret?: string): string {
  const raw = createHmac("sha256", platformSecret(appSecret)).update(`${SIGNING_DOMAIN}${appId}:${clientSecretHash ?? ""}`, "utf8").digest("base64url");
  return `whsec_${raw}`;
}

/**
 * Chaîne canonique signée (non ambiguë) : paramètres (hors `hmac` et `signature`) triés par nom (ordre des codes
 * UTF-16), puis RÉENCODÉS en `application/x-www-form-urlencoded` (`new URLSearchParams(triés).toString()`) : un `&` ou
 * un `=` dans une valeur est encodé et ne peut donc pas fabriquer un faux paramètre. Exemple :
 *   code=axi_code_…&host=https%3A%2F%2Faxi.africa&shop=chez-aicha&state=…&timestamp=1760000000
 */
export function canonicalInstallQuery(params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort()
    .map((k): [string, string] => [k, params[k]]);
  return new URLSearchParams(sorted).toString();
}

/** hmac = hex(HMAC-SHA256(secret de signature, chaîne canonique)). */
export function signInstallQuery(params: Record<string, string>, signingSecret: string): string {
  return createHmac("sha256", signingSecret).update(canonicalInstallQuery(params), "utf8").digest("hex");
}

export type InstallQueryCheck = { ok: true } | { ok: false; reason: "missing_hmac" | "bad_hmac" | "missing_timestamp" | "timestamp_out_of_tolerance" };

/** Vérification (référence pour le développeur) : hmac en temps constant puis fraîcheur du `timestamp`. */
export function verifyInstallQuery(
  params: Record<string, string>,
  signingSecret: string,
  opts: { nowSec?: number; toleranceSec?: number } = {},
): InstallQueryCheck {
  const given = params.hmac;
  if (!given || !/^[0-9a-f]{64}$/.test(given)) return { ok: false, reason: "missing_hmac" };
  const expected = Buffer.from(signInstallQuery(params, signingSecret), "hex");
  const got = Buffer.from(given, "hex");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: "bad_hmac" };
  const ts = Number(params.timestamp);
  if (!params.timestamp || !Number.isInteger(ts)) return { ok: false, reason: "missing_timestamp" };
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (opts.toleranceSec ?? INSTALL_HMAC_TOLERANCE_SEC)) return { ok: false, reason: "timestamp_out_of_tolerance" };
  return { ok: true };
}

/** `state` opaque généré par Axi pour une installation lancée depuis Axi (24 octets base64url). */
export function generateInstallState(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * URL de redirection d'installation : `redirectUri` + `code`, `shop`, `state`, `timestamp`, `host`, `hmac`.
 * Règle simple pour le développeur : TOUS les paramètres de la requête reçue, sauf `hmac`, sont signés (y compris
 * ceux déjà présents dans l'URI de redirection enregistrée).
 */
export function buildInstallRedirect(
  redirectUri: string,
  p: { code: string; shop: string; state: string; host: string; timestamp?: number },
  signingSecret: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.delete("hmac");
  url.searchParams.delete("signature");
  const ours: Record<string, string> = {
    code: p.code,
    host: p.host,
    shop: p.shop,
    state: p.state,
    timestamp: String(p.timestamp ?? Math.floor(Date.now() / 1000)),
  };
  for (const [k, v] of Object.entries(ours)) url.searchParams.set(k, v);
  // Une seule valeur par nom (dernière gagnante) : la requête reçue correspond exactement à ce qui est signé.
  const signed = Object.fromEntries(url.searchParams);
  url.search = new URLSearchParams(signed).toString();
  url.searchParams.set("hmac", signInstallQuery(signed, signingSecret));
  return url.toString();
}

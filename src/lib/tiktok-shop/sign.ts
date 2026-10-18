import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature des requêtes Open API TikTok Shop (versions 202309 et suivantes) — fonction PURE.
 *
 *  1. paramètres de requête hors `sign`, `access_token` et `x-tts-access-token`, triés par nom ;
 *  2. chaîne = chemin + concaténation `nom` + `valeur` ;
 *  3. corps brut ajouté tel qu'envoyé, sauf `multipart/form-data` (téléversement d'image) ;
 *  4. chaîne encadrée par l'app_secret (secret + chaîne + secret) ;
 *  5. HMAC-SHA256 (clé = app_secret), hexadécimal minuscule.
 * Source : Partner Center « Sign your API request » (https://partner.tiktokshop.com/docv2/page/sign-your-api-request), conforme au SDK EcomPHP/tiktokshop-php (Client::prepareSignature).
 */
export function signRequest(p: { path: string; query: Record<string, string>; body?: string | null; contentType?: string | null; appSecret: string }): string {
  const keys = Object.keys(p.query)
    .filter((k) => k !== "sign" && k !== "access_token" && k !== "x-tts-access-token")
    .sort();
  let input = p.path + keys.map((k) => `${k}${p.query[k]}`).join("");
  const multipart = (p.contentType ?? "").toLowerCase().startsWith("multipart/form-data");
  if (p.body && !multipart) input += p.body;
  return createHmac("sha256", p.appSecret).update(`${p.appSecret}${input}${p.appSecret}`).digest("hex");
}

/**
 * Signature des notifications (webhooks) : en-tête `Authorization` = HMAC-SHA256(app_secret, app_key + corps brut), hex.
 */
export function webhookSignature(appKey: string, appSecret: string, rawBody: string | Buffer): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  return createHmac("sha256", appSecret).update(Buffer.concat([Buffer.from(appKey, "utf8"), body])).digest("hex");
}

/** Comparaison en temps constant ; une signature absente ou mal formée est refusée. */
export function verifyWebhookSignature(p: { appKey: string; appSecret: string; rawBody: string | Buffer; header: string | null | undefined }): boolean {
  const given = String(p.header ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = webhookSignature(p.appKey, p.appSecret, p.rawBody);
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

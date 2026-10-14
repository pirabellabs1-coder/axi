import { createHash, createHmac } from "node:crypto";

/**
 * Signature AWS Signature Version 4 (en-tête Authorization), écrite avec node:crypto pour éviter
 * le SDK AWS (plusieurs Mo de dépendances pour un PUT et un HEAD). Compatible avec tous les
 * fournisseurs « S3 » : AWS, Cloudflare R2, Supabase Storage, Backblaze B2, MinIO.
 *
 * Référence : https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
 * Vérifiée par les vecteurs officiels (tests/storage-sigv4.test.ts).
 */

export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type SigV4Input = {
  method: string;
  /** Hôte (avec port éventuel), tel qu'envoyé dans l'en-tête Host. */
  host: string;
  /** Chemin NON encodé (`/bucket/stores/x/…`) : chaque segment est encodé selon les règles AWS. */
  path: string;
  query?: Record<string, string>;
  /** En-têtes supplémentaires à signer (noms insensibles à la casse). `host` et `x-amz-date` sont ajoutés. */
  headers?: Record<string, string>;
  /** Hash hexadécimal SHA-256 du corps (ou UNSIGNED-PAYLOAD). */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  date?: Date;
};

export type SignedRequest = {
  /** En-têtes à envoyer (dont Authorization et x-amz-date ; Host est posé par fetch). */
  headers: Record<string, string>;
  authorization: string;
  signature: string;
  canonicalRequest: string;
  stringToSign: string;
};

/** Encodage URI AWS : tout sauf A-Z a-z 0-9 - _ . ~ (et `/` dans les chemins). */
export function awsUriEncode(input: string, encodeSlash = true): string {
  let out = "";
  for (const byte of Buffer.from(input, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(ch) || (ch === "/" && !encodeSlash)) out += ch;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** `20130524T000000Z` */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), service), "aws4_request");
}

export function signV4(input: SigV4Input): SignedRequest {
  const now = amzDate(input.date ?? new Date());
  const dateStamp = now.slice(0, 8);

  const all: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) all[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  all.host = input.host;
  all["x-amz-date"] = now;
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n]}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalQuery = Object.entries(input.query ?? {})
    .map(([k, v]) => [awsUriEncode(k), awsUriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalUri = awsUriEncode(input.path.startsWith("/") ? input.path : `/${input.path}`, false);
  const canonicalRequest = [input.method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, input.payloadHash].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(input.secretAccessKey, dateStamp, input.region, input.service)).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {};
  for (const n of names) if (n !== "host") headers[n] = all[n];
  headers.authorization = authorization;
  return { headers, authorization, signature, canonicalRequest, stringToSign };
}

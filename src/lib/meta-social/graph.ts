import "server-only";
import { createHmac } from "node:crypto";
import { GRAPH_VERSION } from "@/lib/social/graph-client";
import { metaAppSecret, socialLoginConfig } from "./config";

/**
 * Client Graph API pour les Pages Facebook et comptes Instagram pro (Facebook Login for Business).
 * `fetchImpl` injectable (tests). Délai court : la réponse privée d'un commentaire de live Instagram n'est
 * possible que PENDANT la diffusion, et le webhook doit répondre vite à Meta.
 *
 * Sécurité : le jeton passe dans l'en-tête Authorization (jamais dans l'URL, jamais journalisé) ;
 * `appsecret_proof` est joint à chaque appel porteur d'un jeton (compatible avec « Exiger la clé secrète »).
 * Les messages d'erreur ne contiennent que le message nettoyé de Meta.
 */

const TIMEOUT_MS = 8_000;
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MetaGraphError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: number | null,
    public subcode: number | null = null,
  ) {
    super(message);
  }
}

/** Jeton invalide, expiré ou révoqué (le marchand doit reconnecter sa Page). */
export function isTokenError(e: unknown): boolean {
  return e instanceof MetaGraphError && (e.code === 190 || e.code === 102);
}

/** Limitation de débit Meta (application, Page ou utilisateur). */
export function isRateLimitError(e: unknown): boolean {
  return e instanceof MetaGraphError && (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || e.status === 429);
}

type Json = Record<string, unknown>;

function proof(token: string): string | null {
  const secret = metaAppSecret();
  return secret ? createHmac("sha256", secret).update(token).digest("hex") : null;
}

function withProof(url: string, token: string | null): string {
  if (!token) return url;
  const p = proof(token);
  if (!p) return url;
  return `${url}${url.includes("?") ? "&" : "?"}appsecret_proof=${p}`;
}

export async function graphCall<T extends Json>(
  fetchImpl: typeof fetch,
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: { token?: string | null; json?: unknown; form?: Record<string, string> } = {},
): Promise<T> {
  const url = withProof(path.startsWith("https://") ? path : `${BASE}${path}`, opts.token ?? null);
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  let res: Response;
  try {
    res = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError";
    throw new MetaGraphError(timeout ? "Meta : délai de réponse dépassé." : "Meta : erreur réseau.", 0, null);
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; error_subcode?: number } } | null)?.error;
    const msg = (err?.message ?? "erreur inconnue").replace(/access_token=[^&\s]+/g, "access_token=***").slice(0, 200);
    throw new MetaGraphError(`Meta ${res.status} : ${msg}`, res.status, typeof err?.code === "number" ? err.code : null, typeof err?.error_subcode === "number" ? err.error_subcode : null);
  }
  return (json ?? {}) as T;
}

/* ───────────── Connexion (Facebook Login for Business) ───────────── */

/** Échange le `code` renvoyé par FB.login (response_type=code) contre un jeton (utilisateur ou utilisateur système). */
export async function exchangeLoginCode(code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const cfg = socialLoginConfig();
  const secret = metaAppSecret();
  if (!cfg || !secret) throw new MetaGraphError("Connexion Meta non configurée.", 0, null);
  const params = new URLSearchParams({ client_id: cfg.appId, client_secret: secret, code });
  const data = await graphCall<{ access_token?: string }>(fetchImpl, "GET", `/oauth/access_token?${params.toString()}`);
  if (typeof data.access_token !== "string" || !data.access_token) throw new MetaGraphError("Meta n'a pas renvoyé de jeton d'accès.", 0, null);
  return data.access_token;
}

/**
 * Jeton utilisateur → jeton longue durée (60 jours) : les jetons de Page obtenus avec lui n'expirent pas.
 * Un jeton d'utilisateur système (configuration « System-user access token ») n'en a pas besoin : en cas d'échec,
 * on garde le jeton d'origine.
 */
export async function toLongLivedToken(token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const cfg = socialLoginConfig();
  const secret = metaAppSecret();
  if (!cfg || !secret) return token;
  try {
    const params = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: cfg.appId, client_secret: secret, fb_exchange_token: token });
    const data = await graphCall<{ access_token?: string }>(fetchImpl, "GET", `/oauth/access_token?${params.toString()}`);
    return typeof data.access_token === "string" && data.access_token ? data.access_token : token;
  } catch {
    return token;
  }
}

export type MetaPage = {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
  instagram: { id: string; username: string | null } | null;
};

/** Pages que le jeton peut gérer, avec leur jeton de Page et le compte Instagram pro lié. */
export async function listManagedPages(userToken: string, fetchImpl: typeof fetch = fetch): Promise<MetaPage[]> {
  const fields = "id,name,access_token,tasks,instagram_business_account{id,username}";
  const data = await graphCall<{ data?: unknown[] }>(fetchImpl, "GET", `/me/accounts?fields=${encodeURIComponent(fields)}&limit=100`, { token: userToken });
  const out: MetaPage[] = [];
  for (const raw of Array.isArray(data.data) ? data.data : []) {
    const p = raw as { id?: unknown; name?: unknown; access_token?: unknown; tasks?: unknown; instagram_business_account?: { id?: unknown; username?: unknown } };
    if (typeof p.id !== "string" || !/^\d{5,32}$/.test(p.id) || typeof p.access_token !== "string" || !p.access_token) continue;
    const ig = p.instagram_business_account;
    out.push({
      id: p.id,
      name: typeof p.name === "string" ? p.name.slice(0, 120) : "Page Facebook",
      accessToken: p.access_token,
      tasks: Array.isArray(p.tasks) ? p.tasks.filter((t): t is string => typeof t === "string").slice(0, 20) : [],
      instagram: ig && typeof ig.id === "string" && /^\d{5,32}$/.test(ig.id) ? { id: ig.id, username: typeof ig.username === "string" ? ig.username.slice(0, 60) : null } : null,
    });
  }
  return out;
}

/** Permissions effectivement accordées (jeton utilisateur ; liste vide si non lisible). */
export async function grantedPermissions(userToken: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    const data = await graphCall<{ data?: { permission?: string; status?: string }[] }>(fetchImpl, "GET", "/me/permissions", { token: userToken });
    return (Array.isArray(data.data) ? data.data : []).filter((p) => p?.status === "granted" && typeof p.permission === "string").map((p) => p.permission as string).slice(0, 50);
  } catch {
    return [];
  }
}

/** Abonne l'app aux webhooks de la Page (et, via la Page liée, du compte Instagram pro). */
export async function subscribePage(pageId: string, pageToken: string, fields: readonly string[], fetchImpl: typeof fetch = fetch): Promise<void> {
  const data = await graphCall<{ success?: boolean }>(fetchImpl, "POST", `/${pageId}/subscribed_apps`, { token: pageToken, form: { subscribed_fields: fields.join(",") } });
  if (data.success !== true) throw new MetaGraphError("Meta a refusé l'abonnement aux notifications de la Page.", 0, null);
}

export async function unsubscribePage(pageId: string, pageToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await graphCall(fetchImpl, "DELETE", `/${pageId}/subscribed_apps`, { token: pageToken });
}

/* ───────────── Messages ───────────── */

export type PrivateReplyResult = { recipientId: string | null; messageId: string | null };

/**
 * Réponse privée à un commentaire (Messenger pour une Page, Instagram Direct pour un compte pro) :
 * POST /{page-id | ig-user-id}/messages { recipient: { comment_id }, message: { text } }.
 * Meta n'autorise qu'UN message par commentaire, dans les 7 jours (Instagram Live : pendant la diffusion seulement).
 */
export async function sendPrivateReply(accountId: string, pageToken: string, commentId: string, text: string, fetchImpl: typeof fetch = fetch): Promise<PrivateReplyResult> {
  const data = await graphCall<{ recipient_id?: unknown; message_id?: unknown }>(fetchImpl, "POST", `/${accountId}/messages`, {
    token: pageToken,
    json: { recipient: { comment_id: commentId }, message: { text } },
  });
  return {
    recipientId: typeof data.recipient_id === "string" ? data.recipient_id.slice(0, 64) : null,
    messageId: typeof data.message_id === "string" ? data.message_id.slice(0, 190) : null,
  };
}

/**
 * Message de suivi à un destinataire déjà contacté (id à portée de Page / Instagram). Meta ne l'accepte que si la
 * personne a répondu à la réponse privée, dans les 24 h qui suivent sa réponse : sinon Meta renvoie une erreur.
 */
export async function sendFollowUp(accountId: string, pageToken: string, recipientId: string, text: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const data = await graphCall<{ message_id?: unknown }>(fetchImpl, "POST", `/${accountId}/messages`, {
    token: pageToken,
    json: { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } },
  });
  return typeof data.message_id === "string" ? data.message_id.slice(0, 190) : null;
}

/** Réponse PUBLIQUE sous le commentaire : Facebook `/{comment-id}/comments`, Instagram `/{comment-id}/replies`. */
export async function sendPublicReply(platform: "FACEBOOK" | "INSTAGRAM", commentId: string, pageToken: string, text: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const edge = platform === "FACEBOOK" ? "comments" : "replies";
  await graphCall(fetchImpl, "POST", `/${commentId}/${edge}`, { token: pageToken, form: { message: text } });
}

/* ───────────── Directs en cours ───────────── */

export type SocialLiveObject = { platform: "FACEBOOK" | "INSTAGRAM"; ids: string[]; title: string };

/** Vidéos en direct EN COURS de la Page (id du direct + id de la vidéo, tous deux acceptés pour le routage). */
export async function currentFacebookLives(pageId: string, pageToken: string, fetchImpl: typeof fetch = fetch): Promise<SocialLiveObject[]> {
  const data = await graphCall<{ data?: unknown[] }>(
    fetchImpl,
    "GET",
    `/${pageId}/live_videos?broadcast_status=${encodeURIComponent('["LIVE"]')}&fields=${encodeURIComponent("id,title,status,video{id}")}&limit=10`,
    { token: pageToken },
  );
  const out: SocialLiveObject[] = [];
  for (const raw of Array.isArray(data.data) ? data.data : []) {
    const v = raw as { id?: unknown; title?: unknown; video?: { id?: unknown } };
    if (typeof v.id !== "string") continue;
    const ids = [v.id, typeof v.video?.id === "string" ? v.video.id : null].filter((x): x is string => !!x && /^[\d_]{5,64}$/.test(x));
    if (ids.length) out.push({ platform: "FACEBOOK", ids, title: typeof v.title === "string" && v.title ? v.title.slice(0, 80) : "Direct Facebook" });
  }
  return out;
}

/** Direct Instagram en cours (`/{ig-user-id}/live_media` ne renvoie que les diffusions en cours). */
export async function currentInstagramLives(igUserId: string, pageToken: string, fetchImpl: typeof fetch = fetch): Promise<SocialLiveObject[]> {
  const data = await graphCall<{ data?: unknown[] }>(fetchImpl, "GET", `/${igUserId}/live_media?fields=${encodeURIComponent("id,media_type,timestamp")}`, { token: pageToken });
  const out: SocialLiveObject[] = [];
  for (const raw of Array.isArray(data.data) ? data.data : []) {
    const m = raw as { id?: unknown };
    if (typeof m.id === "string" && /^\d{5,64}$/.test(m.id)) out.push({ platform: "INSTAGRAM", ids: [m.id], title: "Direct Instagram" });
  }
  return out;
}

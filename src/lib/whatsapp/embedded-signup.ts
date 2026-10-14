import "server-only";
import { isPlaceholderSecret, numericCode } from "@/lib/crypto";
import { GRAPH_VERSION } from "@/lib/social/graph-client";

/**
 * MODE PARTENAIRE WhatsApp (Meta Tech Provider / Embedded Signup).
 *
 * Le marchand connecte SON numéro WhatsApp Business via le bouton Embedded Signup : la fenêtre Meta lui
 * renvoie un `code` d'autorisation (OAuth) + le `phone_number_id` et le `waba_id` de son compte. Ce module
 * déroule côté serveur, au nom de l'app Axi (Tech Provider) :
 *   1. échange `code` → jeton d'accès (utilisateur système d'intégration business, non expirant) ;
 *   2. lecture du numéro (valide que le jeton y donne accès, récupère le numéro affiché / nom vérifié) ;
 *   3. abonnement de la WABA à l'app Axi (le webhook partagé reçoit alors les événements de ce numéro) ;
 *   4. enregistrement du numéro sur la Cloud API avec un PIN (vérification en deux étapes).
 * Le jeton obtenu est ensuite chiffré au repos dans l'Integration `whatsapp_cloud`, EXACTEMENT comme la saisie
 * manuelle : `send.ts` et le webhook (routage par `phoneNumberId`) fonctionnent sans changement.
 *
 * POINTS D'INTÉGRATION DU PORTEUR (branchés par variables d'environnement, voir .env.example) :
 *   - NEXT_PUBLIC_META_APP_ID : App ID Meta (public, utilisé par le SDK JS et l'échange de code) ;
 *   - NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID : identifiant de la configuration Embedded Signup (public) ;
 *   - META_APP_SECRET (ou, à défaut, WHATSAPP_APP_SECRET) : secret de l'app Meta (échange de code).
 * Sans ces variables, `partnerModeConfig()` renvoie null et l'UI masque le bouton : rien n'est cassé.
 * Le secret de l'app n'est jamais journalisé ni renvoyé au client ; les messages d'erreur ne contiennent
 * que le message nettoyé de Meta (jamais le jeton).
 */

const TIMEOUT_MS = 15_000;

export type PartnerModeConfig = { appId: string; configId: string };

/** Configuration publique du mode partenaire, ou null si le porteur ne l'a pas branché. */
export function partnerModeConfig(): PartnerModeConfig | null {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim();
  const configId = process.env.NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID?.trim();
  if (!appId || !configId) return null;
  if (!/^\d{5,32}$/.test(appId) || !/^\d{5,32}$/.test(configId)) return null;
  return { appId, configId };
}

export function isPartnerModeConfigured(): boolean {
  return partnerModeConfig() !== null;
}

/** Erreur « métier » du flux : message déjà nettoyé (aucun secret), affichable au marchand. */
export class EmbeddedSignupError extends Error {}

function appSecret(): string {
  const secret = process.env.META_APP_SECRET?.trim() || process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret || isPlaceholderSecret(secret)) {
    throw new EmbeddedSignupError("Mode partenaire indisponible : le secret de l'application Meta n'est pas configuré.");
  }
  return secret;
}

type Json = Record<string, unknown>;

/** Appel Graph générique : timeout, erreur réseau et erreur Meta normalisées (jamais de secret dans le message). */
async function graph<T extends Json>(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError";
    throw new EmbeddedSignupError(timeout ? "Meta : délai de réponse dépassé." : "Meta : erreur réseau.");
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string } } | null)?.error;
    throw new EmbeddedSignupError(`Meta ${res.status} : ${(err?.message ?? "erreur inconnue").slice(0, 200)}`);
  }
  return (json ?? {}) as T;
}

/** Échange le code d'autorisation Embedded Signup contre un jeton d'accès business (non expirant). */
async function exchangeCodeForToken(code: string, fetchImpl: typeof fetch): Promise<string> {
  const cfg = partnerModeConfig();
  if (!cfg) throw new EmbeddedSignupError("Mode partenaire non configuré.");
  const params = new URLSearchParams({ client_id: cfg.appId, client_secret: appSecret(), code });
  const data = await graph<{ access_token?: string }>(fetchImpl, `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${params.toString()}`, {
    method: "GET",
  });
  if (!data.access_token || typeof data.access_token !== "string") throw new EmbeddedSignupError("Meta n'a pas renvoyé de jeton d'accès.");
  return data.access_token;
}

type PhoneInfo = { displayPhoneNumber: string | null; verifiedName: string | null };

/** Lit le numéro : valide que le jeton y donne accès et récupère numéro affiché + nom vérifié (pour l'affichage). */
async function fetchPhoneNumber(phoneNumberId: string, token: string, fetchImpl: typeof fetch): Promise<PhoneInfo> {
  const data = await graph<{ display_phone_number?: string; verified_name?: string }>(
    fetchImpl,
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  );
  return { displayPhoneNumber: data.display_phone_number ?? null, verifiedName: data.verified_name ?? null };
}

/**
 * Si Meta n'a renvoyé que le compte (WABA) sans le numéro, retrouve le numéro de ce compte. Exige qu'il y en ait
 * exactement un (sinon on ne peut pas deviner lequel connecter).
 */
async function resolvePhoneNumberId(wabaId: string, token: string, fetchImpl: typeof fetch): Promise<string> {
  const data = await graph<{ data?: { id?: string }[] }>(
    fetchImpl,
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/phone_numbers?fields=id`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  );
  const ids = (data.data ?? []).map((p) => p.id).filter((id): id is string => typeof id === "string" && /^\d{5,32}$/.test(id));
  if (ids.length === 0) throw new EmbeddedSignupError("Aucun numéro n'est rattaché à ce compte WhatsApp Business : ajoutez et vérifiez un numéro dans la fenêtre Meta, puis réessayez.");
  if (ids.length > 1) throw new EmbeddedSignupError("Ce compte WhatsApp Business contient plusieurs numéros : relancez la connexion et sélectionnez le numéro à connecter.");
  return ids[0];
}

/** Abonne l'app Axi à la WABA du marchand : ses événements arrivent sur le webhook partagé. */
async function subscribeAppToWaba(wabaId: string, token: string, fetchImpl: typeof fetch): Promise<void> {
  await graph(fetchImpl, `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Enregistre le numéro sur la Cloud API avec un PIN. Un numéro déjà enregistré n'est pas une erreur. */
async function registerPhoneNumber(phoneNumberId: string, token: string, pin: string, fetchImpl: typeof fetch): Promise<void> {
  try {
    await graph(fetchImpl, `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    });
  } catch (e) {
    // Numéro déjà enregistré (codes Meta 133015/133016, ou message « already registered ») : on tolère.
    if (e instanceof EmbeddedSignupError && /already\s+registered|déjà\s+enregistr|133015|133016/i.test(e.message)) return;
    throw e;
  }
}

export type EmbeddedSignupResult = {
  token: string;
  pin: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
};

/**
 * Déroule le flux complet et renvoie de quoi enregistrer l'intégration (jeton + PIN chiffrés par l'appelant).
 * `fetchImpl` est injectable pour les tests. Lève EmbeddedSignupError (affichable) à la moindre étape ratée.
 */
export async function runEmbeddedSignup(
  input: { code: string; phoneNumberId?: string | null; wabaId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<EmbeddedSignupResult> {
  if (!partnerModeConfig()) throw new EmbeddedSignupError("Mode partenaire non configuré.");
  const code = input.code.trim();
  const { wabaId } = input;
  const givenPhone = input.phoneNumberId?.trim() || null;
  if (!code) throw new EmbeddedSignupError("Code d'autorisation manquant.");
  if (givenPhone && !/^\d{5,32}$/.test(givenPhone)) throw new EmbeddedSignupError("Identifiant de numéro invalide.");
  if (!/^\d{5,32}$/.test(wabaId)) throw new EmbeddedSignupError("Identifiant WABA invalide.");

  const token = await exchangeCodeForToken(code, fetchImpl);
  const phoneNumberId = givenPhone ?? (await resolvePhoneNumberId(wabaId, token, fetchImpl));
  const phone = await fetchPhoneNumber(phoneNumberId, token, fetchImpl);
  await subscribeAppToWaba(wabaId, token, fetchImpl);
  const pin = numericCode(6);
  await registerPhoneNumber(phoneNumberId, token, pin, fetchImpl);

  return { token, pin, phoneNumberId, wabaId, displayPhoneNumber: phone.displayPhoneNumber, verifiedName: phone.verifiedName };
}

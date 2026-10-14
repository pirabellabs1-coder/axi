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
 *   4. enregistrement du numéro sur la Cloud API avec un PIN (vérification en deux étapes) — sauf en COEXISTENCE
 *      (numéro conservé dans l'app WhatsApp Business : déjà enregistré, puis synchros contacts/historique).
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

/** Numéros rattachés à la WABA (le jeton doit y donner accès). */
async function listPhoneNumberIds(wabaId: string, token: string, fetchImpl: typeof fetch): Promise<string[]> {
  const data = await graph<{ data?: { id?: string }[] }>(
    fetchImpl,
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/phone_numbers?fields=id`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  );
  return (Array.isArray(data.data) ? data.data : []).map((p) => p?.id).filter((id): id is string => typeof id === "string" && /^\d{5,32}$/.test(id));
}

/**
 * Numéro effectif : celui fourni par la fenêtre Meta s'il appartient bien à la WABA (sinon erreur : un client
 * ne doit pas pouvoir rattacher un numéro étranger), ou, à défaut, l'unique numéro de la WABA.
 */
async function resolvePhoneNumberId(wabaId: string, token: string, given: string | null, fetchImpl: typeof fetch): Promise<string> {
  const ids = await listPhoneNumberIds(wabaId, token, fetchImpl);
  if (given) {
    if (!ids.includes(given)) throw new EmbeddedSignupError("Le numéro renvoyé n'appartient pas à ce compte WhatsApp Business. Relancez la connexion.");
    return given;
  }
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

/** Mode de connexion : nouveau numéro (Cloud API seule) ou coexistence (app WhatsApp Business + Cloud API). */
export type EmbeddedSignupMode = "standard" | "coexistence";

export type EmbeddedSignupResult = {
  token: string;
  /** PIN de vérification en deux étapes ; null en coexistence (numéro déjà enregistré dans l'app, pas de /register). */
  pin: string | null;
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  mode: EmbeddedSignupMode;
  /** Coexistence : état côté Meta (`is_on_biz_app`, `platform_type`), lu au mieux (null si indisponible). */
  bizApp: { isOnBizApp: boolean | null; platformType: string | null } | null;
};

/**
 * Déroule le flux complet et renvoie de quoi enregistrer l'intégration (jeton + PIN chiffrés par l'appelant).
 * `fetchImpl` est injectable pour les tests. Lève EmbeddedSignupError (affichable) à la moindre étape ratée.
 *
 * Coexistence (`mode: "coexistence"`, featureType `whatsapp_business_app_onboarding`) : le numéro reste dans
 * l'application WhatsApp Business du marchand et y est déjà enregistré : on n'appelle PAS `/register` (pas de PIN).
 * Les synchronisations contacts / historique sont demandées APRÈS l'enregistrement de l'intégration
 * (`requestCoexistenceSyncs`), pour que leurs webhooks trouvent la boutique.
 */
export async function runEmbeddedSignup(
  input: {
    code: string;
    phoneNumberId?: string | null;
    wabaId: string;
    mode?: EmbeddedSignupMode;
    /** Contrôle sur le numéro EFFECTIF (ex. déjà pris par une autre boutique), avant abonnement / `/register`. Lève pour refuser. */
    assertPhoneAvailable?: (phoneNumberId: string) => Promise<void>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<EmbeddedSignupResult> {
  if (!partnerModeConfig()) throw new EmbeddedSignupError("Mode partenaire non configuré.");
  const mode: EmbeddedSignupMode = input.mode === "coexistence" ? "coexistence" : "standard";
  const code = input.code.trim();
  const { wabaId } = input;
  const givenPhone = input.phoneNumberId?.trim() || null;
  if (!code) throw new EmbeddedSignupError("Code d'autorisation manquant.");
  if (givenPhone && !/^\d{5,32}$/.test(givenPhone)) throw new EmbeddedSignupError("Identifiant de numéro invalide.");
  if (!/^\d{5,32}$/.test(wabaId)) throw new EmbeddedSignupError("Identifiant WABA invalide.");

  const token = await exchangeCodeForToken(code, fetchImpl);
  const phoneNumberId = await resolvePhoneNumberId(wabaId, token, givenPhone, fetchImpl);
  if (input.assertPhoneAvailable) await input.assertPhoneAvailable(phoneNumberId);
  const phone = await fetchPhoneNumber(phoneNumberId, token, fetchImpl);
  await subscribeAppToWaba(wabaId, token, fetchImpl);

  let pin: string | null = null;
  let bizApp: EmbeddedSignupResult["bizApp"] = null;
  if (mode === "standard") {
    pin = numericCode(6);
    await registerPhoneNumber(phoneNumberId, token, pin, fetchImpl);
  } else {
    bizApp = await fetchBizAppState(phoneNumberId, token, fetchImpl);
  }

  return { token, pin, phoneNumberId, wabaId, displayPhoneNumber: phone.displayPhoneNumber, verifiedName: phone.verifiedName, mode, bizApp };
}

/** Coexistence : lit `is_on_biz_app` / `platform_type`. Informatif : une erreur ici ne bloque jamais la connexion. */
async function fetchBizAppState(phoneNumberId: string, token: string, fetchImpl: typeof fetch): Promise<EmbeddedSignupResult["bizApp"]> {
  try {
    const data = await graph<{ is_on_biz_app?: boolean; platform_type?: string }>(
      fetchImpl,
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}?fields=is_on_biz_app,platform_type`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    );
    return {
      isOnBizApp: typeof data.is_on_biz_app === "boolean" ? data.is_on_biz_app : null,
      platformType: typeof data.platform_type === "string" ? data.platform_type.slice(0, 40) : null,
    };
  } catch {
    return null;
  }
}

/** État d'une synchronisation coexistence, stocké dans `Integration.config.coexistence`. */
export type SyncState = "requested" | `failed:${string}`;
export type CoexistenceSyncs = { contactsSync: SyncState; historySync: SyncState; at: string };

/** Une demande de synchronisation `smb_app_data` (à n'appeler qu'une fois par type, dans les 24 h de l'onboarding). */
async function requestSmbSync(phoneNumberId: string, token: string, syncType: "smb_app_state_sync" | "history", fetchImpl: typeof fetch): Promise<SyncState> {
  try {
    await graph(fetchImpl, `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/smb_app_data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }),
    });
    return "requested";
  } catch (e) {
    const msg = e instanceof EmbeddedSignupError ? e.message : "erreur inconnue";
    return `failed:${msg.slice(0, 200)}`;
  }
}

/**
 * Coexistence : demande la synchronisation des contacts PUIS de l'historique (ordre imposé par Meta).
 * Ne lève jamais : un échec est renvoyé dans l'état (connexion conservée, échec affiché au marchand).
 * `previous` : synchros déjà demandées avec succès pour ce numéro (reconnexion) → non redemandées.
 */
export async function requestCoexistenceSyncs(
  phoneNumberId: string,
  token: string,
  previous: Partial<CoexistenceSyncs> | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<CoexistenceSyncs> {
  const contactsSync = previous?.contactsSync === "requested" ? "requested" : await requestSmbSync(phoneNumberId, token, "smb_app_state_sync", fetchImpl);
  const historySync = previous?.historySync === "requested" ? "requested" : await requestSmbSync(phoneNumberId, token, "history", fetchImpl);
  return { contactsSync, historySync, at: new Date().toISOString() };
}

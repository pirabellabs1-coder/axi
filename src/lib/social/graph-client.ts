import "server-only";
import type { BatchRequest, BatchResponse, BatchStatusResponse } from "./meta-batch";
import { sanitizeError } from "./meta-batch";

/**
 * POINT D'INTÉGRATION : client de l'API Graph pour les catalogues Meta (Commerce Manager / catalogue WhatsApp).
 * Référence : « Product Catalog Items Batch » et « Check Batch Request Status » (developers.facebook.com, consultées
 * le 14/10/2026, version courante v26.0).
 *
 * Envoi : POST https://graph.facebook.com/{version}/{catalog_id}/items_batch
 *   { item_type: "PRODUCT_ITEM", allow_upsert: true, requests: [{ method: "UPDATE" | "DELETE", data: { id, … } }] }
 *   Authorization: Bearer <jeton>  (jeton d'utilisateur système avec la permission `catalog_management`, lu depuis
 *   l'Integration `whatsapp_cloud` chiffrée ; il n'est JAMAIS journalisé).
 *   Réponse : { handles: [...], validation_status: [{ retailer_id, errors: [{ message }], warnings }] }.
 *   Limites : 5 000 requêtes par appel (Meta recommande moins de 3 000), 28 Mo ; quota d'appels par catalogue
 *   (erreur 80014 → relance avec backoff).
 *
 * Suivi : le traitement est asynchrone. GET /{catalog_id}/check_batch_request_status?handle=…
 *   &load_ids_of_invalid_requests=true → { data: [{ status, errors, errors_total_count, ids_of_invalid_requests }] }
 *   (statuts : scheduled, dispatched, started, finished, canceled, error). Voir runBatchStatusCheck (sync.ts).
 *
 * Développement : SOCIAL_SYNC_DRY_RUN=1 (ignoré en production) remplace les appels par un client qui accepte tout,
 * pour dérouler le job de bout en bout sans compte Meta.
 */

export const DEFAULT_GRAPH_VERSION = "v26.0";
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION && /^v\d{1,3}\.\d$/.test(process.env.META_GRAPH_VERSION) ? process.env.META_GRAPH_VERSION : DEFAULT_GRAPH_VERSION;
const TIMEOUT_MS = 20_000;

export interface CatalogApi {
  itemsBatch(catalogId: string, requests: BatchRequest[]): Promise<BatchResponse>;
  checkBatchStatus(catalogId: string, handle: string): Promise<BatchStatusResponse>;
}

/** Erreur d'appel Graph : message déjà nettoyé (aucun secret), code Meta éventuel. */
export class GraphCatalogError extends Error {
  constructor(message: string, public status: number, public code: number | null) {
    super(message);
  }
}

/** Codes Meta qui exigent une action du commerçant (jeton expiré ou révoqué, permission manquante, catalogue inconnu). */
export function isConfigurationError(e: unknown): boolean {
  return e instanceof GraphCatalogError && (e.code === 190 || e.code === 10 || e.code === 200 || e.code === 100 || e.status === 401 || e.status === 403);
}

/** Quota d'appels du catalogue dépassé (80014 : items_batch ; 80009 : lecture) : simple relance plus tard. */
export function isRateLimitError(e: unknown): boolean {
  return e instanceof GraphCatalogError && (e.code === 80014 || e.code === 80009 || e.code === 4 || e.code === 17 || e.status === 429);
}

const CATALOG_ID = /^\d{5,32}$/;

async function graphCall<T>(fetchImpl: typeof fetch, token: string, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError";
    throw new GraphCatalogError(timeout ? "Meta : délai de réponse dépassé" : "Meta : erreur réseau", 0, null);
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number } } | null)?.error;
    throw new GraphCatalogError(sanitizeError(`Meta ${res.status} : ${err?.message ?? "erreur inconnue"}`, 400, [token]), res.status, typeof err?.code === "number" ? err.code : null);
  }
  return (json ?? {}) as T;
}

export function graphCatalogApi(token: string, fetchImpl: typeof fetch = fetch): CatalogApi {
  return {
    async itemsBatch(catalogId, requests) {
      if (!CATALOG_ID.test(catalogId)) throw new GraphCatalogError("Identifiant de catalogue invalide", 400, null);
      return graphCall<BatchResponse>(fetchImpl, token, `https://graph.facebook.com/${GRAPH_VERSION}/${catalogId}/items_batch`, {
        method: "POST",
        body: JSON.stringify({ item_type: "PRODUCT_ITEM", allow_upsert: true, requests }),
      });
    },
    async checkBatchStatus(catalogId, handle) {
      if (!CATALOG_ID.test(catalogId)) throw new GraphCatalogError("Identifiant de catalogue invalide", 400, null);
      if (!/^[A-Za-z0-9_:.=-]{1,200}$/.test(handle)) throw new GraphCatalogError("Identifiant de lot invalide", 400, null);
      const qs = new URLSearchParams({
        handle,
        load_ids_of_invalid_requests: "true",
        fields: "handle,status,errors,errors_total_count,warnings_total_count,ids_of_invalid_requests",
      });
      return graphCall<BatchStatusResponse>(fetchImpl, token, `https://graph.facebook.com/${GRAPH_VERSION}/${catalogId}/check_batch_request_status?${qs}`, { method: "GET" });
    },
  };
}

/** Client de développement : tout est accepté (aucun appel réseau). */
export const dryRunCatalogApi: CatalogApi = {
  async itemsBatch(_catalogId, requests) {
    return { handles: [`dry-run-${requests.length}`], validation_status: [] };
  },
  async checkBatchStatus(_catalogId, handle) {
    return { data: [{ handle, status: "finished", errors_total_count: 0, ids_of_invalid_requests: [] }] };
  },
};

export function isDryRun(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.SOCIAL_SYNC_DRY_RUN === "1";
}

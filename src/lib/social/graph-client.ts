import "server-only";
import type { BatchRequest, BatchResponse } from "./meta-batch";
import { sanitizeError } from "./meta-batch";

/**
 * POINT D'INTÉGRATION : client de l'API Graph pour les catalogues Meta (Commerce Manager / catalogue WhatsApp).
 *
 * Appel : POST https://graph.facebook.com/{version}/{catalog_id}/items_batch
 *   { item_type: "PRODUCT_ITEM", allow_upsert: true, requests: [{ method: "UPDATE" | "DELETE", data: { id, … } }] }
 *   Authorization: Bearer <jeton>  (jeton d'utilisateur système avec la permission `catalog_management`, fourni par
 *   le porteur ; il est lu depuis l'Integration `whatsapp_cloud` chiffrée et n'est JAMAIS journalisé).
 * Réponse : { handles: [...], validation_status: [{ retailer_id, errors: [{ message }] }] }.
 *
 * Le traitement côté Meta est asynchrone : les erreurs tardives restent visibles dans Commerce Manager
 * (« Problèmes »). Le suivi par `check_batch_request_status?handle=…` est une extension prévue (voir la doc P2).
 *
 * Développement : SOCIAL_SYNC_DRY_RUN=1 (ignoré en production) remplace les appels par un client qui accepte tout,
 * pour dérouler le job de bout en bout sans compte Meta.
 */

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION && /^v\d{1,3}\.\d$/.test(process.env.META_GRAPH_VERSION) ? process.env.META_GRAPH_VERSION : "v21.0";
const TIMEOUT_MS = 20_000;

export interface CatalogApi {
  itemsBatch(catalogId: string, requests: BatchRequest[]): Promise<BatchResponse>;
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

export function graphCatalogApi(token: string, fetchImpl: typeof fetch = fetch): CatalogApi {
  return {
    async itemsBatch(catalogId, requests) {
      if (!/^\d{5,32}$/.test(catalogId)) throw new GraphCatalogError("Identifiant de catalogue invalide", 400, null);
      let res: Response;
      try {
        res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${catalogId}/items_batch`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ item_type: "PRODUCT_ITEM", allow_upsert: true, requests }),
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
      return (json ?? {}) as BatchResponse;
    },
  };
}

/** Client de développement : tout est accepté (aucun appel réseau). */
export const dryRunCatalogApi: CatalogApi = {
  async itemsBatch(_catalogId, requests) {
    return { handles: [`dry-run-${requests.length}`], validation_status: [] };
  },
};

export function isDryRun(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.SOCIAL_SYNC_DRY_RUN === "1";
}

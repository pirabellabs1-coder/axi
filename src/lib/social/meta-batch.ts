import { contentHash, toMetaItemData, type CatalogItem, type MetaItemData } from "./feed-items";

/**
 * Synchronisation incrémentale vers un catalogue Meta (API Graph `/{catalog_id}/items_batch`) : module PUR, testé
 * dans tests/social-sync.test.ts. Calcul du diff (empreinte par article), construction des requêtes par lots,
 * lecture de la réponse, backoff et masquage des secrets dans les messages d'erreur.
 */

export type DesiredItem = { retailerId: string; productId: string; variantId: string | null; hash: string; data: MetaItemData };
export type ExistingItem = { id: string; retailerId: string; productId: string; variantId: string | null; contentHash: string; status: string };

export type CatalogDiff = {
  upserts: DesiredItem[];
  deletes: ExistingItem[];
  /** Articles déjà à jour chez Meta. */
  unchanged: number;
  /** Articles refusés par Meta et inchangés depuis : renvoyés seulement en synchronisation forcée. */
  blocked: number;
};

export function desiredFromItems(items: CatalogItem[]): DesiredItem[] {
  return items.map((item) => {
    const data = toMetaItemData(item);
    return { retailerId: item.id, productId: item.productId, variantId: item.variantId, hash: contentHash(data), data };
  });
}

/**
 * Diff entre le catalogue Axi (désiré) et l'état connu du catalogue Meta (SocialCatalogItem).
 *  - nouvel article, empreinte modifiée, ou article en attente : UPDATE (création si absent, allow_upsert) ;
 *  - article refusé (status error) à l'empreinte identique : bloqué, sauf `force` (« Synchroniser maintenant ») ;
 *  - article connu absent du catalogue Axi (produit supprimé, archivé, brouillon, variante retirée) : DELETE.
 */
export function diffCatalog(desired: DesiredItem[], existing: ExistingItem[], opts: { force?: boolean } = {}): CatalogDiff {
  const known = new Map(existing.map((e) => [e.retailerId, e]));
  const wanted = new Set<string>();
  const upserts: DesiredItem[] = [];
  let unchanged = 0;
  let blocked = 0;
  for (const d of desired) {
    if (wanted.has(d.retailerId)) continue; // doublon défensif
    wanted.add(d.retailerId);
    const e = known.get(d.retailerId);
    if (!e || e.contentHash !== d.hash || e.status === "pending" || e.status === "deleted" || opts.force) {
      upserts.push(d);
    } else if (e.status === "error") {
      blocked++;
    } else {
      unchanged++;
    }
  }
  const deletes = existing.filter((e) => !wanted.has(e.retailerId));
  return { upserts, deletes, unchanged, blocked };
}

export type BatchRequest = { method: "UPDATE"; data: MetaItemData } | { method: "DELETE"; data: { id: string } };

/** Requêtes `items_batch` découpées en lots (Meta accepte jusqu'à 5 000 requêtes par appel ; on reste prudent). */
export function buildBatchRequests(diff: Pick<CatalogDiff, "upserts" | "deletes">, chunkSize = 500): BatchRequest[][] {
  const all: BatchRequest[] = [
    ...diff.deletes.map((e) => ({ method: "DELETE" as const, data: { id: e.retailerId } })),
    ...diff.upserts.map((d) => ({ method: "UPDATE" as const, data: d.data })),
  ];
  const out: BatchRequest[][] = [];
  for (let i = 0; i < all.length; i += chunkSize) out.push(all.slice(i, i + chunkSize));
  return out;
}

/** Réponse de `items_batch` (champs utiles). */
export type BatchResponse = {
  handles?: string[];
  validation_status?: { retailer_id?: string; errors?: { message?: string }[]; warnings?: { message?: string }[] }[];
};

export type ItemOutcome = { retailerId: string; method: BatchRequest["method"]; ok: boolean; error: string | null };

/** Résultat par article : les erreurs de validation renvoyées par Meta sont rattachées au retailer_id concerné. */
export function mapBatchResponse(requests: BatchRequest[], response: BatchResponse): ItemOutcome[] {
  const errors = new Map<string, string>();
  for (const v of response.validation_status ?? []) {
    if (!v.retailer_id || !v.errors?.length) continue;
    const msg = v.errors.map((e) => e.message).filter(Boolean).join(" ; ") || "Article refusé par Meta";
    errors.set(v.retailer_id, sanitizeError(msg, 300));
  }
  return requests.map((r) => {
    const error = errors.get(r.data.id) ?? null;
    return { retailerId: r.data.id, method: r.method, ok: error == null, error };
  });
}

/** Erreur d'un lot entier (réseau, jeton refusé, catalogue introuvable) : tous ses articles portent le message. */
export function failedBatch(requests: BatchRequest[], message: string): ItemOutcome[] {
  const error = sanitizeError(message, 300);
  return requests.map((r) => ({ retailerId: r.data.id, method: r.method, ok: false, error }));
}

/**
 * Masque tout ce qui ressemble à un secret (jetons Meta « EAA… », en-têtes Bearer, paramètres access_token,
 * appsecret_proof) et, si fourni, le jeton exact. Utilisé avant TOUTE écriture en base ou dans les journaux.
 */
export function redactSecrets(text: string, secrets: (string | null | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[secret masqué]");
  return out
    .replace(/\bEAA[A-Za-z0-9]{8,}\b/g, "[secret masqué]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [secret masqué]")
    .replace(/(access_token|appsecret_proof|client_secret)=([^&\s"']+)/gi, "$1=[secret masqué]");
}

export function sanitizeError(text: string, max = 500, secrets: (string | null | undefined)[] = []): string {
  const clean = redactSecrets(String(text ?? ""), secrets).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export const SYNC_INTERVAL_MS = 60 * 60_000; // 1 h : sans changement, aucun appel à Meta (diff vide)
export const SYNC_LEASE_MS = 30 * 60_000; // bail posé par le planificateur pour éviter les doubles mises en file
export const SYNC_STALE_MS = 15 * 60_000; // verrou « syncing » considéré comme abandonné au-delà
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 24 * 3600_000;

/** Délai avant la prochaine tentative après `failures` échecs consécutifs : 5 min, 10, 20… plafonné à 24 h. */
export function backoffDelayMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_MAX_MS);
}

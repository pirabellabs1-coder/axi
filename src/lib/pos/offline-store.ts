/**
 * Stockage hors ligne de la caisse (lot 3 §2) — code CLIENT (IndexedDB), sans dépendance.
 *
 * Deux magasins :
 *  - `snapshot` : instantané du catalogue (une seule entrée, clé « current ») avec sa version et sa date ;
 *  - `queue`    : ventes à synchroniser, clé = clé d'idempotence UUID v4 générée sur l'appareil.
 *
 * Une vente n'est retirée de la file que lorsque le serveur l'a ACCEPTÉE (ou déclarée définitivement
 * invalide) : une coupure réseau, un rechargement de page ou une fermeture du navigateur ne perdent
 * jamais un encaissement.
 */

import type { PosCatalogSnapshot } from "./catalog";

const DB_NAME = "axi-pos";
const DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshot";
const QUEUE_STORE = "queue";
const SNAPSHOT_KEY = "current";

export type QueuedSale = {
  idempotencyKey: string;
  sessionId: string;
  items: { productId: string; variantId: string | null; quantity: number; unitPrice: number; name: string; variantName: string | null }[];
  payments: { kind: "pos_cash" | "pos_momo" | "pos_card"; amount: number; reference?: string | null }[];
  discountPercent?: number;
  /**
   * Code du gérant saisi à la caisse pour dépasser le plafond de remise : conservé avec la vente pour
   * qu'elle puisse être REJOUÉE fidèlement (il est vérifié côté serveur, jamais côté appareil).
   */
  managerCode?: string | null;
  /** Rôle du VENDEUR au moment de l'encaissement : le serveur n'en retient que le plafond le plus bas. */
  sellerRole?: "OWNER" | "MANAGER" | "STAFF" | "SUPPORT";
  customerPhone?: string | null;
  customerName?: string | null;
  collectedTotal: number;
  /** Date locale de l'encaissement (bornée côté serveur). */
  offlineCreatedAt: string;
  /** Nombre de tentatives de synchronisation (information affichée au caissier). */
  attempts?: number;
  /**
   * Dernier refus RÉCUPÉRABLE du serveur (session fermée, article indisponible, plafond de remise…).
   * La vente reste en file — elle est déjà encaissée — et le gérant doit la régulariser : elle n'est
   * jamais supprimée en silence (bloquant n° 3).
   */
  lastError?: string | null;
};

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

export function openPosDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error("IndexedDB indisponible : la caisse hors ligne ne peut pas fonctionner sur cet appareil."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE);
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "idempotencyKey" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB inaccessible"));
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openPosDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Écriture hors ligne impossible"));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export type StoredSnapshot = { snapshot: PosCatalogSnapshot; savedAt: string };

export async function saveSnapshot(snapshot: PosCatalogSnapshot): Promise<void> {
  await tx<IDBValidKey>(SNAPSHOT_STORE, "readwrite", (s) => s.put({ snapshot, savedAt: new Date().toISOString() }, SNAPSHOT_KEY));
}

export async function loadSnapshot(): Promise<StoredSnapshot | null> {
  const value = await tx<StoredSnapshot | undefined>(SNAPSHOT_STORE, "readonly", (s) => s.get(SNAPSHOT_KEY));
  return value ?? null;
}

export async function enqueueSale(sale: QueuedSale): Promise<void> {
  await tx<IDBValidKey>(QUEUE_STORE, "readwrite", (s) => s.put(sale));
}

export async function listQueue(): Promise<QueuedSale[]> {
  const rows = await tx<QueuedSale[]>(QUEUE_STORE, "readonly", (s) => s.getAll() as IDBRequest<QueuedSale[]>);
  return rows.sort((a, b) => a.offlineCreatedAt.localeCompare(b.offlineCreatedAt));
}

export async function removeFromQueue(idempotencyKey: string): Promise<void> {
  await tx<undefined>(QUEUE_STORE, "readwrite", (s) => s.delete(idempotencyKey) as IDBRequest<undefined>);
}

export async function markAttempt(sale: QueuedSale, error?: string | null): Promise<void> {
  await enqueueSale({ ...sale, attempts: (sale.attempts ?? 0) + 1, ...(error !== undefined ? { lastError: error } : {}) });
}

/** Ventes bloquées par un refus récupérable : à régulariser par le gérant (jamais synchronisables en l'état). */
export function blockedSales(queue: readonly QueuedSale[]): QueuedSale[] {
  return queue.filter((s) => !!s.lastError);
}

/** Ventes encore synchronisables (elles seules bloquent la clôture de la caisse). */
export function syncableSales(queue: readonly QueuedSale[]): QueuedSale[] {
  return queue.filter((s) => !s.lastError);
}

/** UUID v4 : `crypto.randomUUID` quand il existe, repli sur `getRandomValues`. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

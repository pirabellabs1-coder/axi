import { ApiError } from "./problem";

/**
 * Pagination par curseur (keyset) de l'API REST : `?limit=1..100&cursor=<opaque>`. Réponse :
 * `{ data: [...], page: { next_cursor, has_more } }`. Le curseur est opaque (base64url) : le client le renvoie tel
 * quel, sans l'interpréter. Tri stable `createdAt desc, id desc` (pas de dérive quand des lignes sont ajoutées).
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function encodeCursor(id: string): string {
  return Buffer.from(`c1:${id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): string | undefined {
  if (raw == null || raw === "") return undefined;
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new ApiError(400, "invalid_request", "Invalid cursor.");
  const s = Buffer.from(raw, "base64url").toString("utf8");
  if (!s.startsWith("c1:") || !ID_RE.test(s.slice(3))) throw new ApiError(400, "invalid_request", "Invalid cursor.");
  return s.slice(3);
}

export function parseLimit(raw: string | null | undefined): number {
  if (raw == null || raw === "") return DEFAULT_LIMIT;
  if (!/^\d{1,4}$/.test(raw)) throw new ApiError(400, "invalid_request", `limit must be an integer between 1 and ${MAX_LIMIT}.`);
  const n = Number(raw);
  if (n < 1 || n > MAX_LIMIT) throw new ApiError(400, "invalid_request", `limit must be an integer between 1 and ${MAX_LIMIT}.`);
  return n;
}

/**
 * Un curseur bien formé mais inconnu (ligne supprimée, curseur d'une AUTRE boutique, copié-collé) fait échouer
 * Prisma avec une erreur interne (500). m5 : on vérifie son appartenance à la boutique et on répond 400.
 * `find` doit filtrer par `storeId` : aucune information ne fuit sur l'existence d'une ligne d'une autre boutique.
 */
export async function assertCursorInStore(cursorId: string | undefined, find: (id: string) => Promise<unknown>): Promise<void> {
  if (!cursorId) return;
  if (!(await find(cursorId))) throw new ApiError(400, "invalid_request", "Invalid cursor.");
}

/** Arguments Prisma pour une page (on lit limit + 1 lignes pour savoir s'il y a une suite). */
export function pageArgs(limit: number, cursorId: string | undefined) {
  return { take: limit + 1, ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}) };
}

export function toPage<T extends { id: string }, U>(rows: T[], limit: number, map: (row: T) => U): { data: U[]; page: { next_cursor: string | null; has_more: boolean } } {
  const has_more = rows.length > limit;
  const items = has_more ? rows.slice(0, limit) : rows;
  return { data: items.map(map), page: { next_cursor: has_more ? encodeCursor(items[items.length - 1].id) : null, has_more } };
}

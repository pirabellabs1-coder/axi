/**
 * Historique annuler / rétablir de l'éditeur (pur). Les frappes successives sur un même champ
 * (même `coalesceKey`, moins de `windowMs` d'écart) sont regroupées en une seule étape.
 */
export type History<T> = { past: T[]; present: T; future: T[]; lastKey: string | null; lastAt: number };

export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export function pushHistory<T>(h: History<T>, next: T, opts: { coalesceKey?: string; now?: number; windowMs?: number } = {}): History<T> {
  if (Object.is(next, h.present)) return h;
  const now = opts.now ?? Date.now();
  const key = opts.coalesceKey ?? null;
  if (key && key === h.lastKey && now - h.lastAt < (opts.windowMs ?? 800)) {
    return { ...h, present: next, future: [], lastAt: now };
  }
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], lastKey: key, lastAt: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: null, lastAt: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastKey: null, lastAt: 0 };
}

/** Remplace l'état présent sans créer d'étape (ex. document renvoyé normalisé par le serveur). */
export function replacePresent<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next };
}

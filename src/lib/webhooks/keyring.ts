/**
 * Trousseau de secrets d'un point de webhook (rotation avec double signature pendant 24 h).
 *
 * Le schéma n'a qu'une colonne `secretEnc` (pas de colonne pour l'ancien secret) : on y stocke, chiffré par
 * `encryptSecret`, un JSON `{ "v": 1, "current": "whsec_…", "previous"?: "whsec_…", "previousUntil"?: ISO }`.
 * Une valeur héritée qui serait un secret nu (`whsec_…`) est lue comme `{ current }`. Module pur.
 */

export const ROTATION_OVERLAP_MS = 24 * 3_600_000;

export type Keyring = { current: string; previous?: string; previousUntil?: string };

export function encodeKeyring(k: Keyring): string {
  return JSON.stringify({ v: 1, current: k.current, ...(k.previous ? { previous: k.previous, previousUntil: k.previousUntil } : {}) });
}

export function decodeKeyring(plain: string): Keyring {
  if (plain.startsWith("whsec_")) return { current: plain };
  const raw = JSON.parse(plain) as { v?: number; current?: unknown; previous?: unknown; previousUntil?: unknown };
  if (typeof raw.current !== "string") throw new Error("Trousseau de webhook invalide");
  return {
    current: raw.current,
    ...(typeof raw.previous === "string" && typeof raw.previousUntil === "string" ? { previous: raw.previous, previousUntil: raw.previousUntil } : {}),
  };
}

/** Secrets avec lesquels signer maintenant : le courant, plus l'ancien tant que la période de recouvrement court. */
export function signingSecrets(k: Keyring, now = new Date()): string[] {
  const out = [k.current];
  if (k.previous && k.previousUntil && new Date(k.previousUntil).getTime() > now.getTime()) out.push(k.previous);
  return out;
}

/** Rotation : le nouveau secret devient courant, l'ancien reste valide 24 h (une rotation pendant un recouvrement l'écrase). */
export function rotateKeyring(k: Keyring, next: string, now = new Date()): Keyring {
  return { current: next, previous: k.current, previousUntil: new Date(now.getTime() + ROTATION_OVERLAP_MS).toISOString() };
}

/**
 * Validation du paramètre `next` (redirection après connexion / inscription / vérification).
 * Module pur (importable côté pages, actions et tests).
 *
 * N'accepte qu'un chemin relatif à l'application : commence par « / » non suivi de « / » ou « \ »
 * (`//evil.com` et `/\evil.com` sont interprétés comme des URL absolues par les navigateurs).
 * Les caractères de contrôle sont refusés : les navigateurs suppriment tabulations et retours
 * à la ligne, ce qui transformerait `/\t/evil.com` en `//evil.com`.
 */
const SAFE_NEXT = /^\/(?![/\\])/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function safeNext(next: unknown, fallback = "/app"): string {
  if (typeof next !== "string") return fallback;
  if (next.length > 512 || CONTROL_CHARS.test(next) || !SAFE_NEXT.test(next)) return fallback;
  return next;
}

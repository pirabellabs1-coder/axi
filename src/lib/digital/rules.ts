/**
 * Règles des accès de téléchargement (vague 2) — module PUR et testé (tests/digital-downloads.test.ts).
 * Aucune lecture de base, aucune horloge implicite : `now` est toujours fourni par l'appelant.
 */

export const DEFAULT_DOWNLOAD_LIMIT = 5;
export const MAX_DOWNLOAD_LIMIT = 1000;
export const DEFAULT_DOWNLOAD_VALIDITY_DAYS = 365;
export const MAX_DOWNLOAD_VALIDITY_DAYS = 3650;

/** Débit : nombre de fichiers servis par accès et par fenêtre (anti-partage du lien). */
export const DOWNLOAD_RATE = { limit: 20, windowSec: 600 };

export type GrantState = {
  /** Jeton expiré (`expiresAt` dépassée). */
  expired: boolean;
  /** Limite de téléchargements atteinte. */
  exhausted: boolean;
  /** Téléchargements restants ; null = illimité. */
  remaining: number | null;
  /** Le fichier peut être servi. */
  usable: boolean;
};

export type GrantLike = {
  downloadCount: number;
  downloadLimit: number | null;
  expiresAt: Date | null;
};

export function grantState(g: GrantLike, now: Date): GrantState {
  const expired = !!g.expiresAt && g.expiresAt.getTime() <= now.getTime();
  const remaining = g.downloadLimit == null ? null : Math.max(0, g.downloadLimit - Math.max(0, g.downloadCount));
  const exhausted = remaining != null && remaining <= 0;
  return { expired, exhausted, remaining, usable: !expired && !exhausted };
}

/** Message unique affiché à l'acheteur (jamais de détail qui révélerait l'existence d'un autre accès). */
export function grantProblemMessage(state: GrantState): string | null {
  if (state.expired) return "Ce lien de téléchargement a expiré. Contactez la boutique pour en obtenir un nouveau.";
  if (state.exhausted) return "Le nombre de téléchargements autorisés a été atteint. Contactez la boutique si vous avez besoin d'un nouvel accès.";
  return null;
}

/** Limite retenue à l'émission : réglage produit, sinon défaut ; 0 ou négatif = illimité (null). */
export function resolveDownloadLimit(productLimit: number | null | undefined): number | null {
  if (productLimit == null) return DEFAULT_DOWNLOAD_LIMIT;
  const n = Math.floor(productLimit);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, MAX_DOWNLOAD_LIMIT);
}

/** Expiration retenue à l'émission : réglage produit en jours, sinon défaut ; 0 ou négatif = sans expiration. */
export function resolveDownloadExpiry(productDays: number | null | undefined, from: Date): Date | null {
  const days = productDays == null ? DEFAULT_DOWNLOAD_VALIDITY_DAYS : Math.floor(productDays);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(from.getTime() + Math.min(days, MAX_DOWNLOAD_VALIDITY_DAYS) * 86_400_000);
}

/** Libellé « 3 téléchargements restants sur 5 » / « Téléchargements illimités ». */
export function downloadsLabel(g: GrantLike, now: Date): string {
  const s = grantState(g, now);
  if (s.remaining == null) return "Téléchargements illimités";
  return `${s.remaining} téléchargement${s.remaining > 1 ? "s" : ""} restant${s.remaining > 1 ? "s" : ""} sur ${g.downloadLimit}`;
}

/** Taille lisible d'un fichier (pur, sans dépendance au stockage). */
export function formatFileSize(bytes: number): string {
  const MB = 1024 * 1024;
  if (bytes >= MB) return `${(bytes / MB).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("fr-FR")} Ko`;
}

/**
 * Fichiers à remettre pour une ligne de commande : ceux de la variante achetée, plus ceux communs au produit.
 * Ordre stable (position, puis nom). Pur : la liste des fichiers du produit est fournie par l'appelant.
 */
export function assetsForLine<T extends { variantId: string | null; position: number; name: string }>(assets: readonly T[], variantId: string | null): T[] {
  return assets
    .filter((a) => a.variantId == null || a.variantId === variantId)
    .slice()
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "fr"));
}

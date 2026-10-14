/**
 * Synchronisation de la caisse hors ligne (lot 3 §2) — module PUR (tests/pos-sync.test.ts).
 *
 * Règles (cas limites de la spec) :
 *  - file d'attente envoyée par lots de 20, chaque vente portant une clé d'idempotence UUID v4
 *    générée sur l'appareil : un renvoi ne crée jamais de doublon ;
 *  - au-delà de 72 h sans synchronisation, la vente est bloquée sur l'appareil (« Reconnectez la caisse ») ;
 *  - appareil révoqué : les ventes RÉELLEMENT hors ligne et antérieures à la révocation sont encore
 *    acceptées 24 h (ne pas perdre un encaissement) ; toute vente en ligne est refusée (`acceptRevokedSale`) ;
 *  - horloge faussée : `offlineCreatedAt` est borné entre la dernière synchronisation et la réception ;
 *  - « hors ligne » n'est JAMAIS déduit d'un champ du client : il exige une preuve technique
 *    (`decideOffline`), sinon le prix serveur s'impose ;
 *  - écart de prix : le serveur recalcule tout ; hors ligne, la vente est enregistrée au prix ENCAISSÉ
 *    (l'argent est en caisse) avec `priceSource = "offline_snapshot"`, l'écart étant signalé et audité.
 */

/** Taille des lots de synchronisation. */
export const SALES_BATCH_SIZE = 20;
/** Durée maximale sans synchronisation avant blocage des ventes sur l'appareil. */
export const OFFLINE_MAX_HOURS = 72;
/** Tolérance de synchronisation après la révocation d'un appareil. */
export const REVOKED_GRACE_HOURS = 24;
/** Fraîcheur de l'instantané du catalogue (rafraîchissement en ligne). */
export const CATALOG_REFRESH_MINUTES = 15;
/**
 * Écart de prix relatif maximal accepté d'un instantané hors ligne. Au-delà, le prix SERVEUR
 * s'applique : un appareil compromis ne peut pas brader le catalogue.
 */
export const MAX_OFFLINE_PRICE_DEVIATION = 0.5;

const HOUR = 3_600_000;

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR;
}

/** L'instantané du catalogue est-il périmé (vente bloquée) ? */
export function isSnapshotExpired(lastSyncAt: Date | null | undefined, now: Date = new Date(), maxHours = OFFLINE_MAX_HOURS): boolean {
  if (!lastSyncAt) return true;
  return hoursBetween(lastSyncAt, now) >= maxHours;
}

/** L'instantané doit-il être rafraîchi (appareil en ligne) ? */
export function needsCatalogRefresh(lastSyncAt: Date | null | undefined, now: Date = new Date(), minutes = CATALOG_REFRESH_MINUTES): boolean {
  if (!lastSyncAt) return true;
  return now.getTime() - lastSyncAt.getTime() >= minutes * 60_000;
}

/** Une vente d'un appareil révoqué est-elle encore acceptée ? */
export function acceptFromRevokedDevice(revokedAt: Date | null | undefined, receivedAt: Date = new Date(), graceHours = REVOKED_GRACE_HOURS): boolean {
  if (!revokedAt) return true;
  return hoursBetween(revokedAt, receivedAt) <= graceHours;
}

/* ───────────── Preuve technique du hors-ligne (correctif majeur n° 2) ───────────── */

/**
 * Écart minimal entre la date du dernier INSTANTANÉ de catalogue de l'appareil (`PosDevice.lastSyncAt`,
 * écrit par le serveur sur `GET /api/pos/{id}/catalog` uniquement) et la réception de la vente, en deçà
 * duquel l'appareil était manifestement EN LIGNE.
 *
 * Choisi strictement plus grand que `CATALOG_REFRESH_MINUTES` (15 min) : un appareil connecté rafraîchit
 * son instantané toutes les 15 minutes, il ne peut donc pas présenter un instantané vieux de 20 minutes
 * tout en étant en ligne. Et si c'est le cas, son instantané est réellement périmé : l'exception de prix
 * hors ligne est alors légitime.
 */
export const OFFLINE_MIN_GAP_MINUTES = 20;

export type OfflineReason =
  /** Aucune date déclarée : vente en ligne, prix serveur. */
  | "online"
  /** Appareil jamais synchronisé : rien ne prouve le hors-ligne (et aucun instantané n'est fiable). */
  | "no_sync"
  /** L'appareil était en ligne à l'instant de la réception : la déclaration est forgée. */
  | "device_was_online"
  /** L'instantané de prix utilisé a plus de 72 h : vente refusée (blocage serveur). */
  | "snapshot_expired"
  /** Hors-ligne prouvé. */
  | "offline";

export type OfflineDecision = { offline: boolean; reason: OfflineReason };

/**
 * Décide si une vente est RÉELLEMENT hors ligne. Fonction PURE (tests/pos-sync.test.ts).
 *
 * Le hors-ligne ouvre une exception de prix (jusqu'à 50 % d'écart conservé au prix encaissé) : il ne peut
 * donc JAMAIS être déduit d'un champ du client. Trois preuves techniques sont exigées :
 *  1. l'appareil a une dernière synchronisation connue en base (`deviceLastSyncAt`, écrite par le serveur) ;
 *  2. un écart réel entre cette synchronisation et la réception (sinon l'appareil était en ligne) ;
 *  3. la date déclarée tombe dans la fenêtre de validité de l'instantané : `claimed ≤ lastSyncAt + 72 h`
 *     (au-delà, l'instantané de prix est périmé → `snapshot_expired`, la vente est refusée, comme
 *     l'interface le fait déjà sur l'appareil).
 * Sinon : `offline = false` → le prix SERVEUR s'impose (`decidePrice`), la vente n'est pas perdue.
 */
export function decideOffline(p: {
  claimed?: Date | string | null;
  lastSyncAt?: Date | null;
  receivedAt: Date;
  minGapMinutes?: number;
  maxHours?: number;
}): OfflineDecision {
  if (!p.claimed) return { offline: false, reason: "online" };
  if (!p.lastSyncAt) return { offline: false, reason: "no_sync" };
  const gapMinutes = (p.receivedAt.getTime() - p.lastSyncAt.getTime()) / 60_000;
  if (gapMinutes < (p.minGapMinutes ?? OFFLINE_MIN_GAP_MINUTES)) return { offline: false, reason: "device_was_online" };
  // Date bornée d'abord (horloge faussée), puis fenêtre de validité de l'instantané.
  const at = clampOfflineCreatedAt({ claimed: p.claimed, lastSyncAt: p.lastSyncAt, receivedAt: p.receivedAt }).at;
  if (hoursBetween(p.lastSyncAt, at) > (p.maxHours ?? OFFLINE_MAX_HOURS)) return { offline: false, reason: "snapshot_expired" };
  return { offline: true, reason: "offline" };
}

/**
 * Une vente d'un appareil RÉVOQUÉ est-elle acceptée ? (correctif majeur n° 4)
 * La tolérance de 24 h ne vaut que pour une vente réellement hors ligne (preuve technique ci-dessus)
 * ANTÉRIEURE à la révocation : une vente en ligne, ou encaissée après la révocation, est refusée.
 * Fonction PURE (tests/pos-sync.test.ts).
 */
export function acceptRevokedSale(p: {
  revokedAt?: Date | null;
  offline: boolean;
  createdAt: Date;
  receivedAt: Date;
  graceHours?: number;
}): { ok: true } | { ok: false; error: string } {
  if (!p.revokedAt) return { ok: true };
  if (!p.offline) {
    return { ok: false, error: "Cet appareil a été révoqué : il ne peut plus encaisser. Contactez le gérant." };
  }
  if (p.createdAt.getTime() >= p.revokedAt.getTime()) {
    return { ok: false, error: "Cet appareil a été révoqué : les ventes postérieures à la révocation sont refusées." };
  }
  if (!acceptFromRevokedDevice(p.revokedAt, p.receivedAt, p.graceHours)) {
    return { ok: false, error: `Appareil révoqué depuis plus de ${p.graceHours ?? REVOKED_GRACE_HOURS} h : la file n'est plus acceptée. Contactez le gérant.` };
  }
  return { ok: true };
}

/* ───────────── Survente bornée (correctif mineur n° 14) ───────────── */

/** Quantité maximale d'UNE ligne de vente au comptoir. */
export const MAX_POS_LINE_QUANTITY = 999;
/** Survente tolérée par article et par dépôt : au-delà, la vente est refusée (saisie ou appareil douteux). */
export const MAX_OVERSELL_UNITS = 50;

/**
 * La ligne dépasse-t-elle le seuil de survente du dépôt ? Fonction PURE (tests/pos-sync.test.ts).
 * `available` est le niveau AVANT la vente ; la survente autorisée est bornée en valeur absolue.
 */
export function oversellBlocked(available: number, quantity: number, limit = MAX_OVERSELL_UNITS): boolean {
  return available - quantity < -Math.abs(limit);
}

export type ClampResult = { at: Date; clamped: boolean };

/**
 * Borne la date déclarée par l'appareil : jamais avant la borne basse connue, jamais après la réception.
 * Une date absente ou illisible vaut la date de réception.
 *
 * Borne basse (bloquant n° 4) : `sessionOpenedAt` quand elle est connue — l'ouverture de la session de
 * caisse est figée, une vente ne peut pas la précéder. `lastSyncAt` n'est qu'un MARQUEUR DE
 * SYNCHRONISATION (réécrit à chaque appel de l'API, rafraîchissement du catalogue compris) : s'en servir
 * comme borne d'horloge réhorodaterait toute la file à l'instant de la synchronisation, et la
 * retariferait aux règles de ce moment-là. Il ne sert donc de borne qu'en dernier recours (aucune
 * session connue) et pour juger de la fraîcheur de l'instantané (`decideOffline`).
 */
export function clampOfflineCreatedAt(p: { claimed?: Date | string | null; lastSyncAt?: Date | null; sessionOpenedAt?: Date | null; receivedAt: Date }): ClampResult {
  const raw = p.claimed ? new Date(p.claimed) : null;
  if (!raw || Number.isNaN(raw.getTime())) return { at: p.receivedAt, clamped: true };
  const min = p.sessionOpenedAt ?? p.lastSyncAt ?? null;
  if (min && raw.getTime() < min.getTime()) return { at: min, clamped: true };
  if (raw.getTime() > p.receivedAt.getTime()) return { at: p.receivedAt, clamped: true };
  return { at: raw, clamped: false };
}

/** UUID v4 (clé d'idempotence générée sur l'appareil). */
export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Découpe une file en lots de `size` (envoi par paquets de 20). */
export function chunk<T>(items: readonly T[], size = SALES_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  const step = Math.max(1, Math.trunc(size));
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

/** Dédoublonnage d'un lot sur la clé d'idempotence (le premier exemplaire gagne). */
export function dedupeByKey<T extends { idempotencyKey: string }>(sales: readonly T[]): { unique: T[]; duplicates: string[] } {
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: string[] = [];
  for (const s of sales) {
    if (seen.has(s.idempotencyKey)) {
      duplicates.push(s.idempotencyKey);
      continue;
    }
    seen.add(s.idempotencyKey);
    unique.push(s);
  }
  return { unique, duplicates };
}

export type PriceDecision = {
  /** Total retenu pour la commande. */
  total: number;
  priceSource: "server" | "offline_snapshot";
  /** Écart signalé (total encaissé − total recalculé) ; 0 = aucun écart. */
  gap: number;
};

/**
 * Prix retenu pour une vente :
 *  - en ligne : TOUJOURS le total recalculé par le serveur (aucun écart possible) ;
 *  - hors ligne : le total encaissé si l'écart reste dans la tolérance (l'argent est en caisse), avec
 *    `priceSource = "offline_snapshot"` ; au-delà de la tolérance, le total serveur s'impose.
 */
export function decidePrice(p: { serverTotal: number; collectedTotal: number | null | undefined; offline: boolean }): PriceDecision {
  const server = Math.round(p.serverTotal);
  if (!p.offline || p.collectedTotal == null || !Number.isFinite(p.collectedTotal)) {
    return { total: server, priceSource: "server", gap: 0 };
  }
  const collected = Math.round(p.collectedTotal);
  if (collected === server) return { total: server, priceSource: "server", gap: 0 };
  const deviation = server === 0 ? 1 : Math.abs(collected - server) / server;
  if (deviation > MAX_OFFLINE_PRICE_DEVIATION) return { total: server, priceSource: "server", gap: collected - server };
  return { total: collected, priceSource: "offline_snapshot", gap: collected - server };
}

export type QueuedSaleShape = {
  idempotencyKey: string;
  items: { productId: string; variantId?: string | null; quantity: number }[];
  payments: { kind: string; amount: number; reference?: string | null }[];
};

/** Validation de forme d'une vente reçue (avant tout accès base) : messages explicites, aucun effet. */
export function validateQueuedSale(sale: unknown): { ok: true; sale: QueuedSaleShape } | { ok: false; error: string } {
  if (!sale || typeof sale !== "object") return { ok: false, error: "Vente illisible." };
  const s = sale as Record<string, unknown>;
  if (!isUuidV4(s.idempotencyKey)) return { ok: false, error: "Clé d'idempotence invalide (UUID v4 attendu)." };
  if (!Array.isArray(s.items) || !s.items.length) return { ok: false, error: "Vente sans article." };
  if (s.items.length > 200) return { ok: false, error: "Trop d'articles dans une vente." };
  const items: QueuedSaleShape["items"] = [];
  for (const raw of s.items) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Ligne de vente illisible." };
    const i = raw as Record<string, unknown>;
    if (typeof i.productId !== "string" || !i.productId) return { ok: false, error: "Produit manquant sur une ligne." };
    const quantity = Number(i.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_POS_LINE_QUANTITY) {
      return { ok: false, error: `Quantité invalide (1 à ${MAX_POS_LINE_QUANTITY} par ligne).` };
    }
    items.push({ productId: i.productId, variantId: typeof i.variantId === "string" ? i.variantId : null, quantity });
  }
  if (!Array.isArray(s.payments) || !s.payments.length) return { ok: false, error: "Vente sans paiement." };
  const payments: QueuedSaleShape["payments"] = [];
  for (const raw of s.payments) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Paiement illisible." };
    const p = raw as Record<string, unknown>;
    const amount = Number(p.amount);
    if (typeof p.kind !== "string" || !Number.isInteger(amount) || amount <= 0) return { ok: false, error: "Paiement invalide." };
    payments.push({ kind: p.kind, amount, reference: typeof p.reference === "string" ? p.reference : null });
  }
  return { ok: true, sale: { idempotencyKey: s.idempotencyKey, items, payments } };
}

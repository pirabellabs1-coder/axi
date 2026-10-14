import { describe, it, expect } from "vitest";
import {
  acceptRevokedSale,
  decideOffline,
  decidePrice,
  MAX_OVERSELL_UNITS,
  MAX_POS_LINE_QUANTITY,
  OFFLINE_MAX_HOURS,
  OFFLINE_MIN_GAP_MINUTES,
  oversellBlocked,
  validateQueuedSale,
} from "@/lib/pos/sync";

/**
 * Correctifs de sécurité de la vague 3, côté caisse — fonctions PURES :
 *  - majeur n° 2 : « hors ligne » exige une preuve technique, jamais un champ du client ;
 *  - majeur n° 4 : un appareil révoqué ne bénéficie de la tolérance de 24 h que pour ses ventes
 *    réellement hors ligne et antérieures à la révocation ;
 *  - mineur n° 14 : quantité par ligne plafonnée et survente bornée.
 */

const SYNC = new Date("2026-10-12T08:00:00.000Z");
/** Réception bien après la synchronisation : l'appareil était donc hors ligne entre les deux. */
const RECEIVED = new Date("2026-10-12T09:00:00.000Z");

describe("majeur n° 2 — « hors ligne » doit être prouvé par le serveur", () => {
  it("accepte le hors-ligne quand l'appareil n'a plus synchronisé depuis un vrai écart", () => {
    const d = decideOffline({ claimed: new Date("2026-10-12T08:30:00.000Z"), lastSyncAt: SYNC, receivedAt: RECEIVED });
    expect(d).toEqual({ offline: true, reason: "offline" });
  });

  it("refuse le hors-ligne d'un appareil qui dialoguait avec le serveur à l'instant (champ forgé)", () => {
    // Le cas d'attaque : un caissier poste `offlineCreatedAt` depuis une caisse EN LIGNE pour s'ouvrir
    // l'exception de prix (jusqu'à 50 % sous le prix serveur).
    const justSynced = new Date(RECEIVED.getTime() - 60_000);
    const d = decideOffline({ claimed: RECEIVED, lastSyncAt: justSynced, receivedAt: RECEIVED });
    expect(d).toEqual({ offline: false, reason: "device_was_online" });
  });

  it("exige l'écart minimal, strictement supérieur au rythme de rafraîchissement du catalogue", () => {
    const justUnder = new Date(RECEIVED.getTime() - (OFFLINE_MIN_GAP_MINUTES - 1) * 60_000);
    const justOver = new Date(RECEIVED.getTime() - OFFLINE_MIN_GAP_MINUTES * 60_000);
    expect(decideOffline({ claimed: justUnder, lastSyncAt: justUnder, receivedAt: RECEIVED }).offline).toBe(false);
    expect(decideOffline({ claimed: justOver, lastSyncAt: justOver, receivedAt: RECEIVED }).offline).toBe(true);
  });

  it("refuse le hors-ligne d'un appareil jamais synchronisé (aucun instantané fiable)", () => {
    expect(decideOffline({ claimed: RECEIVED, lastSyncAt: null, receivedAt: RECEIVED })).toEqual({ offline: false, reason: "no_sync" });
  });

  it("sans date déclarée, la vente est en ligne (prix serveur)", () => {
    expect(decideOffline({ claimed: null, lastSyncAt: SYNC, receivedAt: RECEIVED })).toEqual({ offline: false, reason: "online" });
  });

  it("signale un instantané de plus de 72 h : blocage serveur, plus seulement dans l'interface", () => {
    const stale = new Date(RECEIVED.getTime() - (OFFLINE_MAX_HOURS + 2) * 3_600_000);
    const d = decideOffline({ claimed: RECEIVED, lastSyncAt: stale, receivedAt: RECEIVED });
    expect(d).toEqual({ offline: false, reason: "snapshot_expired" });
  });

  it("sans preuve, le prix SERVEUR s'impose même si l'appareil annonce un autre total", () => {
    const proof = decideOffline({ claimed: RECEIVED, lastSyncAt: new Date(RECEIVED.getTime() - 30_000), receivedAt: RECEIVED });
    // 5 000 encaissés contre 10 000 recalculés : accepté hors ligne, refusé en ligne.
    expect(decidePrice({ serverTotal: 10_000, collectedTotal: 5_000, offline: proof.offline })).toEqual({ total: 10_000, priceSource: "server", gap: 0 });
    expect(decidePrice({ serverTotal: 10_000, collectedTotal: 5_000, offline: true })).toEqual({ total: 5_000, priceSource: "offline_snapshot", gap: -5_000 });
  });
});

describe("majeur n° 4 — tolérance de 24 h d'un appareil révoqué", () => {
  const REVOKED_AT = new Date("2026-10-12T08:45:00.000Z");

  it("accepte une vente hors ligne ANTÉRIEURE à la révocation", () => {
    const r = acceptRevokedSale({ revokedAt: REVOKED_AT, offline: true, createdAt: new Date("2026-10-12T08:30:00.000Z"), receivedAt: RECEIVED });
    expect(r.ok).toBe(true);
  });

  it("refuse toute vente EN LIGNE d'un appareil révoqué", () => {
    const r = acceptRevokedSale({ revokedAt: REVOKED_AT, offline: false, createdAt: RECEIVED, receivedAt: RECEIVED });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("révoqué");
  });

  it("refuse une vente hors ligne POSTÉRIEURE à la révocation (encaissement neuf)", () => {
    const r = acceptRevokedSale({ revokedAt: REVOKED_AT, offline: true, createdAt: new Date("2026-10-12T08:50:00.000Z"), receivedAt: RECEIVED });
    expect(r.ok).toBe(false);
  });

  it("refuse au-delà de la fenêtre de 24 h", () => {
    const late = new Date(REVOKED_AT.getTime() + 25 * 3_600_000);
    const r = acceptRevokedSale({ revokedAt: REVOKED_AT, offline: true, createdAt: new Date("2026-10-12T08:30:00.000Z"), receivedAt: late });
    expect(r.ok).toBe(false);
  });

  it("n'entrave pas un appareil valide", () => {
    expect(acceptRevokedSale({ revokedAt: null, offline: false, createdAt: RECEIVED, receivedAt: RECEIVED }).ok).toBe(true);
  });
});

describe("mineur n° 14 — survente et quantités bornées", () => {
  it("plafonne la quantité d'une ligne à 999", () => {
    const base = { idempotencyKey: "3f2b4c1d-5a6e-4f8b-9c0d-1e2f3a4b5c6d", payments: [{ kind: "pos_cash", amount: 1_000 }] };
    const ok = validateQueuedSale({ ...base, items: [{ productId: "p1", quantity: MAX_POS_LINE_QUANTITY }] });
    const tooMany = validateQueuedSale({ ...base, items: [{ productId: "p1", quantity: MAX_POS_LINE_QUANTITY + 1 }] });
    expect(ok.ok).toBe(true);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toContain("Quantité invalide");
  });

  it("tolère une survente modérée (marchandise déjà remise) et refuse au-delà du seuil", () => {
    expect(oversellBlocked(0, MAX_OVERSELL_UNITS)).toBe(false);
    expect(oversellBlocked(0, MAX_OVERSELL_UNITS + 1)).toBe(true);
    // Déjà en négatif : le seuil porte sur le niveau résultant, pas sur la quantité vendue.
    expect(oversellBlocked(-MAX_OVERSELL_UNITS, 1)).toBe(true);
    expect(oversellBlocked(100, 50)).toBe(false);
  });
});

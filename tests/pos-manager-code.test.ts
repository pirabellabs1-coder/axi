import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * BLOQUANT n° 1 de l'audit de la vague 3 — code du gérant de la caisse.
 *
 * Avant : `managerOverride` arrivait dans le corps JSON de `POST /api/pos/{storeId}/sales` et annulait
 * le plafond de remise du rôle. Un caissier STAFF (plafond 10 %) pouvait donc forger une remise de
 * 100 % — marchandise gratuite — et l'historique de commande inscrivait « validée par le gérant » :
 * la preuve d'audit elle-même était falsifiée.
 *
 * Après : un vrai code numérique de 4 à 6 chiffres par boutique, haché (HMAC `APP_SECRET`, même
 * approche que `deliveryCodeFingerprint`), défini par un rôle habilité, vérifié côté serveur avec
 * compteur d'essais et limitation de débit. `managerOverride` ne peut être vrai qu'après succès.
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  /** Compteur de la fenêtre de limitation de débit, par clé (émule la table `RateLimit`). */
  hits: new Map<string, number>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async (key: string, limit: number) => {
    const n = (state.hits.get(key) ?? 0) + 1;
    state.hits.set(key, n);
    return n <= limit ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: 900 };
  }),
}));

import {
  MANAGER_CODE_MAX_LENGTH,
  MANAGER_CODE_MIN_LENGTH,
  MAX_MANAGER_CODE_ATTEMPTS,
  managerCodeFingerprint,
  managerCodeWeakness,
  normalizeManagerCode,
  verifyManagerCode,
} from "@/lib/pos/manager-code";
import { discountAllowed, MAX_DISCOUNT_PERCENT } from "@/lib/pos/cash";

const STORE = "store_mgr_1";
const OTHER = "store_mgr_2";
const CODE = "4731";

function seed(hash: string | null = managerCodeFingerprint(STORE, CODE)) {
  state.hits = new Map();
  state.fake = createFakeDb({
    store: [
      { id: STORE, name: "Boutique", posManagerCodeHash: hash, posManagerCodeSetAt: hash ? new Date() : null },
      { id: OTHER, name: "Autre", posManagerCodeHash: managerCodeFingerprint(OTHER, CODE), posManagerCodeSetAt: new Date() },
    ],
  });
}

beforeEach(() => seed());

describe("forme du code (module pur, partagé avec l'écran de caisse)", () => {
  it("accepte 4 à 6 chiffres et rien d'autre", () => {
    expect(normalizeManagerCode("4731")).toBe("4731");
    expect(normalizeManagerCode("47 31 59")).toBe("473159");
    expect(normalizeManagerCode("473")).toBeNull();
    expect(normalizeManagerCode("4731597")).toBeNull();
    expect(normalizeManagerCode("abcd")).toBeNull();
    expect(normalizeManagerCode(null)).toBeNull();
    expect(MANAGER_CODE_MIN_LENGTH).toBe(4);
    expect(MANAGER_CODE_MAX_LENGTH).toBe(6);
  });

  it("refuse les codes trivialement devinables à la définition", () => {
    expect(managerCodeWeakness("0000")).not.toBeNull();
    expect(managerCodeWeakness("1234")).not.toBeNull();
    expect(managerCodeWeakness("4321")).not.toBeNull();
    expect(managerCodeWeakness("4731")).toBeNull();
  });
});

describe("empreinte du code", () => {
  it("ne conserve jamais le code en clair et le lie à la boutique", () => {
    const h = managerCodeFingerprint(STORE, CODE);
    expect(h).not.toContain(CODE);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    // Le même code dans une autre boutique produit une autre empreinte : il n'y est pas réutilisable.
    expect(managerCodeFingerprint(OTHER, CODE)).not.toBe(h);
  });
});

describe("vérification côté serveur", () => {
  it("accepte le bon code", async () => {
    expect(await verifyManagerCode(STORE, CODE)).toEqual({ ok: true });
  });

  it("refuse un mauvais code", async () => {
    const r = await verifyManagerCode(STORE, "9999");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("mismatch");
  });

  it("refuse le code d'une AUTRE boutique (isolation)", async () => {
    // Le code en clair est le même, mais l'empreinte attendue est propre à la boutique.
    seed(managerCodeFingerprint(OTHER, CODE));
    const r = await verifyManagerCode(STORE, CODE);
    expect(r.ok).toBe(false);
  });

  it("refuse tant qu'aucun code n'est défini : jamais de dérogation par défaut", async () => {
    seed(null);
    const r = await verifyManagerCode(STORE, CODE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unset");
  });

  it("bloque après 5 essais (compteur d'essais et limite de débit)", async () => {
    for (let i = 0; i < MAX_MANAGER_CODE_ATTEMPTS; i++) {
      const r = await verifyManagerCode(STORE, "0001");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("mismatch");
    }
    // Le 6ᵉ essai est bloqué AVANT toute comparaison, même avec le bon code.
    const blocked = await verifyManagerCode(STORE, CODE);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("blocked");
  });

  it("consomme un essai même pour une saisie mal formée (pas de sondage gratuit)", async () => {
    for (let i = 0; i < MAX_MANAGER_CODE_ATTEMPTS; i++) await verifyManagerCode(STORE, "x");
    const blocked = await verifyManagerCode(STORE, CODE);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("blocked");
  });
});

describe("plafonds de remise par rôle (rappel du besoin)", () => {
  it("un STAFF reste plafonné à 10 % sans code du gérant", () => {
    expect(MAX_DISCOUNT_PERCENT.STAFF).toBe(10);
    expect(discountAllowed("STAFF", 10)).toBe(true);
    expect(discountAllowed("STAFF", 11)).toBe(false);
    expect(discountAllowed("STAFF", 100)).toBe(false);
  });
});

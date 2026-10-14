import { describe, it, expect, vi, beforeEach } from "vitest";

/** M5 : limite de débit propre à la saisie du code de vérification d'e-mail (par compte et par IP). */

const state = vi.hoisted(() => ({
  limited: false,
  rules: [] as { key: string; limit: number; windowSec: number }[],
  findFirst: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/email", () => ({ sendMail: async () => ({ ok: true }) }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/admin/mfa-server", () => ({ startMfaChallenge: async () => {} }));
vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "axi_session",
  createSession: async () => {},
  destroySession: async () => {},
  getCurrentUser: async () => ({ id: "user_aaaa", email: "Demo@Axi.Africa", emailVerified: false }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    verificationToken: {
      findFirst: async () => {
        state.findFirst++;
        return null;
      },
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: async () => "203.0.113.7",
  rateLimit: async () => ({ ok: true, retryAfter: 0 }),
  rateLimitAll: async (rules: { key: string; limit: number; windowSec: number }[]) => {
    state.rules = rules;
    return state.limited ? { ok: false, retryAfter: 600 } : { ok: true, retryAfter: 0 };
  },
  rateLimitMessage: (s: number) => `Trop de tentatives. Réessayez dans ${Math.ceil(s / 60)} minutes.`,
}));

import { verifyEmail } from "@/lib/auth/actions";

const form = (code: string) => {
  const f = new FormData();
  f.set("code", code);
  return f;
};

describe("verifyEmail : limitation de débit (M5)", () => {
  beforeEach(() => {
    state.limited = false;
    state.rules = [];
    state.findFirst = 0;
  });

  it("applique une limite par IP et par e-mail haché (jamais l'e-mail en clair)", async () => {
    const r = await verifyEmail(undefined, form("123456"));
    expect(r).toEqual({ ok: false, error: "Code invalide ou expiré.", fieldErrors: undefined });
    const keys = state.rules.map((x) => x.key);
    expect(keys).toContain("verify:ip:203.0.113.7");
    const emailRule = state.rules.find((x) => x.key.startsWith("verify:email:"))!;
    expect(emailRule).toMatchObject({ limit: 10, windowSec: 900 });
    expect(emailRule.key).not.toMatch(/axi|@/i);
    expect(state.findFirst).toBe(1);
  });

  it("au-delà de la limite : message neutre, aucun code vérifié", async () => {
    state.limited = true;
    const r = await verifyEmail(undefined, form("123456"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Trop de tentatives. Réessayez dans 10 minutes.");
    expect(state.findFirst).toBe(0);
  });

  it("un code mal formé ne consomme pas la limite", async () => {
    const r = await verifyEmail(undefined, form("12"));
    expect(!r.ok && r.error).toBe("Saisissez les 6 chiffres du code.");
    expect(state.rules).toEqual([]);
  });
});

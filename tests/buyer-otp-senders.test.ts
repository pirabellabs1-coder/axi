import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/** Lot 1, F1 : corrections d'audit sur l'envoi des codes (M1, m2), la purge (m6), l'hôte (m5) et les réglages. */

const h = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  debitOk: true,
  refunds: 0,
  budgetOk: true,
  freeQuotaOk: true,
  fetches: [] as string[],
  mails: [] as { to: string; subject: string; text: string }[],
  audits: [] as { action: string }[],
  planId: "FREE",
  freeKeys: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {} }) }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.fake.db;
  },
}));
vi.mock("@/lib/crypto", () => ({ decryptSecret: () => JSON.stringify({ token: "store-token" }) }));
vi.mock("@/lib/credits", () => ({
  debitCredits: async () => (h.debitOk ? { ok: true, balance: 10 } : { ok: false, error: "Solde insuffisant", balance: 0 }),
  refundCredits: async () => {
    h.refunds++;
    return 1;
  },
}));
vi.mock("@/lib/email", () => ({
  sendMail: async (m: { to: string; subject: string; text: string }) => {
    h.mails.push(m);
    return { ok: true };
  },
}));
vi.mock("@/lib/audit", () => ({
  audit: async (p: { action: string }) => {
    h.audits.push(p);
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async (key: string) => {
    const ok = key.startsWith("buyer-otp:platform-free:") ? h.freeQuotaOk : h.budgetOk;
    if (key.startsWith("buyer-otp:platform-free:")) h.freeKeys.push(key);
    return ok ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: 3600 };
  },
  clientIp: async () => "203.0.113.9",
  rateLimitAll: async () => ({ ok: true, retryAfter: 0 }),
  rateLimitMessage: () => "Trop de tentatives.",
}));
vi.mock("@/lib/auth/permissions", () => ({
  AuthError: class AuthError extends Error {},
  requireStore: async (storeId: string) => ({ store: { id: storeId, slug: "chez-aicha" }, planId: h.planId, user: { id: "user_aaaaaaaa" } }),
}));

import { sendBuyerOtp } from "@/lib/buyer/senders";
import { purgeBuyerAuthData } from "@/lib/buyer/purge";
import { foreignStorePath } from "@/lib/buyer/host";
import { updateAccountSettings } from "@/lib/buyer/merchant-actions";
import { resetBuyerKillSwitchCache } from "@/lib/buyer/settings";

const STORE = "store_aaaaaaaa";
const phone = { kind: "phone" as const, destination: "2290197000001" };
const base = { storeId: STORE, storeName: "Chez Aïcha\nhttps://evil.example", otpId: "otp_aaaaaaaa", code: "123456", pref: "store_whatsapp" as const };

beforeEach(() => {
  h.fake = createFakeDb({ integration: [], platformSetting: [], customerOtp: [], customerSession: [], store: [{ id: STORE, slug: "chez-aicha", accountsEnabled: true }] });
  h.debitOk = true;
  h.refunds = 0;
  h.budgetOk = true;
  h.freeQuotaOk = true;
  h.freeKeys = [];
  h.fetches = [];
  h.mails = [];
  h.audits = [];
  h.planId = "FREE";
  resetBuyerKillSwitchCache();
  process.env.AXI_OTP_WHATSAPP_PHONE_ID = "999999";
  process.env.AXI_OTP_WHATSAPP_TOKEN = "platform-token";
  vi.stubGlobal("fetch", async (url: string) => {
    h.fetches.push(url);
    return new Response("{}", { status: 200 });
  });
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete process.env.AXI_OTP_WHATSAPP_PHONE_ID;
  delete process.env.AXI_OTP_WHATSAPP_TOKEN;
});

function withStoreWhatsapp() {
  h.fake.tables.integration.push({ id: "int_aaaaaaaa", storeId: STORE, kind: "whatsapp_cloud", status: "active", phoneNumberId: "111111", secretsEncrypted: "enc", config: {} });
}

describe("M1 : envoi des codes", () => {
  it("boutique avec WhatsApp : débit refusé = pas d'envoi ni de repli sur l'expéditeur plateforme", async () => {
    withStoreWhatsapp();
    h.debitOk = false;
    const r = await sendBuyerOtp({ ...base, identifier: phone, freePlan: false });
    expect(r.delivered).toBe(false);
    expect(h.fetches).toHaveLength(0);
  });

  it("boutique avec WhatsApp : échec Meta = crédit remboursé, pas de repli plateforme", async () => {
    withStoreWhatsapp();
    vi.stubGlobal("fetch", async (url: string) => {
      h.fetches.push(url);
      return new Response("{}", { status: 500 });
    });
    const r = await sendBuyerOtp({ ...base, identifier: phone, freePlan: false });
    expect(r.delivered).toBe(false);
    expect(h.refunds).toBe(1);
    expect(h.fetches).toEqual(["https://graph.facebook.com/v21.0/111111/messages"]);
  });

  it("plan Gratuit : expéditeur plateforme dans la limite du quota quotidien par boutique", async () => {
    const r = await sendBuyerOtp({ ...base, identifier: phone, freePlan: true });
    expect(r).toMatchObject({ delivered: true, via: "platform_whatsapp" });
    expect(h.freeKeys[0]).toMatch(/^buyer-otp:platform-free:store_aaaaaaaa:\d{4}-\d{2}-\d{2}$/);
  });

  it("plan Gratuit : quota atteint = rien n'est envoyé (ni budget global consommé)", async () => {
    h.freeQuotaOk = false;
    h.budgetOk = false;
    const r = await sendBuyerOtp({ ...base, identifier: phone, freePlan: true });
    expect(r.delivered).toBe(false);
    expect(h.fetches).toHaveLength(0);
    expect(h.fake.tables.platformSetting).toHaveLength(0);
  });

  it("plan Gratuit : compté aussi dans le budget global", async () => {
    h.budgetOk = false;
    const r = await sendBuyerOtp({ ...base, identifier: phone, freePlan: true });
    expect(r.delivered).toBe(false);
    expect(h.audits.map((a) => a.action)).toContain("admin.alert.buyer_otp_budget");
  });

  it("plan payant : pas de quota Gratuit", async () => {
    await sendBuyerOtp({ ...base, identifier: phone, freePlan: false });
    expect(h.freeKeys).toHaveLength(0);
  });

  it("plan payant sans WhatsApp boutique : expéditeur plateforme", async () => {
    const r = await sendBuyerOtp({ ...base, identifier: phone, freePlan: false });
    expect(r).toMatchObject({ delivered: true, via: "platform_whatsapp" });
    expect(h.fetches).toEqual(["https://graph.facebook.com/v21.0/999999/messages"]);
  });

  it("budget plateforme dépassé : rien n'est envoyé, arrêt d'urgence activé et alerte admin", async () => {
    h.budgetOk = false;
    const r = await sendBuyerOtp({ ...base, identifier: phone, freePlan: false });
    expect(r.delivered).toBe(false);
    expect(h.fetches).toHaveLength(0);
    const kill = h.fake.tables.platformSetting.find((x) => x.key === "buyer_accounts.kill_switch");
    expect(kill?.value).toMatchObject({ enabled: true, reason: "platform_budget" });
    expect(h.audits.map((a) => a.action)).toContain("admin.alert.buyer_otp_budget");
  });

  it("m2 : objet de l'e-mail neutre, nom de boutique neutralisé dans le corps", async () => {
    const r = await sendBuyerOtp({ ...base, identifier: { kind: "email", destination: "awa@example.com" }, freePlan: false });
    expect(r.delivered).toBe(true);
    const m = h.mails[0]!;
    expect(m.subject).toBe("Votre code de connexion : 123456");
    expect(m.subject).not.toContain("Aïcha");
    expect(m.text).not.toContain("evil.example");
  });
});

describe("Décision de coordination : canal plateforme disponible dans tous les plans", () => {
  const settingsForm = (channel: string) => {
    const f = new FormData();
    f.set("storeId", STORE);
    f.set("accountsEnabled", "on");
    f.set("channel", channel);
    f.set("welcomeText", "");
    return f;
  };
  it("accepté en Gratuit (quota quotidien) comme en Starter", async () => {
    expect((await updateAccountSettings(undefined, settingsForm("platform"))).ok).toBe(true);
    expect((await updateAccountSettings(undefined, settingsForm("store_whatsapp"))).ok).toBe(true);
    h.planId = "STARTER";
    expect((await updateAccountSettings(undefined, settingsForm("platform"))).ok).toBe(true);
  });
});

describe("m6 : purge", () => {
  it("efface l'IP des sessions de plus de 30 jours sans toucher aux sessions récentes", async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    const future = new Date(Date.now() + 50 * 86_400_000);
    h.fake.tables.customerSession.push(
      { id: "s_old", storeId: STORE, customerId: "c1", ip: "203.0.113.1", createdAt: old, expiresAt: future, revokedAt: null },
      { id: "s_new", storeId: STORE, customerId: "c1", ip: "203.0.113.2", createdAt: new Date(), expiresAt: future, revokedAt: null },
    );
    h.fake.tables.customerOtp.push({ id: "o_old", storeId: STORE, ip: "203.0.113.3", createdAt: old, expiresAt: new Date(Date.now() - 20 * 86_400_000) });
    const r = await purgeBuyerAuthData();
    expect(r.sessionIps).toBe(1);
    expect(h.fake.tables.customerSession.find((s) => s.id === "s_old")!.ip).toBeNull();
    expect(h.fake.tables.customerSession.find((s) => s.id === "s_new")!.ip).toBe("203.0.113.2");
    expect(r.otpIps).toBe(1);
  });
});

describe("m5 : chemins /s/<x> sur un hôte de boutique", () => {
  it("seul le slug de l'hôte est servi", () => {
    expect(foreignStorePath("/s/chez-aicha/compte", "chez-aicha")).toBe(false);
    expect(foreignStorePath("/s/Chez-Aicha", "chez-aicha")).toBe(false);
    expect(foreignStorePath("/s/autre-boutique/compte", "chez-aicha")).toBe(true);
    expect(foreignStorePath("/s/", "chez-aicha")).toBe(true);
    expect(foreignStorePath("/s/%E0%A4%A", "chez-aicha")).toBe(true);
  });
});

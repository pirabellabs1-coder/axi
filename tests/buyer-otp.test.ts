import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Lot 1, F1 : connexion acheteur par code (§1, §8, §9).
 * Hachage, expiration, essais bornés, débits, anti-énumération, session liée à la boutique, isolation.
 */

process.env.APP_SECRET = process.env.APP_SECRET ?? "test-secret-test-secret-test-secret-0123456789";

const h = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  cookies: new Map<string, { value: string; opts?: Record<string, unknown> }>(),
  host: "localhost:3000",
  limited: false,
  rules: [] as { key: string; limit: number; windowSec: number }[],
  sent: [] as { code: string; destination: string; storeId: string }[],
  audits: [] as { action: string; target?: string }[],
  notifications: 0,
  ip: "203.0.113.9",
  pending: [] as Promise<unknown>[],
  platform: [] as boolean[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  // after() : exécuté tout de suite, attendu par flush() (l'envoi part après la réponse en production).
  after: (fn: () => Promise<unknown>) => {
    h.pending.push(fn());
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url}` });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: h.host, "user-agent": "Vitest", "x-forwarded-for": "203.0.113.9" }),
  cookies: async () => ({
    get: (name: string) => (h.cookies.has(name) ? { name, value: h.cookies.get(name)!.value } : undefined),
    set: (name: string, value: string, opts?: Record<string, unknown>) => {
      if (opts?.maxAge === 0) h.cookies.delete(name);
      else h.cookies.set(name, { value, opts });
    },
    delete: (name: string) => h.cookies.delete(name),
  }),
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.fake.db;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: async () => h.ip,
  rateLimit: async () => ({ ok: true, retryAfter: 0 }),
  normalizeIp: (v: string | null) => v ?? "unknown",
  rateLimitAll: async (rules: { key: string; limit: number; windowSec: number }[]) => {
    h.rules.push(...rules);
    return h.limited ? { ok: false, retryAfter: 600 } : { ok: true, retryAfter: 0 };
  },
  rateLimitMessage: (s: number) => `Trop de tentatives. Réessayez dans ${Math.ceil(s / 60)} minutes.`,
}));
vi.mock("@/lib/audit", () => ({
  audit: async (p: { action: string; target?: string }) => {
    h.audits.push(p);
  },
}));
vi.mock("@/lib/notifications/service", () => ({
  notifyStore: async () => {
    h.notifications++;
  },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/buyer/senders", () => ({
  sendBuyerOtp: async (p: { storeId: string; identifier: { kind: string; destination: string }; code: string; freePlan: boolean }) => {
    h.sent.push({ code: p.code, destination: p.identifier.destination, storeId: p.storeId });
    h.platform.push(p.freePlan);
    return p.identifier.kind === "email" ? { delivered: true, channel: "EMAIL", via: "email" } : { delivered: true, channel: "WHATSAPP", via: "dev_console" };
  },
}));

import {
  OTP_INVALID_MESSAGE,
  OTP_MAX_ATTEMPTS,
  OTP_SENT_MESSAGE,
  OTP_SENT_MESSAGE_EMAIL,
  FAIL_DAILY_CAP,
  buyerCookieName,
  buyerCookiePath,
  failuresFrom,
  neutralStoreName,
  platformDailyBudget,
  shouldReissue,
  hashOtp,
  hashSessionToken,
  isOtpUsable,
  isSessionValid,
  maskDestination,
  needsName,
  normalizeCode,
  otpMatches,
  otpRequestRules,
  parseIdentifier,
  shouldTouchSession,
} from "@/lib/buyer/otp";
import { requestOtp, verifyOtp, saveAddress, deleteAddress, toggleFavorite, logoutAllDevices, verifyBuyerEmail } from "@/lib/buyer/actions";
import { getBuyer } from "@/lib/buyer/session";
import { resetBuyerKillSwitchCache } from "@/lib/buyer/settings";

const STORE_A = { id: "store_aaaaaaaa", slug: "chez-aicha", name: "Chez Aïcha", status: "PUBLISHED", accountsEnabled: true, country: "BJ", currency: "XOF" };
const STORE_B = { id: "store_bbbbbbbb", slug: "mode-b", name: "Mode B", status: "PUBLISHED", accountsEnabled: true, country: "BJ", currency: "XOF" };
const PHONE = "2290197000001";

function seed(extra: Record<string, Record<string, unknown>[]> = {}) {
  h.fake = createFakeDb({
    store: [STORE_A, STORE_B],
    customer: [],
    customerOtp: [],
    customerSession: [],
    customerAddress: [],
    customerFavorite: [],
    product: [
      { id: "prod_aaaaaaaa", storeId: STORE_A.id, status: "ACTIVE", name: "Wax" },
      { id: "prod_bbbbbbbb", storeId: STORE_B.id, status: "ACTIVE", name: "Robe B" },
    ],
    platformSetting: [],
    ...extra,
  });
  (h.fake.db as Record<string, unknown>).$executeRaw = async () => 0;
}

async function flush() {
  const p = h.pending.splice(0);
  await Promise.all(p);
}

/** Demande de code + attente de l'envoi différé. */
async function ask(slug: string, identifier: string, extra: Record<string, string> = {}) {
  const r = await requestOtp(undefined, form({ slug, identifier, ...extra }));
  await flush();
  return r;
}

const form = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

async function expectRedirect(p: Promise<unknown>, to?: string) {
  const err = (await p.then(
    () => null,
    (e: { digest?: string }) => e,
  )) as { digest?: string } | null;
  expect(err?.digest).toMatch(/^NEXT_REDIRECT/);
  if (to) expect(err!.digest).toContain(to);
}

async function login(slug = STORE_A.slug, identifier = PHONE) {
  await ask(slug, identifier);
  const code = h.sent.at(-1)!.code;
  await expectRedirect(verifyOtp(undefined, form({ slug, identifier, code })));
}

beforeEach(() => {
  h.cookies.clear();
  h.host = "localhost:3000";
  h.limited = false;
  h.rules = [];
  h.sent = [];
  h.audits = [];
  h.notifications = 0;
  h.ip = "203.0.113.9";
  h.pending = [];
  h.platform = [];
  resetBuyerKillSwitchCache();
  seed();
});

/* ───────────────────────── Fonctions pures ───────────────────────── */

describe("code : hachage et comparaison", () => {
  it("HMAC lié à la boutique et à la destination, jamais le code en clair", () => {
    const a = hashOtp(STORE_A.id, PHONE, "123456");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("123456");
    expect(hashOtp(STORE_A.id, PHONE, "123456")).toBe(a);
    expect(hashOtp(STORE_B.id, PHONE, "123456")).not.toBe(a);
    expect(hashOtp(STORE_A.id, "2290197000002", "123456")).not.toBe(a);
    expect(hashOtp(STORE_A.id, PHONE, "123456", "x".repeat(40))).not.toBe(a);
  });

  it("comparaison : bon code, mauvais code, format invalide", () => {
    const stored = hashOtp(STORE_A.id, PHONE, "654321");
    expect(otpMatches(stored, STORE_A.id, PHONE, "654321")).toBe(true);
    expect(otpMatches(stored, STORE_A.id, PHONE, "654320")).toBe(false);
    expect(otpMatches(stored, STORE_B.id, PHONE, "654321")).toBe(false);
    expect(otpMatches(stored, STORE_A.id, PHONE, "65432")).toBe(false);
    expect(otpMatches(stored, STORE_A.id, PHONE, "abcdef")).toBe(false);
    expect(normalizeCode(" 65 43-21 ")).toBe("654321");
  });

  it("expiration, essais bornés et usage unique", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    const base = { codeHash: "x", attempts: 0, expiresAt: new Date(now.getTime() + 60_000), usedAt: null };
    expect(isOtpUsable(base, now)).toBe(true);
    expect(isOtpUsable({ ...base, expiresAt: now }, now)).toBe(false);
    expect(isOtpUsable({ ...base, attempts: OTP_MAX_ATTEMPTS }, now)).toBe(false);
    expect(isOtpUsable({ ...base, attempts: OTP_MAX_ATTEMPTS - 1 }, now)).toBe(true);
    expect(isOtpUsable({ ...base, usedAt: now }, now)).toBe(false);
  });
});

describe("identifiant, masquage et débits", () => {
  it("normalise les numéros béninois (10 chiffres, ancien format à 8) et les e-mails", () => {
    expect(parseIdentifier("01 97 00 00 01", "229")).toEqual({ kind: "phone", destination: PHONE });
    expect(parseIdentifier("+229 01 97 00 00 01", "229")).toEqual({ kind: "phone", destination: PHONE });
    expect(parseIdentifier("97000001", "229")).toEqual({ kind: "phone", destination: PHONE });
    expect(parseIdentifier("  Awa@Example.COM ", "229")).toEqual({ kind: "email", destination: "awa@example.com" });
    expect(parseIdentifier("pas un numéro", "229")).toBeNull();
    expect(parseIdentifier("a@b", "229")).toBeNull();
    expect(parseIdentifier(undefined, "229")).toBeNull();
  });

  it("le numéro complet n'est jamais affiché ni utilisé comme clé de débit", () => {
    expect(maskDestination({ kind: "phone", destination: PHONE })).not.toContain("97000001");
    const rules = otpRequestRules(STORE_A.id, PHONE, "203.0.113.9");
    expect(rules.map((r) => [r.limit, r.windowSec])).toEqual([
      [3, 900],
      [10, 86400],
      [10, 3600],
      [300, 3600],
      [500, 86400],
    ]);
    // Clé « destination 24 h » identique d'une boutique à l'autre (pas de storeId) ; clé IP + destination distincte par IP.
    expect(otpRequestRules(STORE_B.id, PHONE, "198.51.100.1")[1]!.key).toBe(rules[1]!.key);
    expect(otpRequestRules(STORE_A.id, PHONE, "198.51.100.1")[0]!.key).not.toBe(rules[0]!.key);
    expect(rules.some((r) => r.key.includes(PHONE))).toBe(false);
  });

  it("chemin du cookie : /s/{slug} sur le domaine principal, / sur sous-domaine ou domaine personnalisé", () => {
    expect(buyerCookiePath("localhost:3000", "chez-aicha", "localhost:3000")).toBe("/s/chez-aicha");
    expect(buyerCookiePath("axi.africa", "chez-aicha", "axi.africa")).toBe("/s/chez-aicha");
    expect(buyerCookiePath("www.axi.africa", "chez-aicha", "axi.africa")).toBe("/s/chez-aicha");
    expect(buyerCookiePath("chez-aicha.axi.africa", "chez-aicha", "axi.africa")).toBe("/");
    expect(buyerCookiePath("boutique-aicha.com", "chez-aicha", "axi.africa")).toBe("/");
  });

  it("session : liée à la boutique, révocation, expiration, glissement toutes les 10 minutes", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    const s = { storeId: STORE_A.id, expiresAt: new Date(now.getTime() + 1000), revokedAt: null, lastSeenAt: new Date(now.getTime() - 5 * 60_000) };
    expect(isSessionValid(s, STORE_A.id, now)).toBe(true);
    expect(isSessionValid(s, STORE_B.id, now)).toBe(false);
    expect(isSessionValid({ ...s, revokedAt: now }, STORE_A.id, now)).toBe(false);
    expect(isSessionValid({ ...s, expiresAt: now }, STORE_A.id, now)).toBe(false);
    expect(shouldTouchSession(s, now)).toBe(false);
    expect(shouldTouchSession({ lastSeenAt: new Date(now.getTime() - 11 * 60_000) }, now)).toBe(true);
    expect(needsName("+229 01 97 00 00 01", PHONE)).toBe(true);
    expect(needsName("Awa Dossou", PHONE)).toBe(false);
  });
});

/* ───────────────────────── Demande de code ───────────────────────── */

describe("requestOtp : anti-énumération et débits", () => {
  it("numéro inconnu : message unique, code haché, aucune fiche créée avant vérification", async () => {
    const r = await ask(STORE_A.slug, "01 97 00 00 01");
    expect(r).toMatchObject({ ok: true, message: OTP_SENT_MESSAGE });
    expect(h.fake.tables.customer).toHaveLength(0);
    const otp = h.fake.tables.customerOtp[0]!;
    expect(otp.destination).toBe(PHONE);
    expect(otp.storeId).toBe(STORE_A.id);
    expect(otp.codeHash).not.toContain(h.sent[0]!.code);
    expect(otp.codeHash).toBe(hashOtp(STORE_A.id, PHONE, h.sent[0]!.code));
    expect(otp.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(otp.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  it("numéro connu : exactement la même réponse", async () => {
    seed({ customer: [{ id: "cust_aaaaaaaa", storeId: STORE_A.id, phone: PHONE, name: "Awa" }] });
    const known = await ask(STORE_A.slug, PHONE);
    seed();
    const unknown = await ask(STORE_A.slug, PHONE);
    expect(known).toEqual(unknown);
  });

  it("e-mail sans fiche vérifiée : même message, aucun code émis", async () => {
    seed({ customer: [{ id: "cust_aaaaaaaa", storeId: STORE_A.id, phone: PHONE, name: "Awa", email: "awa@example.com", emailVerifiedAt: null }] });
    const r = await ask(STORE_A.slug, "awa@example.com");
    expect(r).toMatchObject({ ok: true, message: OTP_SENT_MESSAGE_EMAIL });
    expect(h.sent).toHaveLength(0);
    expect(h.fake.tables.customerOtp).toHaveLength(0);
  });

  it("e-mail vérifié sur UNE fiche : code émis vers cette fiche", async () => {
    seed({ customer: [{ id: "cust_aaaaaaaa", storeId: STORE_A.id, phone: PHONE, name: "Awa", email: "awa@example.com", emailVerifiedAt: new Date() }] });
    const r = await ask(STORE_A.slug, "Awa@Example.com");
    expect(r).toMatchObject({ ok: true, message: OTP_SENT_MESSAGE_EMAIL });
    expect(h.fake.tables.customerOtp[0]).toMatchObject({ customerId: "cust_aaaaaaaa", channel: "EMAIL", destination: "awa@example.com" });
  });

  it("applique les trois débits (destination, IP, boutique) et refuse au-delà", async () => {
    await ask(STORE_A.slug, PHONE);
    expect(h.rules.map((r) => r.key.split(":").slice(0, 2).join(":"))).toEqual(["buyer-otp:ipdest", "buyer-otp:dest24", "buyer-otp:ip", "buyer-otp:store", "buyer-otp:store-day"]);
    h.limited = true;
    const r = await ask(STORE_A.slug, PHONE);
    expect(r.ok).toBe(false);
    expect(h.sent).toHaveLength(1);
  });

  it("arrêt d'urgence plateforme et comptes désactivés : aucun code", async () => {
    seed({ platformSetting: [{ key: "buyer_accounts.kill_switch", value: { enabled: true, message: "" } }] });
    expect((await ask(STORE_A.slug, PHONE)).ok).toBe(false);
    resetBuyerKillSwitchCache();
    seed({ store: [{ ...STORE_A, accountsEnabled: false }] });
    expect((await ask(STORE_A.slug, PHONE)).ok).toBe(false);
    seed({ store: [{ ...STORE_A, status: "SUSPENDED" }] });
    expect((await ask(STORE_A.slug, PHONE)).ok).toBe(false);
    expect(h.sent).toHaveLength(0);
  });

  it("un nouveau code expire le précédent", async () => {
    await ask(STORE_A.slug, PHONE);
    const firstCode = h.sent[0]!.code;
    await ask(STORE_A.slug, PHONE);
    const r = await verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: PHONE, code: firstCode === h.sent[1]!.code ? "000000" : firstCode }));
    expect(r.ok).toBe(false);
  });
});

/* ───────────────────────── Vérification ───────────────────────── */

describe("verifyOtp : essais, expiration, session", () => {
  it("succès : fiche créée (téléphone vérifié), session liée à la boutique, cookie HttpOnly sur /s/{slug}", async () => {
    await login();
    const c = h.fake.tables.customer[0]!;
    expect(c).toMatchObject({ storeId: STORE_A.id, phone: PHONE });
    expect(c.phoneVerifiedAt).toBeInstanceOf(Date);
    const s = h.fake.tables.customerSession[0]!;
    expect(s).toMatchObject({ storeId: STORE_A.id, customerId: c.id });
    expect(s.revokedAt ?? null).toBeNull();
    const cookie = h.cookies.get("axi_buyer")!;
    expect(s.tokenHash).toBe(hashSessionToken(cookie.value));
    expect(s.tokenHash).not.toBe(cookie.value);
    expect(cookie.opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/s/chez-aicha", secure: false });
    expect((cookie.opts!.maxAge as number) / 86400).toBe(90);
    expect(h.fake.tables.customerOtp[0]!.usedAt).toBeInstanceOf(Date);
  });

  it("sous-domaine de boutique : cookie sur /", async () => {
    h.host = "chez-aicha.localhost:3000";
    await login();
    expect(h.cookies.get("axi_buyer")!.opts!.path).toBe("/");
  });

  it("code à usage unique", async () => {
    await ask(STORE_A.slug, PHONE);
    const code = h.sent[0]!.code;
    await expectRedirect(verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: PHONE, code })));
    const again = await verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: PHONE, code }));
    expect(again).toMatchObject({ ok: false, error: OTP_INVALID_MESSAGE });
  });

  it("5 essais au plus : le bon code est refusé après 5 échecs", async () => {
    await ask(STORE_A.slug, PHONE);
    const code = h.sent[0]!.code;
    const wrong = code === "111111" ? "222222" : "111111";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      const r = await verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: PHONE, code: wrong }));
      expect(r.ok).toBe(false);
    }
    expect(h.fake.tables.customerOtp[0]!.attempts).toBe(OTP_MAX_ATTEMPTS);
    const r = await verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: PHONE, code }));
    expect(r).toMatchObject({ ok: false, error: OTP_INVALID_MESSAGE });
    expect(h.fake.tables.customerSession).toHaveLength(0);
  });

  it("code expiré refusé", async () => {
    await ask(STORE_A.slug, PHONE);
    h.fake.tables.customerOtp[0]!.expiresAt = new Date(Date.now() - 1000);
    const r = await verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: PHONE, code: h.sent[0]!.code }));
    expect(r).toMatchObject({ ok: false, error: OTP_INVALID_MESSAGE });
  });

  it("un code de la boutique A ne connecte pas sur la boutique B", async () => {
    await ask(STORE_A.slug, PHONE);
    const r = await verifyOtp(undefined, form({ slug: STORE_B.slug, identifier: PHONE, code: h.sent[0]!.code }));
    expect(r.ok).toBe(false);
    expect(h.fake.tables.customerSession).toHaveLength(0);
  });

  it("redirection limitée aux chemins de la boutique", async () => {
    await ask(STORE_A.slug, PHONE);
    await expectRedirect(verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: PHONE, code: h.sent[0]!.code, next: "https://evil.example/x" })), "/s/chez-aicha/compte");
  });
});

/* ───────────────────────── Session et isolation ───────────────────────── */

describe("getBuyer : session liée à la boutique", () => {
  it("renvoie l'acheteur sur sa boutique, null ailleurs, null si révoquée, expirée ou comptes désactivés", async () => {
    await login();
    const buyer = await getBuyer({ id: STORE_A.id });
    expect(buyer?.customer.phone).toBe(PHONE);
    expect(await getBuyer({ id: STORE_B.id })).toBeNull();

    const s = h.fake.tables.customerSession[0]!;
    s.expiresAt = new Date(Date.now() - 1);
    expect(await getBuyer({ id: STORE_A.id })).toBeNull();
    s.expiresAt = new Date(Date.now() + 86_400_000);
    s.revokedAt = new Date();
    expect(await getBuyer({ id: STORE_A.id })).toBeNull();
    s.revokedAt = null;
    h.fake.tables.store[0]!.accountsEnabled = false;
    expect(await getBuyer({ id: STORE_A.id })).toBeNull();
  });

  it("jeton absent ou mal formé : null sans requête", async () => {
    expect(await getBuyer({ id: STORE_A.id })).toBeNull();
    h.cookies.set("axi_buyer", { value: "' OR 1=1 --" });
    expect(await getBuyer({ id: STORE_A.id })).toBeNull();
  });

  it("déconnexion de tous les appareils : toutes les sessions révoquées et journalisées", async () => {
    await login();
    await login();
    expect(h.fake.tables.customerSession).toHaveLength(2);
    await expectRedirect(logoutAllDevices(STORE_A.slug));
    expect(h.fake.tables.customerSession.every((s) => s.revokedAt instanceof Date)).toBe(true);
    expect(h.audits.at(-1)).toMatchObject({ action: "buyer.sessions_revoked" });
    expect(await getBuyer({ id: STORE_A.id })).toBeNull();
  });
});

describe("isolation des adresses et favoris", () => {
  it("adresse d'un autre client introuvable ; limite de 10 ; première adresse par défaut", async () => {
    seed({ customerAddress: [{ id: "addr_other01", storeId: STORE_A.id, customerId: "cust_other01", address: "Ailleurs", isDefault: true }] });
    await login();
    const del = await deleteAddress(STORE_A.slug, "addr_other01");
    expect(del).toMatchObject({ ok: false });
    expect(h.fake.tables.customerAddress.find((a) => a.id === "addr_other01")).toBeTruthy();
    const upd = await saveAddress(undefined, form({ slug: STORE_A.slug, id: "addr_other01", address: "Piraté" }));
    expect(upd).toMatchObject({ ok: false, error: "Adresse introuvable." });

    const ok = await saveAddress(undefined, form({ slug: STORE_A.slug, address: "Akpakpa, rue 12", label: "Maison" }));
    expect(ok.ok).toBe(true);
    const mine = h.fake.tables.customerAddress.filter((a) => a.customerId !== "cust_other01");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ storeId: STORE_A.id, isDefault: true });
    for (let i = 0; i < 9; i++) await saveAddress(undefined, form({ slug: STORE_A.slug, address: `Adresse ${i}` }));
    const full = await saveAddress(undefined, form({ slug: STORE_A.slug, address: "Onzième" }));
    expect(full.ok).toBe(false);
  });

  it("zone de livraison d'une autre boutique refusée", async () => {
    seed({ deliveryZone: [{ id: "zone_bbbbbbbb", storeId: STORE_B.id, name: "Zone B", active: true }] });
    await login();
    const r = await saveAddress(undefined, form({ slug: STORE_A.slug, address: "Cotonou", deliveryZoneId: "zone_bbbbbbbb" }));
    expect(r.ok).toBe(false);
  });

  it("favori : produit d'une autre boutique refusé, bascule sur un produit de la boutique", async () => {
    await login();
    expect(await toggleFavorite(STORE_A.slug, "prod_bbbbbbbb")).toMatchObject({ ok: false, error: "Produit introuvable." });
    expect(await toggleFavorite(STORE_A.slug, "prod_aaaaaaaa")).toMatchObject({ ok: true, data: { favorited: true } });
    expect(h.fake.tables.customerFavorite[0]).toMatchObject({ storeId: STORE_A.id, productId: "prod_aaaaaaaa" });
    expect(await toggleFavorite(STORE_A.slug, "prod_aaaaaaaa")).toMatchObject({ ok: true, data: { favorited: false } });
    expect(h.fake.tables.customerFavorite).toHaveLength(0);
  });

  it("non connecté : aucune écriture", async () => {
    expect((await toggleFavorite(STORE_A.slug, "prod_aaaaaaaa")).ok).toBe(false);
    expect((await saveAddress(undefined, form({ slug: STORE_A.slug, address: "Cotonou" }))).ok).toBe(false);
    expect(h.fake.tables.customerFavorite).toHaveLength(0);
    expect(h.fake.tables.customerAddress).toHaveLength(0);
  });

  it("session de la boutique A sans effet sur la boutique B", async () => {
    await login(STORE_A.slug);
    expect((await toggleFavorite(STORE_B.slug, "prod_bbbbbbbb")).ok).toBe(false);
  });
});

/* ───────────────────────── Corrections de l'audit de sécurité ───────────────────────── */

describe("audit : règles pures", () => {
  it("m4 : échecs comptés sur 24 h (un code consommé compte un essai réussi)", () => {
    expect(failuresFrom([{ attempts: 3, usedAt: null }, { attempts: 2, usedAt: new Date() }, { attempts: 0, usedAt: null }])).toBe(4);
  });

  it("m3 : un code actif n'est remplacé que depuis la même IP", () => {
    expect(shouldReissue(null, "1.1.1.1")).toBe(true);
    expect(shouldReissue({ ip: "1.1.1.1" }, "1.1.1.1")).toBe(true);
    expect(shouldReissue({ ip: "1.1.1.1" }, "2.2.2.2")).toBe(false);
  });

  it("m2 : nom de boutique neutralisé (pas de lien, pas de saut de ligne, 60 caractères)", () => {
    expect(neutralStoreName("Promo\nhttps://evil.example/x <b>Gagnez</b>")).toBe("Promo bGagnez/b");
    expect(neutralStoreName("x".repeat(100))).toHaveLength(60);
    expect(neutralStoreName("   ")).toBe("la boutique");
  });

  it("M1 : budget plateforme par défaut 2000, configurable", () => {
    expect(platformDailyBudget(undefined)).toBe(2000);
    expect(platformDailyBudget("50")).toBe(50);
    expect(platformDailyBudget("abc")).toBe(2000);
  });

  it("m5 : cookie __Host- seulement sur un hôte de boutique en HTTPS", () => {
    expect(buyerCookieName("chez-aicha.axi.africa", "axi.africa", true)).toBe("__Host-axi_buyer");
    expect(buyerCookieName("boutique-aicha.com", "axi.africa", true)).toBe("__Host-axi_buyer");
    expect(buyerCookieName("axi.africa", "axi.africa", true)).toBe("axi_buyer");
    expect(buyerCookieName("chez-aicha.localhost:3000", "localhost:3000", false)).toBe("axi_buyer");
  });
});

describe("audit : émission et vérification", () => {
  it("m3 : une demande depuis une autre IP n'invalide pas le code en cours", async () => {
    await ask(STORE_A.slug, PHONE);
    const code = h.sent[0]!.code;
    h.ip = "198.51.100.77";
    const r = await ask(STORE_A.slug, PHONE);
    expect(r).toMatchObject({ ok: true, message: OTP_SENT_MESSAGE });
    expect(h.fake.tables.customerOtp).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
    h.ip = "203.0.113.9";
    await expectRedirect(verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: PHONE, code })));
  });

  it("m2 : seuls les codes du même client sont expirés", async () => {
    const future = new Date(Date.now() + 5 * 60_000);
    seed({
      customer: [
        { id: "cust_owner01", storeId: STORE_A.id, phone: PHONE, name: "Awa", email: "awa@example.com", emailVerifiedAt: new Date() },
        { id: "cust_other01", storeId: STORE_A.id, phone: "2290197000009", name: "Autre" },
      ],
      customerSession: [],
    });
    h.fake.tables.customerOtp.push({ id: "otp_owner001", storeId: STORE_A.id, customerId: "cust_owner01", channel: "EMAIL", destination: "awa@example.com", codeHash: hashOtp(STORE_A.id, "awa@example.com", "424242"), attempts: 0, expiresAt: future, usedAt: null, ip: "198.51.100.1", createdAt: new Date() });
    // Un autre client demande la vérification de cette adresse : le code de connexion du titulaire reste valable.
    h.fake.tables.customerSession.push({ id: "sess_other01", storeId: STORE_A.id, customerId: "cust_other01", tokenHash: hashSessionToken("A".repeat(43)), expiresAt: future, revokedAt: null, lastSeenAt: new Date() });
    h.cookies.set("axi_buyer", { value: "A".repeat(43) });
    const r = await verifyBuyerEmail(undefined, form({ slug: STORE_A.slug, email: "awa@example.com" }));
    await flush();
    expect(r.ok).toBe(true);
    expect(h.rules.some((x) => x.key === "buyer-email-verify:cust_other01" && x.limit === 3 && x.windowSec === 86400)).toBe(true);
    expect(h.fake.tables.customerOtp.find((o) => o.id === "otp_owner001")!.expiresAt).toEqual(future);
  });

  it("m1 : connexion par e-mail, toujours le même message d'échec (sans compteur d'essais)", async () => {
    seed({ customer: [{ id: "cust_aaaaaaaa", storeId: STORE_A.id, phone: PHONE, name: "Awa", email: "awa@example.com", emailVerifiedAt: new Date() }] });
    await ask(STORE_A.slug, "awa@example.com");
    const code = h.sent[0]!.code;
    const wrong = code === "111111" ? "222222" : "111111";
    const r1 = await verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: "awa@example.com", code: wrong }));
    const r2 = await verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: "nobody@example.com", code: wrong }));
    expect(r1).toEqual(r2);
    expect(r1).toMatchObject({ ok: false, error: OTP_INVALID_MESSAGE });
  });

  it("m4 : au-delà de 20 échecs sur 24 h, plus de code ni de vérification pour ce numéro", async () => {
    const past = new Date(Date.now() - 3600_000);
    seed({
      customerOtp: Array.from({ length: FAIL_DAILY_CAP / 5 }, (_, i) => ({ id: `otp_lock${i}aaaa`, storeId: STORE_A.id, customerId: null, channel: "WHATSAPP", destination: PHONE, codeHash: "x", attempts: 5, expiresAt: past, usedAt: null, createdAt: new Date(Date.now() - 1800_000) })),
    });
    const r = await ask(STORE_A.slug, PHONE);
    expect(r).toMatchObject({ ok: true, message: OTP_SENT_MESSAGE });
    expect(h.sent).toHaveLength(0);
    const v = await verifyOtp(undefined, form({ slug: STORE_A.slug, identifier: PHONE, code: "123456" }));
    expect(v.ok).toBe(false);
    expect(h.fake.tables.usageCounter?.some((c) => c.metric === "otp:locked")).toBe(true);
    // Une autre boutique n'est pas bloquée.
    await ask(STORE_B.slug, PHONE);
    expect(h.sent).toHaveLength(1);
  });

  it("plan Gratuit signalé à l'envoi (quota de l'expéditeur plateforme)", async () => {
    await ask(STORE_A.slug, PHONE);
    expect(h.fake.tables.customerOtp).toHaveLength(1);
    // Sans abonnement : plan Gratuit.
    seed({ subscription: [{ id: "sub_aaaaaaaa", storeId: STORE_A.id, planId: "BUSINESS", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) }] });
    await ask(STORE_A.slug, PHONE);
    await ask(STORE_B.slug, PHONE);
    expect(h.platform.slice(-2)).toEqual([false, true]);
  });
});

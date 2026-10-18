import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Quota de boutiques au niveau du COMPTE : limite du meilleur plan possédé + options « Boutique en plus »
 * en vigueur sur toutes les boutiques possédées ; création refusée au-delà (contrôle serveur, anti-course).
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/locations/service", () => ({ ensureDefaultLocationTx: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireUserOrThrow: vi.fn(async () => ({ id: "user_A", email: "a@example.com" })),
    requireStore: vi.fn(async (storeId: string) => {
      const store = state.fake!.tables.store.find((s) => s.id === storeId);
      if (!store) throw new AuthError("Boutique introuvable");
      return { user: { id: "user_A" }, store, role: "OWNER", planId: "BUSINESS", can: () => true };
    }),
  };
});

import { accountStoresQuota, storesBeyondLimit, type OwnedStoreForQuota } from "@/lib/store/account-quota";
import { getAccountStoresQuota } from "@/lib/store/account-quota-service";
import { createStore, setStoreStatus } from "@/lib/store/actions";
import { PLANS, TRIAL_PLAN } from "@/config/plans";

const DAY = 86_400_000;
const t0 = new Date("2026-01-01T00:00:00Z");
const st = (id: string, planId: OwnedStoreForQuota["planId"], extraStores = 0, ageDays = 0, status = "PUBLISHED"): OwnedStoreForQuota => ({
  id,
  planId,
  extraStores,
  status,
  createdAt: new Date(t0.getTime() + ageDays * DAY),
});

describe("accountStoresQuota (pur)", () => {
  it("première boutique : toujours autorisée", () => {
    const q = accountStoresQuota([]);
    expect(q.allowed).toBe(true);
    expect(q.firstStore).toBe(true);
  });

  it("limite = meilleur plan + options de TOUTES les boutiques possédées", () => {
    const q = accountStoresQuota([st("a", "BUSINESS", 1, 0), st("b", "FREE", 0, 1), st("c", "FREE", 2, 2)]);
    expect(q.bestPlan).toBe("BUSINESS");
    expect(q.baseLimit).toBe(1);
    expect(q.extraStores).toBe(3);
    expect(q.limit).toBe(4);
    expect(q.used).toBe(3);
    expect(q.allowed).toBe(true);
    expect(q.primaryStoreId).toBe("a");
    expect(q.canBuyExtra).toBe(true);
  });

  it("limite atteinte sans option : refus, achat possible en Business/Scale", () => {
    const q = accountStoresQuota([st("a", "SCALE", 0, 0), st("b", "FREE", 0, 1), st("c", "FREE", 0, 2)]);
    expect(q.limit).toBe(3);
    expect(q.allowed).toBe(false);
    expect(q.canBuyExtra).toBe(true);
    expect(q.primaryStoreId).toBe("a");
  });

  it("plan non éligible (Gratuit/Starter) : refus et pas d'achat d'option", () => {
    for (const plan of ["FREE", "STARTER"] as const) {
      const q = accountStoresQuota([st("a", plan)]);
      expect(q.allowed).toBe(false);
      expect(q.canBuyExtra).toBe(false);
    }
  });

  it("boutiques archivées : ni usage, ni plan, ni options", () => {
    const q = accountStoresQuota([st("a", "SCALE", 5, 0, "ARCHIVED"), st("b", "STARTER", 0, 1)]);
    expect(q.used).toBe(1);
    expect(q.bestPlan).toBe("STARTER");
    expect(q.limit).toBe(1);
    expect(q.allowed).toBe(false);
  });

  it("plan illimité (Enterprise)", () => {
    const q = accountStoresQuota([st("a", "ENTERPRISE"), st("b", "FREE", 0, 1)]);
    expect(q.limit).toBeNull();
    expect(q.allowed).toBe(true);
  });

  it("au-delà de la limite : ce sont les plus récentes qui dépassent", () => {
    const stores = [st("old", "BUSINESS", 0, 0), st("mid", "FREE", 0, 5), st("new", "FREE", 0, 9)];
    expect(storesBeyondLimit(stores, 2).map((s) => s.id)).toEqual(["new"]);
    expect(storesBeyondLimit(stores, null)).toEqual([]);
  });
});

/* ───────────────────────── createStore (serveur) ───────────────────────── */

const future = new Date(Date.now() + 20 * DAY);
const past = new Date(Date.now() - 2 * DAY);

function seed(opts: { plan: "BUSINESS" | "STARTER"; extra?: { status: "ACTIVE" | "PENDING" | "CANCELLED"; endsAt: Date | null } }) {
  state.fake = createFakeDb({
    user: [{ id: "user_A", email: "a@example.com" }],
    store: [{ id: "store_main", slug: "principale", name: "Principale", status: "PUBLISHED", currency: "EUR", createdAt: new Date(Date.now() - 100 * DAY) }],
    subscription: [{ id: "sub_main", storeId: "store_main", planId: opts.plan, status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: future, zone: "WORLD", currency: "EUR" }],
    membership: [{ id: "m_main", userId: "user_A", storeId: "store_main", role: "OWNER" }],
    addOnPurchase: opts.extra
      ? [{ id: "ap_1", storeId: "store_main", addOnId: "EXTRA_STORE", quantity: 1, status: opts.extra.status, startsAt: new Date(Date.now() - 10 * DAY), endsAt: opts.extra.endsAt }]
      : [],
  });
  // Relations utilisées par la création (memberships.create / subscription.create imbriqués) : non gérées par la base
  // factice → on rattache à la main la boutique créée au compte pour que le quota la voie.
  const store = state.fake.db.store;
  const create = store.create;
  store.create = async (args: { data: Record<string, unknown> }) => {
    const { subscription, memberships, paymentMethods, deliveryZones, ...data } = args.data;
    void paymentMethods;
    void deliveryZones;
    const row = await create({ data: { status: "DRAFT", createdAt: new Date(), ...data } });
    const sub = (subscription as { create: Record<string, unknown> }).create;
    state.fake!.tables.subscription.push({ id: `sub_${row.id}`, storeId: row.id, trialEndsAt: null, currentPeriodEnd: null, ...sub });
    const m = (memberships as { create: Record<string, unknown> }).create;
    state.fake!.tables.membership.push({ id: `m_${row.id}`, storeId: row.id, ...m });
    return row;
  };
}

function fd(slug: string) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: `Boutique ${slug}`, slug, country: "FR", currency: "EUR", sector: "general" })) f.set(k, v);
  return f;
}

async function create(slug: string) {
  try {
    return await createStore(undefined, fd(slug));
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (digest?.startsWith("NEXT_REDIRECT")) return { ok: true as const, redirect: digest };
    throw e;
  }
}

const ownedCount = () => state.fake!.tables.membership.filter((m) => m.userId === "user_A" && m.role === "OWNER").length;

describe("createStore : quota au niveau du compte", () => {
  beforeEach(() => seed({ plan: "BUSINESS" }));

  it("refuse au-delà de la limite sans option payée, avec message « payer d'abord »", async () => {
    const r = await create("deuxieme");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Boutique en plus/);
    expect(ownedCount()).toBe(1);
  });

  it("une option en attente de paiement ne débloque rien", async () => {
    seed({ plan: "BUSINESS", extra: { status: "PENDING", endsAt: null } });
    expect((await create("deuxieme")).ok).toBe(false);
  });

  it("accepte après option active (comptée au niveau du compte), puis refuse la suivante", async () => {
    seed({ plan: "BUSINESS", extra: { status: "ACTIVE", endsAt: future } });
    const q = await getAccountStoresQuota("user_A");
    expect(q.limit).toBe(2);
    const r = await create("deuxieme");
    expect(r.ok).toBe(true);
    expect(ownedCount()).toBe(2);
    // La nouvelle boutique est sur Gratuit : le plan Business de la principale + l'option font toujours foi.
    expect((await create("troisieme")).ok).toBe(false);
    expect(ownedCount()).toBe(2);
  });

  it("option résiliée encore dans sa période : compte ; échue : ne compte plus", async () => {
    seed({ plan: "BUSINESS", extra: { status: "CANCELLED", endsAt: future } });
    expect((await getAccountStoresQuota("user_A")).limit).toBe(2);
    seed({ plan: "BUSINESS", extra: { status: "CANCELLED", endsAt: past } });
    expect((await getAccountStoresQuota("user_A")).limit).toBe(1);
  });

  it("plan non éligible : refus avec renvoi vers le plan Business", async () => {
    seed({ plan: "STARTER" });
    const r = await create("deuxieme");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/plan Business/);
  });

  it("course : deux créations simultanées avec une seule place → une seule réussit", async () => {
    seed({ plan: "BUSINESS", extra: { status: "ACTIVE", endsAt: future } });
    // Simule le verrou de ligne User (SELECT … FOR UPDATE) : transactions sérialisées comme en base.
    const fake = state.fake!;
    const original = fake.db.$transaction;
    let chain: Promise<unknown> = Promise.resolve();
    fake.db.$transaction = (fn: (tx: unknown) => Promise<unknown>) => {
      const run = chain.then(() => original(fn));
      chain = run.catch(() => undefined);
      return run;
    };
    const [a, b] = await Promise.all([create("course-a"), create("course-b")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(ownedCount()).toBe(2);
    // Le verrou est bien posé dans la transaction de création.
    expect(fake.calls.some((c) => c.model === "$raw" && /FROM "User".*FOR UPDATE/.test(String((c.args as { sql: string }).sql)))).toBe(true);
  });
});

describe("audit M2 : essai Business", () => {
  it("le plan d'essai n'inclut qu'une boutique (constat « 3 boutiques gratuites » infondé)", () => {
    expect(TRIAL_PLAN).toBe("BUSINESS");
    expect(PLANS.BUSINESS.limits.stores).toBe(1);
  });

  it("compte en essai (TRIALING) : la 2e boutique exige l'option payée", async () => {
    seed({ plan: "BUSINESS" });
    Object.assign(state.fake!.tables.subscription[0], { status: "TRIALING", trialEndsAt: future });
    const r = await create("pendant-essai");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Boutique en plus/);
  });
});

describe("audit M3 : sortie d'archive", () => {
  function addArchived() {
    state.fake!.tables.store.push({ id: "store_arch", slug: "archivee", name: "Archivée", status: "ARCHIVED", currency: "EUR", createdAt: new Date() });
    state.fake!.tables.subscription.push({ id: "sub_arch", storeId: "store_arch", planId: "FREE", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null });
    state.fake!.tables.membership.push({ id: "m_arch", userId: "user_A", storeId: "store_arch", role: "OWNER" });
  }
  const statusOf = (id: string) => state.fake!.tables.store.find((s) => s.id === id)!.status;

  it("désarchivage refusé sans place libre, avec proposition de payer l'option", async () => {
    seed({ plan: "BUSINESS" });
    addArchived();
    const r = await setStoreStatus("store_arch", "CLOSED_TEMPORARILY");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Boutique en plus/);
    expect(statusOf("store_arch")).toBe("ARCHIVED");
    expect(state.fake!.calls.some((c) => c.model === "$raw" && /FOR UPDATE/.test(String((c.args as { sql: string }).sql)))).toBe(true);
  });

  it("désarchivage accepté avec une option active", async () => {
    seed({ plan: "BUSINESS", extra: { status: "ACTIVE", endsAt: future } });
    addArchived();
    const r = await setStoreStatus("store_arch", "CLOSED_TEMPORARILY");
    expect(r.ok).toBe(true);
    expect(statusOf("store_arch")).toBe("CLOSED_TEMPORARILY");
  });
});

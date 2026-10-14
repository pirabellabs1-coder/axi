import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/** m3 : révocation possible même boutique suspendue ; n4 : plafond de jetons compté sous verrou de la boutique. */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  ctx: null as null | Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
// Reproduit la règle réelle de requireStore : boutique suspendue → seules store.view, export, billing.manage.
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {
    constructor(message = "Accès refusé", public code = "FORBIDDEN") {
      super(message);
    }
  }
  return {
    AuthError,
    loadStoreContext: async () => state.ctx,
    requireStore: async (_id: string, cap: string) => {
      const ctx = state.ctx as { store: { status: string } };
      if (ctx.store.status === "SUSPENDED" && !["store.view", "export", "billing.manage"].includes(cap)) throw new AuthError("Boutique suspendue : contactez le support");
      return ctx;
    },
  };
});

import { createApiToken, revokeApiToken, revokeOAuthGrant } from "@/lib/mcp/actions";

function seed(status = "PUBLISHED", planId = "FREE") {
  state.fake = createFakeDb({
    apiToken: [],
    oAuthGrant: [{ id: "grant_aaaa", storeId: "store_a", userId: "uA", revokedAt: null, clientId: "c1" }],
    oAuthClient: [{ id: "c1", name: "Claude" }],
    oAuthToken: [{ id: "otok1111", grantId: "grant_aaaa", kind: "access", revokedAt: null }],
  });
  state.ctx = { user: { id: "uA", name: "Owner", emailVerified: true }, store: { id: "store_a", slug: "a", status }, planId, role: "OWNER", can: () => true };
}

beforeEach(() => seed());

describe("m3 : révocations en boutique suspendue", () => {
  it("créer un jeton est refusé, le révoquer reste possible", async () => {
    seed("PUBLISHED");
    const created = await createApiToken("store_a", { name: "Bureau", scopes: ["catalog:read"], expiresInDays: 30 });
    expect(created.ok).toBe(true);
    (state.ctx as { store: { status: string } }).store.status = "SUSPENDED";
    expect((await createApiToken("store_a", { name: "Autre", scopes: ["catalog:read"], expiresInDays: 30 })).ok).toBe(false);
    const id = state.fake!.tables.apiToken[0].id;
    const r = await revokeApiToken("store_a", id);
    expect(r).toMatchObject({ ok: true });
    expect(state.fake!.tables.apiToken[0].revokedAt).toBeInstanceOf(Date);
  });

  it("déconnecter une application OAuth en boutique suspendue", async () => {
    seed("SUSPENDED");
    const r = await revokeOAuthGrant("store_a", "grant_aaaa");
    expect(r).toMatchObject({ ok: true });
    expect(state.fake!.tables.oAuthGrant[0].revokedAt).toBeInstanceOf(Date);
    expect(state.fake!.tables.oAuthToken[0].revokedAt).toBeInstanceOf(Date);
  });
});

describe("n4 : plafond de jetons", () => {
  it("compté dans la transaction après verrou de la boutique (SELECT … FOR UPDATE)", async () => {
    seed("PUBLISHED", "FREE");
    expect((await createApiToken("store_a", { name: "Premier", scopes: ["catalog:read"], expiresInDays: 0 })).ok).toBe(true);
    const second = await createApiToken("store_a", { name: "Second", scopes: ["catalog:read"], expiresInDays: 0 });
    expect(second).toMatchObject({ ok: false });
    expect(!second.ok && second.error).toMatch(/Limite atteinte : 1\/1/);
    const calls = state.fake!.calls;
    const lock = calls.findIndex((c) => c.op === "queryRaw" && /FROM "Store".*FOR UPDATE/.test(c.args.sql));
    const count = calls.findIndex((c, i) => i > lock && c.model === "apiToken" && c.op === "count");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(count).toBeGreaterThan(lock);
    expect(state.fake!.tables.apiToken).toHaveLength(1);
  });

  it("le secret n'est jamais stocké : seul le hachage", async () => {
    const r = await createApiToken("store_a", { name: "Bureau", scopes: ["store:read"], expiresInDays: 7 });
    const row = state.fake!.tables.apiToken[0];
    expect(r.ok && r.data!.token.startsWith(row.prefix)).toBe(true);
    expect(JSON.stringify(row)).not.toContain(r.ok ? r.data!.token : "x");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb } from "./helpers/fake-db";

/**
 * Audit de sécurité App Store v2 (13/10/2026) — non-régressions côté actions :
 *  - M1 : une app PUBLISHED qui change l'origine de appUrl / webhookUrl repasse IN_REVIEW et est délistée ;
 *  - N1 : à la réinstallation, l'ancien grant et ses jetons sont révoqués ;
 *  - N4 : les onglets du portail exigent un e-mail vérifié.
 * (M2/F1/F3/N2 : tests/apps-int.test.ts ; F4 : tests/apps-dev-portal.test.ts ; F5 : tests/apps-collaborators.test.ts.)
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  user: { id: "u1", email: "dev@x.test", name: "Dev", emailVerified: true } as { id: string; email: string; name: string; emailVerified: boolean },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${to}` });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => state.user) }));
vi.mock("@/lib/auth/permissions", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/permissions")>();
  return {
    ...orig,
    requireStore: vi.fn(async (storeId: string) => {
      const store = state.fake!.tables.store.find((s) => s.id === storeId)!;
      return { user: state.user, store, role: "OWNER", planId: "BUSINESS", can: () => true };
    }),
  };
});

process.env.NEXT_PUBLIC_APP_URL = "https://axi.test";

import { updateApp } from "@/lib/apps/dev-actions";
import { installApp } from "@/lib/apps/actions";
import { requiresReReview, urlOrigin } from "@/lib/apps/dev-logic";
import { APP_CATEGORIES } from "@/lib/apps/types";
import { loadAppTab } from "@/app/app/[storeId]/developpeur/apps/[appId]/_data";

const APP_ID = "app_AAAAAAAAAAAA";
const STORE = "store_SSSSSSSS";

function seed(appOverrides: Record<string, unknown> = {}) {
  state.fake = createFakeDb({
    user: [{ id: "u1", email: "dev@x.test", name: "Dev" }],
    store: [{ id: STORE, name: "Chez Test", slug: "chez-test", status: "PUBLISHED" }],
    subscription: [{ id: "sub1", storeId: STORE, planId: "BUSINESS", status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 86_400_000) }],
    oAuthClient: [{ id: "cApp", clientId: "axi_cli_app", clientSecretHash: "h", name: "Mon App", redirectUris: ["https://app.example.com/cb"], disabledAt: null }],
    app: [
      {
        id: APP_ID, slug: "mon-app", name: "Mon App", status: "PUBLISHED", listed: true, developerUserId: "u1", oauthClientId: "axi_cli_app",
        requestedScopes: ["catalog:read"], appUrl: "https://app.example.com/embed", webhookUrl: "https://hooks.example.com/axi",
        pricingType: "FREE", priceAmount: 0, priceInterval: null, trialDays: 0, installCount: 0, ...appOverrides,
      },
    ],
  });
}

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const v: Record<string, string> = {
    name: "Mon App", category: APP_CATEGORIES[0].id, requestedScopes: "catalog:read", pricingType: "FREE",
    redirectUris: "https://app.example.com/cb", appUrl: "https://app.example.com/embed", webhookUrl: "https://hooks.example.com/axi", ...over,
  };
  for (const [k, x] of Object.entries(v)) f.append(k, x);
  return f;
}

const app = () => state.fake!.tables.app[0];

beforeEach(() => {
  state.user = { id: "u1", email: "dev@x.test", name: "Dev", emailVerified: true };
  seed();
});

describe("M1 : origine de appUrl / webhookUrl sous gouvernance", () => {
  it("règle pure : changement d'origine → re-revue ; même origine, autre chemin → non", () => {
    const cur = { requestedScopes: ["a"], redirectUris: ["https://x.test/cb"], appUrl: "https://app.test/embed", webhookUrl: "https://app.test/hooks" };
    expect(requiresReReview("PUBLISHED", cur, { ...cur, appUrl: "https://evil.test/embed" })).toBe(true);
    expect(requiresReReview("PUBLISHED", cur, { ...cur, webhookUrl: "https://evil.test/hooks" })).toBe(true);
    expect(requiresReReview("PUBLISHED", cur, { ...cur, appUrl: "https://app.test:8443/embed" })).toBe(true);
    expect(requiresReReview("PUBLISHED", cur, { ...cur, appUrl: null })).toBe(true);
    expect(requiresReReview("PUBLISHED", cur, { ...cur, appUrl: "https://app.test/v2/embed", webhookUrl: "https://app.test/v2/hooks" })).toBe(false);
    expect(requiresReReview("DRAFT", cur, { ...cur, appUrl: "https://evil.test/embed" })).toBe(false);
    expect(urlOrigin("pas une url")).toBeNull();
  });

  it("updateApp : nouvelle origine d'appUrl → IN_REVIEW et délistée", async () => {
    const r = await updateApp(APP_ID, form({ appUrl: "https://evil.example.net/embed" }));
    expect(r.ok).toBe(true);
    expect(app()).toMatchObject({ status: "IN_REVIEW", listed: false, appUrl: "https://evil.example.net/embed" });
  });

  it("updateApp : nouvelle origine de webhookUrl → IN_REVIEW et délistée", async () => {
    expect((await updateApp(APP_ID, form({ webhookUrl: "https://collecte.example.net/x" }))).ok).toBe(true);
    expect(app()).toMatchObject({ status: "IN_REVIEW", listed: false });
  });

  it("updateApp : même origine (chemin différent) et description → reste publiée", async () => {
    expect((await updateApp(APP_ID, form({ appUrl: "https://app.example.com/v2", description: "Nouvelle description" }))).ok).toBe(true);
    expect(app()).toMatchObject({ status: "PUBLISHED", listed: true });
  });
});

describe("N1 : réinstallation → ancien grant et jetons révoqués", () => {
  it("installation SUSPENDED réactivée : le grant précédent et ses jetons sont révoqués, un nouveau grant est lié", async () => {
    const t = state.fake!.tables;
    t.oAuthGrant = [{ id: "gOld", clientId: "cApp", userId: "u1", storeId: STORE, scopes: ["catalog:read"], resource: "https://axi.test/api/mcp", revokedAt: null }];
    t.oAuthToken = [{ id: "tOld", grantId: "gOld", kind: "access", tokenHash: "x", expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null, usedAt: null }];
    t.appInstallation = [{ id: "inst1", appId: APP_ID, storeId: STORE, status: "SUSPENDED", grantedScopes: ["catalog:read"], oauthGrantId: "gOld", installedAt: new Date(), uninstalledAt: null }];

    const r = await installApp(STORE, "mon-app");
    expect(r.ok).toBe(true);
    expect(t.oAuthGrant.find((g) => g.id === "gOld")!.revokedAt).toBeInstanceOf(Date);
    expect(t.oAuthToken.find((x) => x.id === "tOld")!.revokedAt).toBeInstanceOf(Date);
    const inst = t.appInstallation[0];
    expect(inst.status).toBe("ACTIVE");
    expect(inst.oauthGrantId).not.toBe("gOld");
    expect(t.oAuthGrant.find((g) => g.id === inst.oauthGrantId)!.revokedAt ?? null).toBeNull();
  });
});

describe("N4 : portail — e-mail vérifié exigé pour les onglets d'une app", () => {
  const params = Promise.resolve({ storeId: STORE, appId: APP_ID });

  it("e-mail non vérifié : redirection vers /verification (pas d'accès aux identifiants)", async () => {
    state.user = { ...state.user, emailVerified: false };
    await expect(loadAppTab(params)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT;/verification") });
  });

  it("e-mail vérifié : app chargée", async () => {
    const r = await loadAppTab(params);
    expect(r.app.id).toBe(APP_ID);
    expect(r.client?.clientId).toBe("axi_cli_app");
  });
});

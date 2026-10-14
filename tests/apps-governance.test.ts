import { describe, expect, it, vi } from "vitest";

// dev-logic importe @/lib/mcp/tokens (isAllowedRedirectUri), qui est `server-only`.
vi.mock("server-only", () => ({}));

import { sameStringSet, requiresReReview } from "@/lib/apps/dev-logic";

describe("sameStringSet", () => {
  it("ignore l'ordre et les doublons", () => {
    expect(sameStringSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameStringSet(["a", "a", "b"], ["b", "a"])).toBe(true);
  });
  it("détecte une différence", () => {
    expect(sameStringSet(["a"], ["a", "b"])).toBe(false);
    expect(sameStringSet(["a", "b"], ["a", "c"])).toBe(false);
  });
});

describe("requiresReReview (gouvernance app publiée)", () => {
  const base = { requestedScopes: ["catalog:read"], redirectUris: ["https://x.test/cb"] };

  it("une app en brouillon ne repasse jamais en revue", () => {
    expect(requiresReReview("DRAFT", base, { requestedScopes: ["catalog:read", "orders:read"], redirectUris: base.redirectUris })).toBe(false);
  });

  it("app publiée : élargir les scopes déclenche une re-revue", () => {
    expect(requiresReReview("PUBLISHED", base, { requestedScopes: ["catalog:read", "customers:read"], redirectUris: base.redirectUris })).toBe(true);
  });

  it("app publiée : changer une URI de redirection déclenche une re-revue", () => {
    expect(requiresReReview("PUBLISHED", base, { requestedScopes: base.requestedScopes, redirectUris: ["https://evil.test/cb"] })).toBe(true);
  });

  it("app publiée : changer seulement la description (scopes/URI identiques) reste en ligne", () => {
    expect(requiresReReview("PUBLISHED", base, { requestedScopes: ["catalog:read"], redirectUris: ["https://x.test/cb"] })).toBe(false);
  });

  it("une app suspendue n'est pas concernée par cette règle", () => {
    expect(requiresReReview("SUSPENDED", base, { requestedScopes: ["orders:read"], redirectUris: base.redirectUris })).toBe(false);
  });
});

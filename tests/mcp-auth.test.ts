import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { generateApiToken, generateSecret, hashToken, hashesEqual, isAllowedRedirectUri, isValidCodeChallenge, looksLikeToken, matchRedirectUri, pkceChallengeS256, tokenKind, verifyPkceS256, verifyToken, visiblePrefix, VISIBLE_PREFIX_LENGTH } from "@/lib/mcp/tokens";
import { effectiveScopes, hasAnyScope, parseScopes, planForScope, planScopes, READ_SCOPES, SCOPES, SCOPE_PRESETS } from "@/lib/mcp/scopes";
import { minuteRules } from "@/lib/mcp/runtime";
import { COMPARISON, MCP_LIMITS, PLAN_ORDER, PLANS } from "@/config/plans";

describe("jetons API (hachage, vérification)", () => {
  it("génère un secret axi_live_ à forte entropie, jamais stocké en clair", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.token).toMatch(/^axi_live_[A-Za-z0-9_-]{40}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.prefix).toBe(a.token.slice(0, VISIBLE_PREFIX_LENGTH));
    expect(a.prefix.length).toBe("axi_live_".length + 8);
    expect(a.hash).toBe(createHash("sha256").update(a.token).digest("hex"));
    expect(a.hash).not.toContain(a.token.slice(9));
  });

  it("vérifie en temps constant et refuse un secret modifié", () => {
    const { token, hash } = generateApiToken();
    expect(verifyToken(token, hash)).toBe(true);
    expect(verifyToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), hash)).toBe(false);
    expect(verifyToken("", hash)).toBe(false);
    expect(hashesEqual("abc", "abcd")).toBe(false);
    expect(hashesEqual(hashToken("x"), hashToken("x"))).toBe(true);
  });

  it("reconnaît le type de jeton et rejette les formats inconnus", () => {
    expect(tokenKind(generateApiToken().token)).toBe("api");
    expect(tokenKind(generateSecret("access").value)).toBe("access");
    expect(tokenKind(generateSecret("refresh").value)).toBe("refresh");
    expect(tokenKind(generateSecret("code").value)).toBeNull();
    expect(tokenKind("Bearer abc")).toBeNull();
    expect(looksLikeToken("axi_live_short")).toBe(false);
    expect(visiblePrefix("axi_live_ABCDEFGHxyz")).toBe("axi_live_ABCDEFGH");
  });
});

describe("PKCE S256 (RFC 7636)", () => {
  const verifier = "M25iVXpKU3puUjFaYWg3T1NDTDQtcW1ROUY5YXlwalNoc0hhakxifmZHag";
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  it("accepte le bon vérificateur", () => {
    expect(pkceChallengeS256(verifier)).toBe(challenge);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(isValidCodeChallenge(challenge)).toBe(true);
  });

  it("refuse un vérificateur faux, trop court, absent ou un défi malformé", () => {
    expect(verifyPkceS256(verifier.slice(0, -1) + "x", challenge)).toBe(false);
    expect(verifyPkceS256("tooshort", challenge)).toBe(false);
    expect(verifyPkceS256(undefined, challenge)).toBe(false);
    expect(verifyPkceS256(verifier, "plain-challenge")).toBe(false);
    // Méthode « plain » : le défi égal au vérificateur n'est jamais accepté.
    expect(verifyPkceS256(verifier, verifier)).toBe(false);
    expect(isValidCodeChallenge("abc")).toBe(false);
  });
});

describe("URI de redirection OAuth", () => {
  it("accepte https, le bouclage local et les schémas d'applications natives", () => {
    for (const ok of ["https://claude.ai/api/mcp/auth_callback", "https://chatgpt.com/connector_platform_oauth_redirect", "http://localhost:6274/oauth/callback", "http://127.0.0.1:33418/", "cursor://anysphere.cursor-retrieval/oauth/callback", "com.example.app:/cb"]) {
      expect(isAllowedRedirectUri(ok), ok).toBe(true);
    }
  });

  it("refuse http distant, javascript:, data:, fragments et identifiants", () => {
    for (const bad of ["http://evil.example/cb", "javascript:alert(1)", "data:text/html,x", "https://a.example/cb#frag", "https://user:pass@a.example/cb", "file:///etc/passwd", "not a url", 42]) {
      expect(isAllowedRedirectUri(bad), String(bad)).toBe(false);
    }
  });

  it("compare exactement, sauf le port des adresses de bouclage (RFC 8252)", () => {
    const reg = ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1/callback"];
    expect(matchRedirectUri(reg, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(matchRedirectUri(reg, "https://claude.ai/api/mcp/auth_callback/")).toBe(false);
    expect(matchRedirectUri(reg, "https://claude.ai.evil.example/api/mcp/auth_callback")).toBe(false);
    expect(matchRedirectUri(reg, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(matchRedirectUri(reg, "http://127.0.0.1:51234/other")).toBe(false);
  });
});

describe("scopes, plans et rôles", () => {
  it("normalise : connus, sans doublon, ordre canonique", () => {
    expect(parseScopes("orders:read store:read orders:read admin:all")).toEqual(["store:read", "orders:read"]);
    expect(parseScopes(["catalog:write", "catalog:read"])).toEqual(["catalog:read", "catalog:write"]);
    expect(parseScopes(undefined)).toEqual([]);
  });

  it("Gratuit : lecture seule ; Starter : + catalogue, stock, commandes ; Business et plus : tout", () => {
    expect(planScopes("FREE")).toEqual(SCOPES.filter((s) => READ_SCOPES.includes(s)));
    expect(planScopes("FREE").some((s) => s.endsWith(":write"))).toBe(false);
    expect(planScopes("STARTER")).toEqual(expect.arrayContaining(["catalog:write", "inventory:write", "orders:write"]));
    expect(planScopes("STARTER")).not.toContain("marketing:write");
    for (const p of ["BUSINESS", "SCALE", "ENTERPRISE"] as const) expect(planScopes(p)).toEqual([...SCOPES]);
    expect(planForScope("marketing:write")).toBe("BUSINESS");
    expect(planForScope("orders:write")).toBe("STARTER");
    expect(planForScope("customers:read")).toBe("FREE");
  });

  it("portée effective = jeton ∩ plan ∩ rôle", () => {
    expect(effectiveScopes([...SCOPES], "FREE", "OWNER")).toEqual(READ_SCOPES.slice().sort((a, b) => SCOPES.indexOf(a) - SCOPES.indexOf(b)));
    expect(effectiveScopes([...SCOPES], "BUSINESS", "STAFF")).toEqual(["store:read", "orders:read", "orders:write"]);
    expect(effectiveScopes(["catalog:read"], "BUSINESS", "OWNER")).toEqual(["catalog:read"]);
    expect(effectiveScopes(["marketing:write"], "STARTER", "OWNER")).toEqual([]);
    expect(hasAnyScope(["catalog:read"], ["catalog:write", "catalog:read"])).toBe(true);
    expect(hasAnyScope(["catalog:read"], ["orders:read"])).toBe(false);
    expect(hasAnyScope([], [])).toBe(true);
  });

  it("préréglages composés de scopes valides", () => {
    for (const p of SCOPE_PRESETS) expect(parseScopes(p.scopes)).toEqual(p.scopes.slice().sort((a, b) => SCOPES.indexOf(a) - SCOPES.indexOf(b)));
  });

  it("limites MCP par plan : croissantes, OAuth à partir de Business, prix inchangés", () => {
    expect(MCP_LIMITS.FREE).toMatchObject({ scopes: "read", maxTokens: 1, oauth: false });
    expect(MCP_LIMITS.STARTER).toMatchObject({ scopes: "standard", maxTokens: 3, oauth: false });
    expect(MCP_LIMITS.BUSINESS).toMatchObject({ scopes: "all", maxTokens: 10, oauth: true });
    expect(MCP_LIMITS.SCALE.maxTokens).toBeNull();
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      expect(MCP_LIMITS[PLAN_ORDER[i]].callsPerMinute).toBeGreaterThanOrEqual(MCP_LIMITS[PLAN_ORDER[i - 1]].callsPerMinute);
    }
    expect(PLANS.STARTER.price.AFRICA).toBe(5000);
    const row = COMPARISON.flatMap((g) => g.rows).find((r) => r.label === "Connecteur IA (MCP)");
    expect(row && Object.keys(row.values).sort()).toEqual([...PLAN_ORDER].sort());
  });
});

describe("quotas par minute", () => {
  it("une fenêtre par boutique et une par jeton, au plafond du plan", () => {
    const rules = minuteRules("STARTER", "store_a", "token:t1");
    expect(rules).toEqual([
      { key: "mcp:store:store_a:min", limit: MCP_LIMITS.STARTER.callsPerMinute, windowSec: 60 },
      { key: "mcp:principal:token:t1:min", limit: MCP_LIMITS.STARTER.callsPerMinute, windowSec: 60 },
    ]);
    expect(minuteRules("STARTER", "store_b", "token:t1")[0].key).not.toBe(rules[0].key);
  });
});

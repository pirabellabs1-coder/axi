import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { safeNext } from "@/lib/auth/redirect";
import { normalizeIp, rateLimitDecision, nextWindow, rateLimitMessage } from "@/lib/rate-limit";

describe("safeNext (m1 redirection ouverte)", () => {
  it("accepte les chemins internes", () => {
    expect(safeNext("/app")).toBe("/app");
    expect(safeNext("/app/abc/commandes?statut=NEW#x")).toBe("/app/abc/commandes?statut=NEW#x");
    expect(safeNext("/")).toBe("/");
  });

  it("refuse les URL absolues ou relatives au protocole", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "javascript:alert(1)", "\\\\evil.com", ""]) {
      expect(safeNext(bad)).toBe("/app");
    }
  });

  it("refuse les caractères de contrôle (tabulation supprimée par le navigateur)", () => {
    expect(safeNext("/\t/evil.com")).toBe("/app");
    expect(safeNext("/\n/evil.com")).toBe("/app");
  });

  it("refuse les valeurs non textuelles et trop longues, avec repli personnalisable", () => {
    expect(safeNext(undefined)).toBe("/app");
    expect(safeNext(["/app"])).toBe("/app");
    expect(safeNext(`/${"a".repeat(600)}`)).toBe("/app");
    expect(safeNext("//x", "")).toBe("");
  });
});

describe("normalizeIp", () => {
  it("prend le premier élément de x-forwarded-for", () => {
    expect(normalizeIp("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
  });
  it("retire le port et ramène l'IPv4 mappée", () => {
    expect(normalizeIp("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });
  it("regroupe l'IPv6 sur son /64", () => {
    expect(normalizeIp("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("[2001:DB8:1:2::ffff]:443")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("::1")).toBe("0:0:0:0::/64");
  });
  it("rejette les valeurs invalides", () => {
    expect(normalizeIp(null)).toBe("unknown");
    expect(normalizeIp("")).toBe("unknown");
    expect(normalizeIp("999.1.1.1")).toBe("unknown");
    expect(normalizeIp("not-an-ip")).toBe("unknown");
    expect(normalizeIp("1:2:3")).toBe("unknown");
  });
});

describe("rate limit — fenêtre fixe", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  it("ouvre une fenêtre à 1 si aucune entrée ou si la fenêtre est échue", () => {
    expect(nextWindow(null, 60, now)).toEqual({ count: 1, resetAt: new Date("2026-10-10T12:01:00Z") });
    const expired = { count: 42, resetAt: new Date("2026-10-10T11:59:59Z") };
    expect(nextWindow(expired, 900, now)).toEqual({ count: 1, resetAt: new Date("2026-10-10T12:15:00Z") });
  });

  it("incrémente dans la fenêtre courante sans la prolonger", () => {
    const current = { count: 3, resetAt: new Date("2026-10-10T12:05:00Z") };
    expect(nextWindow(current, 900, now)).toEqual({ count: 4, resetAt: current.resetAt });
  });

  it("autorise jusqu'à la limite incluse puis bloque avec retryAfter", () => {
    const resetAt = new Date("2026-10-10T12:10:00Z");
    expect(rateLimitDecision(5, 5, resetAt, now)).toEqual({ ok: true, retryAfter: 0 });
    expect(rateLimitDecision(6, 5, resetAt, now)).toEqual({ ok: false, retryAfter: 600 });
    expect(rateLimitDecision(6, 5, now, now).retryAfter).toBe(1);
  });

  it("formule un message neutre en minutes", () => {
    expect(rateLimitMessage(30)).toBe("Trop de tentatives. Réessayez dans 1 minute.");
    expect(rateLimitMessage(601)).toBe("Trop de tentatives. Réessayez dans 11 minutes.");
  });
});

import { describe, it, expect } from "vitest";
import { effectivePlatformRole, roleCan, permissionsOf, parsePlatformRole, type AdminPermission } from "@/lib/admin/roles";

describe("rôle plateforme effectif", () => {
  it("n'accorde rien hors équipe plateforme", () => {
    expect(effectivePlatformRole(null)).toBeNull();
    expect(effectivePlatformRole({ isPlatformAdmin: false, platformRole: "SUPER_ADMIN" })).toBeNull();
  });
  it("traite un administrateur sans rôle comme super-administrateur (comptes historiques)", () => {
    expect(effectivePlatformRole({ isPlatformAdmin: true, platformRole: null })).toBe("SUPER_ADMIN");
    expect(effectivePlatformRole({ isPlatformAdmin: true, platformRole: "inconnu" })).toBe("SUPER_ADMIN");
    expect(effectivePlatformRole({ isPlatformAdmin: true, platformRole: "FINANCE" })).toBe("FINANCE");
  });
  it("valide les rôles", () => {
    expect(parsePlatformRole("SUPPORT")).toBe("SUPPORT");
    expect(parsePlatformRole("support")).toBeNull();
  });
});

describe("permissions par rôle", () => {
  const all: AdminPermission[] = ["read", "tickets.manage", "support.access", "billing.manage", "pricing.manage", "coupons.manage", "stores.moderate", "users.manage", "team.manage", "announcements.manage", "settings.manage", "system.manage"];

  it("SUPER_ADMIN peut tout faire", () => {
    for (const p of all) expect(roleCan("SUPER_ADMIN", p)).toBe(true);
  });
  it("SUPPORT : lecture, tickets et accès support daté uniquement", () => {
    expect(permissionsOf("SUPPORT").sort()).toEqual(["read", "support.access", "tickets.manage"]);
    expect(roleCan("SUPPORT", "billing.manage")).toBe(false);
    expect(roleCan("SUPPORT", "stores.moderate")).toBe(false);
    expect(roleCan("SUPPORT", "pricing.manage")).toBe(false);
  });
  it("FINANCE : factures, prix et codes promo, sans modération ni équipe", () => {
    expect(permissionsOf("FINANCE").sort()).toEqual(["billing.manage", "coupons.manage", "pricing.manage", "read"]);
    expect(roleCan("FINANCE", "tickets.manage")).toBe(false);
    expect(roleCan("FINANCE", "team.manage")).toBe(false);
    expect(roleCan("FINANCE", "settings.manage")).toBe(false);
  });
  it("refuse tout sans rôle (fail closed)", () => {
    for (const p of all) expect(roleCan(null, p)).toBe(false);
  });
});

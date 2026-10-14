import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user_admin_01", email: "a@axi.test", name: "A", isPlatformAdmin: true, emailVerified: true } as Record<string, unknown> | null,
  row: { platformRole: "SUPER_ADMIN", mfaEnabled: false } as { platformRole: string | null; mfaEnabled: boolean } | null,
  path: "/admin" as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(state.path ? { "x-axi-pathname": state.path } : {}) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT ${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: async () => state.row } } }));

import { adminMfaGate, adminMfaRequired, ADMIN_MFA_REQUIRED_MESSAGE, storeRoleStillAllowed } from "@/lib/admin/roles";
import { getAdminContext, requireAdminPermission } from "@/lib/admin/context";

describe("M1 — règle pure de MFA obligatoire", () => {
  it("exige la MFA par défaut, désactivable par ADMIN_MFA_OPTIONAL=1 uniquement", () => {
    expect(adminMfaRequired({})).toBe(true);
    expect(adminMfaRequired({ ADMIN_MFA_OPTIONAL: "0" })).toBe(true);
    expect(adminMfaRequired({ ADMIN_MFA_OPTIONAL: "true" })).toBe(true);
    // En production, la dérogation n'est acceptée que sur localhost.
    expect(adminMfaRequired({ ADMIN_MFA_OPTIONAL: "1", NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://axi.africa" })).toBe(true);
    expect(adminMfaRequired({ ADMIN_MFA_OPTIONAL: "1", NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost:3100" })).toBe(false);
    expect(adminMfaRequired({ ADMIN_MFA_OPTIONAL: "1" })).toBe(false);
  });

  it("sans MFA : seule la page Équipe et sécurité et les actions d'inscription passent", () => {
    const env = {};
    expect(adminMfaGate(false, { path: "/admin" }, env)).toBe("enroll");
    expect(adminMfaGate(false, { path: "/admin/boutiques" }, env)).toBe("enroll");
    expect(adminMfaGate(false, { path: "/admin/equipe-fausse" }, env)).toBe("enroll");
    expect(adminMfaGate(false, { path: null }, env)).toBe("enroll");
    expect(adminMfaGate(false, { path: "/admin/equipe" }, env)).toBe("ok");
    expect(adminMfaGate(false, { allowWithoutMfa: true }, env)).toBe("ok");
    expect(adminMfaGate(true, { path: "/admin/boutiques" }, env)).toBe("ok");
    expect(adminMfaGate(false, { path: "/admin/boutiques" }, { ADMIN_MFA_OPTIONAL: "1" })).toBe("ok");
  });
});

describe("M1 — application dans le contexte admin", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ADMIN_MFA_OPTIONAL", "");
    state.user = { id: "user_admin_01", email: "a@axi.test", name: "A", isPlatformAdmin: true, emailVerified: true };
    state.row = { platformRole: "SUPER_ADMIN", mfaEnabled: false };
    state.path = "/admin";
  });

  it("actions refusées sans MFA, sauf inscription MFA", async () => {
    await expect(requireAdminPermission("stores.moderate")).rejects.toThrow(ADMIN_MFA_REQUIRED_MESSAGE);
    await expect(requireAdminPermission("read", { allowWithoutMfa: true })).resolves.toMatchObject({ role: "SUPER_ADMIN" });
  });

  it("actions autorisées avec MFA, et sans MFA si ADMIN_MFA_OPTIONAL=1 (démo locale)", async () => {
    state.row = { platformRole: "SUPER_ADMIN", mfaEnabled: true };
    await expect(requireAdminPermission("stores.moderate")).resolves.toMatchObject({ mfaEnabled: true });
    state.row = { platformRole: "SUPER_ADMIN", mfaEnabled: false };
    vi.stubEnv("ADMIN_MFA_OPTIONAL", "1");
    await expect(requireAdminPermission("stores.moderate")).resolves.toMatchObject({ mfaEnabled: false });
  });

  it("pages : redirection vers la section Sécurité, sauf /admin/equipe", async () => {
    await expect(getAdminContext()).rejects.toThrow(/REDIRECT \/admin\/equipe\?mfa=requise#securite/);
    state.path = "/admin/equipe";
    await expect(getAdminContext()).resolves.toMatchObject({ role: "SUPER_ADMIN" });
  });

  it("m3 — compte à l'e-mail non vérifié : aucun accès à la console", async () => {
    state.user = { id: "user_admin_01", email: "a@axi.test", name: "A", isPlatformAdmin: true, emailVerified: false };
    state.row = { platformRole: "SUPER_ADMIN", mfaEnabled: true };
    await expect(requireAdminPermission("read")).rejects.toThrow(/équipe de la plateforme/);
  });
});

describe("M2 — adhésion SUPPORT résiduelle", () => {
  it("valable seulement avec la permission plateforme support.access", () => {
    expect(storeRoleStillAllowed("SUPPORT", { isPlatformAdmin: true, platformRole: "SUPPORT" })).toBe(true);
    expect(storeRoleStillAllowed("SUPPORT", { isPlatformAdmin: true, platformRole: "SUPER_ADMIN" })).toBe(true);
    expect(storeRoleStillAllowed("SUPPORT", { isPlatformAdmin: true, platformRole: "FINANCE" })).toBe(false);
    expect(storeRoleStillAllowed("SUPPORT", { isPlatformAdmin: false, platformRole: null })).toBe(false);
    expect(storeRoleStillAllowed("SUPPORT", null)).toBe(false);
  });

  it("les rôles de boutique ordinaires ne dépendent pas de l'équipe plateforme", () => {
    expect(storeRoleStillAllowed("OWNER", null)).toBe(true);
    expect(storeRoleStillAllowed("STAFF", { isPlatformAdmin: false })).toBe(true);
  });
});

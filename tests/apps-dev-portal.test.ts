import { describe, it, expect, vi } from "vitest";

// tokens.ts (importé par dev-logic pour isAllowedRedirectUri) est `server-only`.
vi.mock("server-only", () => ({}));

import { decideTestInstall, isTestInstallConfig, developerJourney, developerProfileSchema, TEST_INSTALL_CONFIG, TEST_INSTALL_ROLES } from "@/lib/apps/dev-logic";

const NOW = new Date("2026-10-13T12:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");
const past = new Date("2026-10-01T00:00:00Z");

describe("decideTestInstall — droits d'installation de test", () => {
  const base = { isOwner: true, membership: null, collaboratorCanTestInstall: false };

  it("propriétaire de l'app + OWNER de la boutique : autorisé via l'adhésion", () => {
    expect(decideTestInstall({ ...base, membership: { role: "OWNER", expiresAt: null } }, "DRAFT", NOW)).toEqual({ ok: true, via: "membership" });
  });

  it("F4 : MANAGER refusé (réservé aux OWNER), sauf s'il est collaborateur actif apps.test_install", () => {
    expect(decideTestInstall({ ...base, membership: { role: "MANAGER", expiresAt: future } }, "IN_REVIEW", NOW)).toEqual({ ok: false, reason: "no_store_access" });
    expect(decideTestInstall({ ...base, membership: { role: "MANAGER", expiresAt: null }, collaboratorCanTestInstall: true }, "DRAFT", NOW)).toEqual({ ok: true, via: "collaborator" });
    expect(TEST_INSTALL_ROLES).toEqual(["OWNER"]);
  });

  it("STAFF ou SUPPORT : refusé sans collaboration", () => {
    for (const role of ["STAFF", "SUPPORT"]) {
      expect(decideTestInstall({ ...base, membership: { role, expiresAt: null } }, "DRAFT", NOW)).toEqual({ ok: false, reason: "no_store_access" });
    }
  });

  it("adhésion expirée : refusée (puis repli sur la collaboration)", () => {
    expect(decideTestInstall({ ...base, membership: { role: "OWNER", expiresAt: past } }, "DRAFT", NOW)).toEqual({ ok: false, reason: "no_store_access" });
    expect(decideTestInstall({ ...base, membership: { role: "OWNER", expiresAt: past }, collaboratorCanTestInstall: true }, "DRAFT", NOW)).toEqual({ ok: true, via: "collaborator" });
  });

  it("collaborateur actif avec apps.test_install : autorisé sans adhésion", () => {
    expect(decideTestInstall({ ...base, collaboratorCanTestInstall: true }, "DRAFT", NOW)).toEqual({ ok: true, via: "collaborator" });
  });

  it("aucun accès à la boutique : refusé", () => {
    expect(decideTestInstall(base, "DRAFT", NOW)).toEqual({ ok: false, reason: "no_store_access" });
  });

  it("non-propriétaire de l'app : refusé même OWNER de la boutique", () => {
    expect(decideTestInstall({ isOwner: false, membership: { role: "OWNER", expiresAt: null }, collaboratorCanTestInstall: true }, "PUBLISHED", NOW)).toEqual({ ok: false, reason: "not_owner" });
  });

  it("DRAFT, IN_REVIEW et PUBLISHED acceptés ; SUSPENDED refusé", () => {
    const rights = { ...base, membership: { role: "OWNER", expiresAt: null } };
    for (const s of ["DRAFT", "IN_REVIEW", "PUBLISHED"] as const) expect(decideTestInstall(rights, s, NOW).ok).toBe(true);
    expect(decideTestInstall(rights, "SUSPENDED", NOW)).toEqual({ ok: false, reason: "suspended" });
  });
});

describe("isTestInstallConfig", () => {
  it("reconnaît { test: true } uniquement", () => {
    expect(isTestInstallConfig(TEST_INSTALL_CONFIG)).toBe(true);
    expect(isTestInstallConfig({ test: true, autre: 1 })).toBe(true);
    for (const v of [null, undefined, {}, { test: "true" }, { test: 1 }, [true], "test", true]) expect(isTestInstallConfig(v)).toBe(false);
  });
});

describe("developerJourney", () => {
  const app = { status: "DRAFT" as const, appUrl: null as string | null, redirectUriCount: 0, testInstallCount: 0 };

  it("aucune app : rien de fait", () => {
    expect(developerJourney([]).map((s) => s.done)).toEqual([false, false, false, false]);
  });

  it("configurer exige une redirection ET une URL d'app", () => {
    expect(developerJourney([{ ...app, redirectUriCount: 1 }])[1].done).toBe(false);
    expect(developerJourney([{ ...app, redirectUriCount: 1, appUrl: "https://x.io" }])[1].done).toBe(true);
  });

  it("tester puis soumettre", () => {
    const steps = developerJourney([{ ...app, testInstallCount: 1, status: "IN_REVIEW" }]);
    expect(steps.find((s) => s.id === "test")!.done).toBe(true);
    expect(steps.find((s) => s.id === "submit")!.done).toBe(true);
  });
});

describe("developerProfileSchema", () => {
  it("valide un nom de 2 à 80 caractères (espaces retirés)", () => {
    expect(developerProfileSchema.safeParse({ developerName: "  Studio Kora  " })).toEqual({ success: true, data: { developerName: "Studio Kora" } });
    expect(developerProfileSchema.safeParse({ developerName: "A" }).success).toBe(false);
    expect(developerProfileSchema.safeParse({ developerName: "x".repeat(81) }).success).toBe(false);
  });
});

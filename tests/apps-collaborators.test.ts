import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { createFakeDb } from "./helpers/fake-db";

/**
 * App Store v2 (COL) : collaborateurs développeurs.
 * Validation de l'invitation, expiration à 7 jours, acceptation avec mauvais e-mail refusée,
 * isolation par boutique (un propriétaire de A ne peut ni renvoyer ni révoquer un collaborateur de B),
 * révocation qui désinstalle uniquement les installations de test du collaborateur.
 */

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("./helpers/fake-db").createFakeDb>,
  member: "store_AAAAAAAA" as string,
  user: { id: "user_owner", email: "owner@a.test", name: "Awa", emailVerified: true } as { id: string; email: string; name: string; emailVerified: boolean },
  mails: [] as { to: string; text: string }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${to}` });
  },
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.fake!.db;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => ({})) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ ok: true, retryAfter: 0 })), rateLimitMessage: () => "Trop de tentatives." }));
vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(async (m: { to: string; text: string }) => {
    state.mails.push(m);
    return { ok: true };
  }),
}));
vi.mock("@/lib/auth/permissions", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireUserOrThrow: vi.fn(async () => state.user),
    requireStore: vi.fn(async (storeId: string, cap: string) => {
      if (storeId !== state.member) throw new AuthError("Boutique introuvable ou accès refusé");
      if (cap !== "integrations.manage") throw new AuthError("Capacité inattendue");
      const store = state.fake!.tables.store.find((s) => s.id === storeId)!;
      return { user: state.user, store, role: "OWNER", planId: "PRO", can: () => true };
    }),
  };
});

import { inviteDeveloper, resendInvite, revokeCollaborator, acceptInvite, declineInvite } from "@/lib/apps/collaborator-actions";
import { collaboratorInviteSchema, collaboratorInviteExpiry, collaboratorState, acceptanceProblem, canTransition, COLLAB_PERMISSIONS } from "@/lib/apps/collaborator-logic";
import { COLLABORATOR_PERMISSIONS } from "@/lib/apps/collaborators";

const A = "store_AAAAAAAA";
const B = "store_BBBBBBBB";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const TOKEN = "a".repeat(64);

function fd(o: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const tokenFromMail = () => state.mails.at(-1)!.text.match(/invitation-developpeur\/([a-f0-9]{64})/)![1]!;

beforeEach(() => {
  state.member = A;
  state.user = { id: "user_owner", email: "owner@a.test", name: "Awa", emailVerified: true };
  state.mails = [];
  state.fake = createFakeDb({
    store: [
      { id: A, name: "Boutique A", status: "PUBLISHED" },
      { id: B, name: "Boutique B", status: "PUBLISHED" },
    ],
    storeCollaborator: [
      { id: "collab_BBBBBBBB", storeId: B, email: "dev@b.test", status: "ACTIVE", userId: "user_dev", permissions: ["apps.test_install"], tokenHash: sha("b".repeat(64)), expiresAt: new Date(Date.now() + 86_400_000) },
    ],
    app: [
      { id: "app_DEVDEVDEV", developerUserId: "user_dev", installCount: 2 },
      { id: "app_OTHEROTHER", developerUserId: "user_other", installCount: 1 },
    ],
    appInstallation: [
      { id: "inst_TEST0001", storeId: A, appId: "app_DEVDEVDEV", installedById: "user_dev", status: "ACTIVE", oauthGrantId: null },
      { id: "inst_MERCH001", storeId: A, appId: "app_OTHEROTHER", installedById: "user_owner", status: "ACTIVE", oauthGrantId: null },
      { id: "inst_STOREB01", storeId: B, appId: "app_DEVDEVDEV", installedById: "user_dev", status: "ACTIVE", oauthGrantId: null },
    ],
    oAuthGrant: [],
    oAuthToken: [],
  });
});

describe("collaborator-logic", () => {
  it("garde les permissions alignées avec collaborators.ts", () => {
    expect([...COLLAB_PERMISSIONS]).toEqual([...COLLABORATOR_PERMISSIONS]);
  });

  it("valide l'e-mail, les permissions (sous-ensemble connu, au moins une) et le message", () => {
    const ok = collaboratorInviteSchema.safeParse({ storeId: A, email: "  Dev@Exemple.COM ", permissions: ["apps.manage_installs", "apps.test_install", "apps.test_install"], message: "" });
    expect(ok.success).toBe(true);
    expect(ok.data!.email).toBe("dev@exemple.com");
    expect(ok.data!.permissions).toEqual(["apps.test_install", "apps.manage_installs"]);
    expect(ok.data!.message).toBeUndefined();
    expect(collaboratorInviteSchema.safeParse({ storeId: A, email: "pas-un-mail", permissions: ["apps.test_install"] }).success).toBe(false);
    expect(collaboratorInviteSchema.safeParse({ storeId: A, email: "a@b.co", permissions: ["orders.view"] }).success).toBe(false);
    expect(collaboratorInviteSchema.safeParse({ storeId: A, email: "a@b.co", permissions: [] }).success).toBe(false);
    expect(collaboratorInviteSchema.safeParse({ storeId: A, email: "a@b.co", permissions: "apps.test_install", message: "x".repeat(501) }).success).toBe(false);
  });

  it("expire à 7 jours et distingue en attente / expirée / active / révoquée", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    const exp = collaboratorInviteExpiry(now);
    expect(exp.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(collaboratorState({ status: "PENDING", expiresAt: exp }, now)).toBe("pending");
    expect(collaboratorState({ status: "PENDING", expiresAt: exp }, new Date("2026-10-20T10:00:01Z"))).toBe("expired");
    expect(collaboratorState({ status: "ACTIVE", expiresAt: exp }, now)).toBe("active");
    expect(collaboratorState({ status: "PENDING", expiresAt: exp, revokedAt: now }, now)).toBe("revoked");
  });

  it("transitions de statut", () => {
    expect(canTransition("PENDING", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "REVOKED")).toBe(true);
    expect(canTransition("REVOKED", "PENDING")).toBe(true);
    expect(canTransition("REVOKED", "ACTIVE")).toBe(false);
    expect(canTransition("ACTIVE", "PENDING")).toBe(false);
  });

  it("acceptation : e-mail insensible à la casse, mauvais e-mail refusé", () => {
    const row = { email: "dev@x.test", status: "PENDING" as const, expiresAt: new Date(Date.now() + 1000) };
    expect(acceptanceProblem(row, "DEV@x.test")).toBeNull();
    expect(acceptanceProblem(row, "autre@x.test")).toBe("wrong_email");
    expect(acceptanceProblem(null, "dev@x.test")).toBe("unknown");
    expect(acceptanceProblem({ ...row, expiresAt: new Date(Date.now() - 1000) }, "dev@x.test")).toBe("expired");
  });
});

describe("collaborator-actions", () => {
  it("invite : ne stocke que le hash du jeton, e-mail envoyé avec le lien", async () => {
    const r = await inviteDeveloper(undefined, fd({ storeId: A, email: "Dev@x.test", "permissions[]": ["apps.test_install"], message: "Bonjour" }));
    expect(r.ok).toBe(true);
    const row = state.fake!.tables.storeCollaborator.find((c) => c.storeId === A)!;
    const token = tokenFromMail();
    expect(row.email).toBe("dev@x.test");
    expect(row.status).toBe("PENDING");
    expect(row.tokenHash).toBe(sha(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(state.mails.at(-1)!.to).toBe("dev@x.test");
  });

  it("invite : refuse sans permission et pour une boutique dont on n'est pas propriétaire", async () => {
    expect((await inviteDeveloper(undefined, fd({ storeId: A, email: "dev@x.test" }))).ok).toBe(false);
    const r = await inviteDeveloper(undefined, fd({ storeId: B, email: "dev@x.test", "permissions[]": "apps.test_install" }));
    expect(r.ok).toBe(false);
    expect(state.fake!.tables.storeCollaborator.filter((c) => c.storeId === B)).toHaveLength(1);
  });

  it("accept : mauvais e-mail refusé, bon e-mail → ACTIVE, userId lié, redirection /developpeur", async () => {
    await inviteDeveloper(undefined, fd({ storeId: A, email: "dev@x.test", "permissions[]": "apps.test_install" }));
    const token = tokenFromMail();

    state.user = { id: "user_intrus", email: "intrus@x.test", name: "Intrus", emailVerified: true };
    const bad = await acceptInvite(token);
    expect(bad.ok).toBe(false);
    expect(state.fake!.tables.storeCollaborator.find((c) => c.storeId === A)!.status).toBe("PENDING");

    state.user = { id: "user_dev", email: "DEV@x.test", name: "Dev", emailVerified: true };
    await expect(acceptInvite(token)).rejects.toMatchObject({ digest: "NEXT_REDIRECT;/developpeur" });
    const row = state.fake!.tables.storeCollaborator.find((c) => c.storeId === A)!;
    expect(row.status).toBe("ACTIVE");
    expect(row.userId).toBe("user_dev");
    // Une seconde acceptation échoue
    expect((await acceptInvite(token)).ok).toBe(false);
  });

  it("accept : jeton expiré ou inconnu refusé", async () => {
    await inviteDeveloper(undefined, fd({ storeId: A, email: "dev@x.test", "permissions[]": "apps.test_install" }));
    const token = tokenFromMail();
    state.fake!.tables.storeCollaborator.find((c) => c.storeId === A)!.expiresAt = new Date(Date.now() - 1000);
    state.user = { id: "user_dev", email: "dev@x.test", name: "Dev", emailVerified: true };
    expect((await acceptInvite(token)).ok).toBe(false);
    expect((await acceptInvite("f".repeat(64))).ok).toBe(false);
    expect((await acceptInvite("../../etc")).ok).toBe(false);
  });

  it("decline : passe à REVOKED", async () => {
    await inviteDeveloper(undefined, fd({ storeId: A, email: "dev@x.test", "permissions[]": "apps.test_install" }));
    const token = tokenFromMail();
    state.user = { id: "user_dev", email: "dev@x.test", name: "Dev", emailVerified: true };
    expect((await declineInvite(token)).ok).toBe(true);
    expect(state.fake!.tables.storeCollaborator.find((c) => c.storeId === A)!.status).toBe("REVOKED");
  });

  it("isolation : A ne peut ni renvoyer ni révoquer un collaborateur de B", async () => {
    expect((await resendInvite(A, "collab_BBBBBBBB")).ok).toBe(false);
    expect((await revokeCollaborator(A, "collab_BBBBBBBB")).ok).toBe(false);
    expect(state.fake!.tables.storeCollaborator.find((c) => c.id === "collab_BBBBBBBB")!.status).toBe("ACTIVE");
  });

  it("révocation : désinstalle seulement les installations de test du collaborateur sur cette boutique", async () => {
    state.fake!.tables.storeCollaborator.push({ id: "collab_AAAAAAAA", storeId: A, email: "dev@x.test", status: "ACTIVE", userId: "user_dev", permissions: ["apps.test_install"], tokenHash: sha(TOKEN), expiresAt: new Date() });
    const r = await revokeCollaborator(A, "collab_AAAAAAAA");
    expect(r.ok).toBe(true);
    const inst = (id: string) => state.fake!.tables.appInstallation.find((i) => i.id === id)!;
    expect(inst("inst_TEST0001").status).toBe("UNINSTALLED");
    expect(inst("inst_MERCH001").status).toBe("ACTIVE");
    expect(inst("inst_STOREB01").status).toBe("ACTIVE");
    expect(state.fake!.tables.app.find((a) => a.id === "app_DEVDEVDEV")!.installCount).toBe(1);
    expect(state.fake!.tables.storeCollaborator.find((c) => c.id === "collab_AAAAAAAA")!.status).toBe("REVOKED");
    // F5 : app.uninstalled écrit dans l'outbox pour chaque installation de test retirée (et seulement celles-là).
    const jobs = (state.fake!.tables.job ?? []).filter((j) => j.type === "app.uninstalled");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ storeId: A, payload: { storeId: A, appId: "app_DEVDEVDEV", installationId: "inst_TEST0001", test: true } });
  });

  it("réinvitation après révocation : repasse PENDING avec un nouveau jeton", async () => {
    state.fake!.tables.storeCollaborator.push({ id: "collab_AAAAAAAA", storeId: A, email: "dev@x.test", status: "REVOKED", userId: "user_dev", permissions: ["apps.test_install"], tokenHash: sha(TOKEN), expiresAt: new Date(), revokedAt: new Date() });
    expect((await inviteDeveloper(undefined, fd({ storeId: A, email: "dev@x.test", "permissions[]": "apps.manage_installs" }))).ok).toBe(true);
    const row = state.fake!.tables.storeCollaborator.find((c) => c.id === "collab_AAAAAAAA")!;
    expect(row.status).toBe("PENDING");
    expect(row.userId).toBeNull();
    expect(row.revokedAt).toBeNull();
    expect(row.tokenHash).not.toBe(sha(TOKEN));
  });
});

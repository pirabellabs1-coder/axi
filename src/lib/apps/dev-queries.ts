import "server-only";
import { db } from "@/lib/db";
import { listCollaboratorStores } from "./collaborators";
import { TEST_INSTALL_ROLES, isAppOwner, isTestInstallConfig } from "./dev-logic";

/**
 * Lectures du portail développeur. Isolation : tout est filtré par `developerUserId = userId`
 * (apps) ou par les adhésions / collaborations ACTIVES de l'utilisateur (boutiques).
 */

/** Lien « Retour à ma boutique » : première adhésion non expirée → /app/<storeId>, sinon /app. */
export async function homeStoreHref(userId: string): Promise<string> {
  const m = await db.membership.findFirst({
    where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: "asc" },
    select: { storeId: true },
  });
  return m ? `/app/${m.storeId}` : "/app";
}

export type TestStore = { id: string; name: string; slug: string; via: "membership" | "collaborator" };

/** Boutiques où l'utilisateur peut installer une app en test : les siennes (OWNER/MANAGER) + collaborations `apps.test_install`. */
export async function listTestStores(userId: string): Promise<TestStore[]> {
  const [memberships, collabs] = await Promise.all([
    db.membership.findMany({
      where: { userId, role: { in: [...TEST_INSTALL_ROLES] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], store: { status: { not: "ARCHIVED" } } },
      orderBy: { createdAt: "asc" },
      select: { store: { select: { id: true, name: true, slug: true } } },
    }),
    listCollaboratorStores(userId),
  ]);
  const out: TestStore[] = memberships.map((m) => ({ ...m.store, via: "membership" as const }));
  const seen = new Set(out.map((s) => s.id));
  for (const c of collabs) {
    if (seen.has(c.store.id) || !c.permissions.includes("apps.test_install")) continue;
    seen.add(c.store.id);
    out.push({ ...c.store, via: "collaborator" });
  }
  return out;
}

/**
 * Apps du développeur avec compteurs : installations réelles actives (hors test), installations de test
 * actives et nombre d'URI de redirection OAuth (pour le parcours « configurer »).
 */
export async function listDeveloperApps(userId: string) {
  const apps = await db.app.findMany({
    where: { developerUserId: userId },
    orderBy: { updatedAt: "desc" },
    include: { installs: { where: { status: "ACTIVE" }, select: { config: true, billingStatus: true, priceAmount: true } } },
  });
  const clientIds = apps.map((a) => a.oauthClientId).filter((v): v is string => !!v);
  const clients = clientIds.length
    ? await db.oAuthClient.findMany({ where: { clientId: { in: clientIds } }, select: { clientId: true, redirectUris: true } })
    : [];
  const redirects = new Map(clients.map((c) => [c.clientId, c.redirectUris.length]));
  return apps.map(({ installs, ...app }) => {
    const test = installs.filter((i) => isTestInstallConfig(i.config));
    const real = installs.filter((i) => !isTestInstallConfig(i.config));
    return {
      ...app,
      realInstalls: real,
      liveInstallCount: real.length,
      testInstallCount: test.length,
      redirectUriCount: app.oauthClientId ? (redirects.get(app.oauthClientId) ?? 0) : 0,
    };
  });
}

/** App du développeur (ou null : inexistante / appartenant à autrui). */
export async function getOwnedApp(appId: string, userId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(appId)) return null;
  const app = await db.app.findUnique({ where: { id: appId } });
  return app && isAppOwner(app, userId) ? app : null;
}

/** Dernière décision de revue (audit `admin.app.*`) : motif de refus éventuel. */
export async function lastReviewDecision(appId: string) {
  const row = await db.auditLog.findFirst({
    where: { target: appId, action: { in: ["admin.app.publish", "admin.app.reject", "admin.app.suspend"] } },
    orderBy: { createdAt: "desc" },
    select: { action: true, metadata: true, createdAt: true },
  });
  if (!row) return null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    action: row.action.replace("admin.app.", "") as "publish" | "reject" | "suspend",
    reason: typeof meta.reason === "string" ? meta.reason : null,
    at: row.createdAt,
  };
}

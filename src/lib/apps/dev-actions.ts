"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/permissions";
import { badIds, fail, guard, parseForm, success, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { generateClientId, generateSecret } from "@/lib/mcp/tokens";
import { enqueue } from "@/lib/jobs";
import { effectivePlanId } from "@/lib/auth/permissions";
import { planScopes } from "@/lib/mcp/scopes";
import { effectiveGrantedScopes } from "./types";
import { hasCollaboratorPermission } from "./collaborators";
import { createAppInstallCode } from "@/lib/mcp/oauth";
import { appBaseUrl, mcpResourceUrl } from "@/lib/mcp/runtime";
import { installRedirectUri } from "./install-flow";
import { appSigningSecret, buildInstallRedirect, generateInstallState } from "./install-signing";
import {
  createAppSchema, updateAppSchema, canEditApp, canSubmitApp, isAppOwner, requiresReReview, decideTestInstall, isTestInstallConfig,
  developerProfileSchema, TEST_INSTALL_CONFIG, type CreateAppInput, type UpdateAppInput,
} from "./dev-logic";

/**
 * Portail développeur : cycle de vie d'une application créée par un utilisateur de la plateforme.
 *
 *  - Tout utilisateur connecté (e-mail vérifié) peut être développeur ; chaque app est scopée par
 *    `developerUserId = user.id`. Un développeur ne voit et ne modifie QUE ses applications
 *    (jamais les apps first-party, dont developerUserId est null).
 *  - Chaque app a un OAuthClient confidentiel associé (client_secret haché, réutilise la crypto de
 *    src/lib/mcp/tokens.ts). Le secret en clair n'est renvoyé qu'UNE fois (création / régénération)
 *    puis n'est plus jamais récupérable.
 */

type SecretReveal = { appId: string; clientId: string; clientSecret: string };

/** Auth développeur : lève AuthError (jamais de redirect, comme les actions admin). */
async function requireDeveloper() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Connexion requise", "UNAUTHENTICATED");
  if (!user.emailVerified) throw new AuthError("Vérifiez d'abord votre adresse e-mail.", "UNAUTHENTICATED");
  return user;
}

/** Charge une app du développeur courant ; null si inexistante ou appartenant à autrui (isolation). */
async function loadOwnedApp(appId: string, userId: string) {
  const app = await db.app.findUnique({ where: { id: appId } });
  return app && isAppOwner(app, userId) ? app : null;
}

function appFields(data: CreateAppInput | UpdateAppInput) {
  return {
    name: data.name,
    tagline: data.tagline ?? null,
    description: data.description ?? null,
    iconUrl: data.iconUrl ?? null,
    category: data.category,
    requestedScopes: data.requestedScopes,
    appUrl: data.appUrl ?? null,
    webhookUrl: data.webhookUrl ?? null,
    supportUrl: data.supportUrl ?? null,
    pricingType: data.pricingType,
    priceAmount: data.pricingType === "FREE" ? 0 : data.priceAmount,
    priceInterval: data.pricingType === "SUBSCRIPTION" ? (data.priceInterval ?? "month") : null,
    trialDays: data.pricingType === "SUBSCRIPTION" ? data.trialDays : 0,
  };
}

/** Crée une application (brouillon) + son OAuthClient confidentiel. Renvoie le client_secret EN CLAIR une seule fois. */
export async function createApp(formData: FormData): Promise<ActionResult<SecretReveal>> {
  return guard(async () => {
    const user = await requireDeveloper();
    const parsed = parseForm(createAppSchema, formData);
    if ("error" in parsed) return parsed.error;
    const data = parsed.data;

    const existing = await db.app.findUnique({ where: { slug: data.slug }, select: { id: true } });
    if (existing) return fail("Cet identifiant est déjà pris. Choisissez-en un autre.", { slug: ["Identifiant déjà utilisé."] });

    // Nom public : celui déjà choisi dans les paramètres développeur (porté par ses apps), sinon le nom du compte.
    const previous = await db.app.findFirst({ where: { developerUserId: user.id }, orderBy: { updatedAt: "desc" }, select: { developerName: true } });
    const developerName = previous?.developerName || user.name || user.email;

    const clientId = generateClientId();
    const secret = generateSecret("clientSecret");

    const app = await db.$transaction(async (tx) => {
      const client = await tx.oAuthClient.create({
        data: { clientId, clientSecretHash: secret.hash, name: data.name.slice(0, 100), redirectUris: data.redirectUris, logoUri: data.iconUrl ?? null },
      });
      const created = await tx.app.create({
        data: {
          slug: data.slug,
          developerUserId: user.id,
          developerName,
          firstParty: false,
          status: "DRAFT",
          listed: false,
          oauthClientId: client.clientId,
          ...appFields(data),
        },
      });
      await audit({ actorId: user.id, action: "app.created", target: created.id, metadata: { slug: created.slug, scopes: created.requestedScopes } }, tx);
      return created;
    });

    revalidatePath("/app/[storeId]/developpeur", "layout");
    return success({ appId: app.id, clientId, clientSecret: secret.value }, "Application créée.");
  });
}

/** Met à jour une app (brouillon ou publiée) du développeur courant. Re-valide les scopes. */
export async function updateApp(appId: string, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    if (badIds(appId)) return fail("Application invalide.");
    const user = await requireDeveloper();
    const app = await loadOwnedApp(appId, user.id);
    if (!app) return fail("Application introuvable.");
    if (!canEditApp(app.status)) return fail("Cette application ne peut pas être modifiée dans son état actuel.");

    const parsed = parseForm(updateAppSchema, formData);
    if ("error" in parsed) return parsed.error;
    const data = parsed.data;

    // Gouvernance : si une app PUBLIÉE change ses permissions, ses URI de redirection ou l'ORIGINE de son appUrl
    // (iframe dans l'admin) ou de son webhookUrl, elle repasse en revue admin (et est délistée) jusqu'à re-validation.
    // Valeurs actuelles relues en base (jamais celles du formulaire) pour la comparaison.
    const currentRedirects = app.oauthClientId
      ? (await db.oAuthClient.findUnique({ where: { clientId: app.oauthClientId }, select: { redirectUris: true } }))?.redirectUris ?? []
      : [];
    const requeue = requiresReReview(
      app.status,
      { requestedScopes: app.requestedScopes, redirectUris: currentRedirects, appUrl: app.appUrl, webhookUrl: app.webhookUrl },
      { requestedScopes: data.requestedScopes, redirectUris: data.redirectUris, appUrl: data.appUrl ?? null, webhookUrl: data.webhookUrl ?? null },
    );

    await db.$transaction(async (tx) => {
      await tx.app.update({ where: { id: app.id }, data: { ...appFields(data), ...(requeue ? { status: "IN_REVIEW" as const, listed: false } : {}) } });
      if (app.oauthClientId) {
        await tx.oAuthClient.updateMany({ where: { clientId: app.oauthClientId }, data: { name: data.name.slice(0, 100), redirectUris: data.redirectUris, logoUri: data.iconUrl ?? null } });
      }
      await audit({ actorId: user.id, action: "app.updated", target: app.id, metadata: { slug: app.slug, scopes: data.requestedScopes, requeuedForReview: requeue } }, tx);
    });

    revalidatePath("/app/[storeId]/developpeur", "layout");
    return success(undefined, requeue
      ? "Modifications enregistrées. Les permissions, URI de redirection ou adresses (application, webhooks) ayant changé, l'application repasse en revue avant d'être de nouveau publiée."
      : "Modifications enregistrées.");
  });
}

/** Soumet une app à la revue de la plateforme : DRAFT → IN_REVIEW. */
export async function submitApp(appId: string): Promise<ActionResult> {
  return guard(async () => {
    if (badIds(appId)) return fail("Application invalide.");
    const user = await requireDeveloper();
    const app = await loadOwnedApp(appId, user.id);
    if (!app) return fail("Application introuvable.");
    if (!canSubmitApp(app.status)) return fail("Seul un brouillon peut être soumis à la revue.");
    if (app.requestedScopes.length === 0) return fail("Déclarez au moins une autorisation avant de soumettre.");

    await db.$transaction(async (tx) => {
      await tx.app.update({ where: { id: app.id }, data: { status: "IN_REVIEW" } });
      await audit({ actorId: user.id, action: "app.submitted", target: app.id, metadata: { slug: app.slug } }, tx);
    });

    revalidatePath("/app/[storeId]/developpeur", "layout");
    return success(undefined, "Application soumise à la revue.");
  });
}

/** Régénère le client_secret de l'app (hash en base) et renvoie le clair une seule fois. */
export async function regenerateClientSecret(appId: string): Promise<ActionResult<{ clientSecret: string }>> {
  return guard(async () => {
    if (badIds(appId)) return fail("Application invalide.");
    const user = await requireDeveloper();
    const app = await loadOwnedApp(appId, user.id);
    if (!app) return fail("Application introuvable.");
    if (!app.oauthClientId) return fail("Cette application n'a pas d'identité OAuth.");

    const secret = generateSecret("clientSecret");
    await db.$transaction(async (tx) => {
      const updated = await tx.oAuthClient.updateMany({ where: { clientId: app.oauthClientId! }, data: { clientSecretHash: secret.hash } });
      if (updated.count === 0) throw new AuthError("Identité OAuth introuvable.");
      await audit({ actorId: user.id, action: "app.secret_regenerated", target: app.id, metadata: { slug: app.slug } }, tx);
    });
    revalidatePath("/app/[storeId]/developpeur", "layout");
    return success({ clientSecret: secret.value }, "Nouveau secret généré. Le secret de signature (whsec_…) a aussi changé : mettez-le à jour sur votre serveur.");
  });
}

/* ───────────────────────── Installation de test ───────────────────────── */

const TEST_DENIED: Record<"not_owner" | "no_store_access" | "suspended", string> = {
  not_owner: "Application introuvable.",
  no_store_access: "Vous devez être propriétaire de cette boutique, ou collaborateur autorisé à installer des apps en test.",
  suspended: "Cette application est suspendue par la plateforme : installation impossible.",
};

/** Vérifie les droits d'installation de test (app possédée + accès boutique) et charge l'app et la boutique. */
type TestAuth =
  | { denied: ActionResult<never> }
  | { denied: null; user: Awaited<ReturnType<typeof requireDeveloper>>; app: NonNullable<Awaited<ReturnType<typeof db.app.findUnique>>>; store: { id: string; slug: string; status: string; subscription: Parameters<typeof effectivePlanId>[0] }; via: "membership" | "collaborator" };

async function authorizeTestInstall(appId: string, storeId: string): Promise<TestAuth> {
  const user = await requireDeveloper();
  const app = await db.app.findUnique({ where: { id: appId } });
  if (!app) return { denied: fail(TEST_DENIED.not_owner) };
  const [membership, collab, store] = await Promise.all([
    db.membership.findUnique({ where: { userId_storeId: { userId: user.id, storeId } }, select: { role: true, expiresAt: true } }),
    hasCollaboratorPermission(user.id, storeId, "apps.test_install"),
    db.store.findUnique({ where: { id: storeId }, select: { id: true, slug: true, status: true, subscription: true } }),
  ]);
  const decision = decideTestInstall({ isOwner: isAppOwner(app, user.id), membership, collaboratorCanTestInstall: collab }, app.status);
  if (!decision.ok) return { denied: fail(TEST_DENIED[decision.reason]) };
  if (!store || store.status === "ARCHIVED") return { denied: fail("Boutique indisponible.") };
  return { denied: null, user, app, store, via: decision.via };
}

function revalidateTest(storeId: string) {
  revalidatePath("/app/[storeId]/developpeur", "layout");
  revalidatePath(`/app/${storeId}/applications`, "layout");
}

/**
 * Installe une app du développeur EN TEST sur une boutique (DRAFT / IN_REVIEW / PUBLISHED acceptés).
 * L'installation est marquée `config: { test: true }`, sans facturation (`billingStatus: "none"`, prix 0)
 * et ne compte pas dans `installCount` (statistique du catalogue). Scopes bornés par le plan de la boutique.
 */
export async function installAppForTesting(appId: string, storeId: string): Promise<ActionResult<{ installationId: string; storeSlug: string; redirectUrl: string | null }>> {
  return guard(async () => {
    if (badIds(appId, storeId)) return fail("Requête invalide.");
    const auth = await authorizeTestInstall(appId, storeId);
    if (auth.denied) return auth.denied;
    const { user, app, store, via } = auth;

    const existing = await db.appInstallation.findUnique({ where: { appId_storeId: { appId: app.id, storeId } }, select: { id: true, status: true, config: true } });
    if (existing && existing.status !== "UNINSTALLED") {
      return fail(isTestInstallConfig(existing.config) ? "Cette application est déjà installée en test sur cette boutique." : "Cette application est déjà installée (installation réelle) sur cette boutique.");
    }
    const granted = effectiveGrantedScopes(app.requestedScopes, planScopes(effectivePlanId(store.subscription)));
    // Même flux que l'installation réelle (src/lib/apps/actions.ts) : grant OAuth de l'installation, puis code
    // d'installation et redirection signée vers l'app si son client est confidentiel avec une URI web.
    const client = app.oauthClientId
      ? await db.oAuthClient.findUnique({ where: { clientId: app.oauthClientId }, select: { id: true, clientSecretHash: true, redirectUris: true, disabledAt: true } })
      : null;
    if (client?.disabledAt) return fail("L'identité OAuth de cette application est désactivée.");
    const redirectUri = client ? installRedirectUri(client) : null;

    const { row, redirectUrl } = await db.$transaction(async (tx) => {
      const grant = client
        ? await tx.oAuthGrant.create({ data: { clientId: client.id, userId: user.id, storeId, scopes: granted, resource: mcpResourceUrl() } })
        : null;
      const data = {
        status: "ACTIVE" as const,
        grantedScopes: granted,
        installedById: user.id,
        oauthGrantId: grant?.id ?? null,
        config: { ...TEST_INSTALL_CONFIG },
        priceAmount: 0,
        billingStatus: "none",
        trialEndsAt: null,
        installedAt: new Date(),
        uninstalledAt: null,
      };
      const r = existing
        ? await tx.appInstallation.update({ where: { id: existing.id }, data })
        : await tx.appInstallation.create({ data: { appId: app.id, storeId, ...data } });
      await audit({ storeId, actorId: user.id, action: "app.test_installed", target: app.id, metadata: { slug: app.slug, scopes: granted, via, status: app.status } }, tx);
      await enqueue("app.installed", { storeId, appId: app.id, installationId: r.id, test: true }, { storeId }, tx);
      let url: string | null = null;
      if (client && redirectUri) {
        const code = await createAppInstallCode(tx, { clientDbId: client.id, userId: user.id, storeId, scopes: granted, redirectUri });
        url = buildInstallRedirect(redirectUri, { code, shop: store.slug, state: generateInstallState(), host: appBaseUrl() }, appSigningSecret(app.id, client.clientSecretHash));
      }
      return { row: r, redirectUrl: url };
    });

    revalidateTest(storeId);
    return success({ installationId: row.id, storeSlug: store.slug, redirectUrl }, `« ${app.name} » installée en test.`);
  });
}

/** Désinstalle une installation DE TEST (jamais une installation réelle d'un marchand). */
export async function uninstallTestInstall(appId: string, storeId: string): Promise<ActionResult> {
  return guard(async () => {
    if (badIds(appId, storeId)) return fail("Requête invalide.");
    const auth = await authorizeTestInstall(appId, storeId);
    if (auth.denied) return auth.denied;
    const { user, app } = auth;

    const install = await db.appInstallation.findFirst({ where: { appId: app.id, storeId }, select: { id: true, status: true, config: true, oauthGrantId: true } });
    if (!install || install.status === "UNINSTALLED" || !isTestInstallConfig(install.config)) return fail("Aucune installation de test active sur cette boutique.");

    await db.$transaction(async (tx) => {
      await tx.appInstallation.update({ where: { id: install.id }, data: { status: "UNINSTALLED", uninstalledAt: new Date(), oauthGrantId: null, billingStatus: "none" } });
      if (install.oauthGrantId) {
        const now = new Date();
        await tx.oAuthGrant.updateMany({ where: { id: install.oauthGrantId, revokedAt: null }, data: { revokedAt: now } });
        await tx.oAuthToken.updateMany({ where: { grantId: install.oauthGrantId, revokedAt: null }, data: { revokedAt: now } });
      }
      await audit({ storeId, actorId: user.id, action: "app.test_uninstalled", target: app.id, metadata: { installationId: install.id } }, tx);
      await enqueue("app.uninstalled", { storeId, appId: app.id, installationId: install.id, test: true }, { storeId }, tx);
    });

    revalidateTest(storeId);
    return success(undefined, "Installation de test retirée.");
  });
}

/* ───────────────────────── Profil développeur ───────────────────────── */

/** Nom public du développeur : appliqué à toutes ses apps (champ App.developerName, affiché au catalogue). */
export async function updateDeveloperProfile(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireDeveloper();
    const parsed = parseForm(developerProfileSchema, formData);
    if ("error" in parsed) return parsed.error;
    const name = parsed.data.developerName;
    const r = await db.$transaction(async (tx) => {
      const u = await tx.app.updateMany({ where: { developerUserId: user.id }, data: { developerName: name } });
      await audit({ actorId: user.id, action: "app.developer_profile_updated", metadata: { developerName: name, apps: u.count } }, tx);
      return u;
    });
    revalidatePath("/app/[storeId]/developpeur", "layout");
    return success(undefined, r.count > 0 ? `Nom public mis à jour sur ${r.count} application${r.count > 1 ? "s" : ""}.` : "Créez d'abord une application : le nom public est enregistré sur vos applications.");
  });
}

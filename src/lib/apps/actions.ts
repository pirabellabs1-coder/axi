"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { badIds, fail, guard, success, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { planScopes } from "@/lib/mcp/scopes";
import { appBaseUrl, mcpResourceUrl } from "@/lib/mcp/runtime";
import { createAppInstallCode } from "@/lib/mcp/oauth";
import { precheckInstall } from "./types";
import { initialBillingForInstall } from "./billing";
import { appSigningSecret, buildInstallRedirect, generateInstallState } from "./install-signing";
import { installRedirectUri } from "./install-flow";

/**
 * Cycle de vie des apps côté marchand. Capacité requise : `integrations.manage` (propriétaire seulement,
 * miroir du scope `webhooks:write` ; une app peut appeler l'API pour le compte de la boutique, donnée
 * potentiellement personnelle sortante). Tout est filtré par `storeId` ; les scopes accordés sont bornés
 * par le plan (voir precheckInstall → effectiveGrantedScopes).
 */

const APP_CAPABILITY = "integrations.manage" as const;

function revalidateApps(storeId: string) {
  revalidatePath(`/app/${storeId}/applications`);
}

/**
 * Installe une app (par slug) sur la boutique. Idempotent côté UI : une seconde installation ACTIVE est refusée.
 * App avec identité OAuth (client confidentiel + URI de redirection http(s)) : un code d'autorisation est émis
 * (lié au grant de l'installation, scopes bornés par le plan) et `redirectUrl` porte `code`, `shop`, `state`,
 * `timestamp`, `host` et `hmac` : le client y redirige le marchand (contrat docs/apps-v2/int.md). Sinon, installation
 * directe (`redirectUrl` null).
 */
export async function installApp(storeId: string, appSlug: string): Promise<ActionResult<{ installationId: string; redirectUrl: string | null }>> {
  return guard(async () => {
    if (badIds(storeId)) return fail("Boutique invalide.");
    if (typeof appSlug !== "string" || !/^[a-z0-9-]{2,64}$/.test(appSlug)) return fail("Application introuvable.");
    const ctx = await requireStore(storeId, APP_CAPABILITY);

    const app = await db.app.findUnique({ where: { slug: appSlug } });
    if (!app || app.status !== "PUBLISHED") return fail("Application introuvable ou indisponible.");

    const existing = await db.appInstallation.findUnique({
      where: { appId_storeId: { appId: app.id, storeId } },
      select: { id: true, status: true, oauthGrantId: true },
    });
    const pre = precheckInstall(existing?.status, app.requestedScopes, planScopes(ctx.planId));
    if (!pre.ok) return fail("Cette application est déjà installée.");
    const granted = pre.grantedScopes;

    // App.oauthClientId porte l'identifiant PUBLIC (axi_cli_…) ; OAuthGrant.clientId référence OAuthClient.id.
    const client = app.oauthClientId
      ? await db.oAuthClient.findUnique({ where: { clientId: app.oauthClientId }, select: { id: true, clientSecretHash: true, redirectUris: true, disabledAt: true } })
      : null;
    if (app.oauthClientId && (!client || client.disabledAt)) return fail("Cette application est momentanément indisponible (identité désactivée).");
    const redirectUri = client ? installRedirectUri(client) : null;

    const { row: install, redirectUrl } = await db.$transaction(async (tx) => {
      // Accès API : un grant OAuth lié à l'OAuthClient de l'app détient les jetons, bornés au scope accordé.
      // Réinstallation (installation SUSPENDED réactivée, ou résidu) : l'ancien grant et ses jetons sont révoqués
      // AVANT d'être remplacés — aucun jeton antérieur ne survit à la nouvelle installation.
      if (existing?.oauthGrantId) {
        const revokedAt = new Date();
        await tx.oAuthGrant.updateMany({ where: { id: existing.oauthGrantId, revokedAt: null }, data: { revokedAt } });
        await tx.oAuthToken.updateMany({ where: { grantId: existing.oauthGrantId, revokedAt: null }, data: { revokedAt } });
      }
      let oauthGrantId: string | null = null;
      if (client) {
        const grant = await tx.oAuthGrant.create({
          data: { clientId: client.id, userId: ctx.user.id, storeId, scopes: granted, resource: mcpResourceUrl() },
        });
        oauthGrantId = grant.id;
      }

      // Facturation initiale (phase D) : essai / actif / gratuit selon le modèle tarifaire de l'app.
      const billing = initialBillingForInstall(app);
      const data = {
        status: "ACTIVE" as const,
        grantedScopes: granted,
        installedById: ctx.user.id,
        oauthGrantId,
        priceAmount: billing.priceAmount,
        billingStatus: billing.billingStatus,
        trialEndsAt: billing.trialEndsAt,
        uninstalledAt: null,
      };
      const row = existing
        ? await tx.appInstallation.update({ where: { id: existing.id }, data })
        : await tx.appInstallation.create({ data: { appId: app.id, storeId, ...data } });

      // N'incrémenter que pour une nouvelle installation ou une réinstallation après désinstallation
      // (l'uninstall a décrémenté). Une réactivation d'un état SUSPENDED n'a jamais été décrémentée → pas d'incrément.
      if (!existing || existing.status === "UNINSTALLED") {
        await tx.app.update({ where: { id: app.id }, data: { installCount: { increment: 1 } } });
      }
      await audit(
        { storeId, actorId: ctx.user.id, action: "app.installed", target: app.id, metadata: { slug: app.slug, scopes: granted } },
        tx,
      );
      await enqueue("app.installed", { storeId, appId: app.id, installationId: row.id }, { storeId }, tx);

      // Installation OAuth réelle : code d'autorisation (60 s, usage unique) puis redirection signée vers l'app.
      let redirectUrl: string | null = null;
      if (client && redirectUri) {
        const code = await createAppInstallCode(tx, { clientDbId: client.id, userId: ctx.user.id, storeId, scopes: granted, redirectUri });
        redirectUrl = buildInstallRedirect(redirectUri, { code, shop: ctx.store.slug, state: generateInstallState(), host: appBaseUrl() }, appSigningSecret(app.id, client.clientSecretHash));
      }
      return { row, redirectUrl };
    });

    // Webhook de cycle de vie (app.webhookUrl) : signé, contrôle SSRF, envoyé après la réponse.
    revalidateApps(storeId);
    return success(
      { installationId: install.id, redirectUrl },
      redirectUrl ? `« ${app.name} » installée : redirection vers l'application…` : `« ${app.name} » installée.`,
    );
  });
}

/** Désinstalle une app : installation → UNINSTALLED, grant OAuth et jetons révoqués, installCount décrémenté. */
export async function uninstallApp(storeId: string, installationId: string): Promise<ActionResult> {
  return guard(async () => {
    if (badIds(storeId, installationId)) return fail("Requête invalide.");
    const ctx = await requireStore(storeId, APP_CAPABILITY);

    const install = await db.appInstallation.findFirst({
      where: { id: installationId, storeId },
      include: { app: { select: { id: true, name: true } } },
    });
    if (!install) return fail("Installation introuvable.");
    if (install.status === "UNINSTALLED") return fail("Cette application n'est pas installée.");

    await db.$transaction(async (tx) => {
      await tx.appInstallation.update({
        where: { id: install.id },
        data: { status: "UNINSTALLED", uninstalledAt: new Date(), oauthGrantId: null, billingStatus: "cancelled" },
      });
      if (install.oauthGrantId) {
        const now = new Date();
        await tx.oAuthGrant.updateMany({ where: { id: install.oauthGrantId, revokedAt: null }, data: { revokedAt: now } });
        await tx.oAuthToken.updateMany({ where: { grantId: install.oauthGrantId, revokedAt: null }, data: { revokedAt: now } });
      }
      // Jamais < 0 : on ne décrémente que si strictement positif.
      await tx.app.updateMany({ where: { id: install.appId, installCount: { gt: 0 } }, data: { installCount: { decrement: 1 } } });
      await audit({ storeId, actorId: ctx.user.id, action: "app.uninstalled", target: install.appId, metadata: { installationId: install.id } }, tx);
      await enqueue("app.uninstalled", { storeId, appId: install.appId, installationId: install.id }, { storeId }, tx);
    });


    revalidateApps(storeId);
    return success(undefined, `« ${install.app.name} » désinstallée.`);
  });
}

/**
 * Annule l'abonnement d'une app payante : billingStatus → `cancelled`.
 * Choix : l'app RESTE installée et utilisable (status ACTIVE) jusqu'à une désinstallation explicite ;
 * seule la facturation s'arrête (pas de renouvellement). Filtré par storeId.
 */
export async function cancelAppSubscription(storeId: string, installationId: string): Promise<ActionResult> {
  return guard(async () => {
    if (badIds(storeId, installationId)) return fail("Requête invalide.");
    const ctx = await requireStore(storeId, APP_CAPABILITY);

    const install = await db.appInstallation.findFirst({
      where: { id: installationId, storeId },
      include: { app: { select: { name: true } } },
    });
    if (!install) return fail("Installation introuvable.");
    if (install.status !== "ACTIVE") return fail("Cette application n'est pas installée.");
    if (install.billingStatus !== "trialing" && install.billingStatus !== "active" && install.billingStatus !== "past_due") {
      return fail("Aucun abonnement actif à annuler.");
    }

    await db.$transaction(async (tx) => {
      await tx.appInstallation.update({ where: { id: install.id }, data: { billingStatus: "cancelled", trialEndsAt: null } });
      await audit({ storeId, actorId: ctx.user.id, action: "app.subscription_cancelled", target: install.appId, metadata: { installationId: install.id } }, tx);
    });

    revalidateApps(storeId);
    return success(undefined, `Abonnement de « ${install.app.name} » annulé.`);
  });
}

/** Met à jour la configuration (JSON) d'une installation ACTIVE. Filtré par storeId. */
export async function updateInstallationConfig(
  storeId: string,
  installationId: string,
  config: Record<string, unknown>,
): Promise<ActionResult> {
  return guard(async () => {
    if (badIds(storeId, installationId)) return fail("Requête invalide.");
    const ctx = await requireStore(storeId, APP_CAPABILITY);
    const install = await db.appInstallation.findFirst({ where: { id: installationId, storeId }, select: { id: true, status: true } });
    if (!install || install.status !== "ACTIVE") return fail("Installation introuvable.");
    if (!config || typeof config !== "object" || Array.isArray(config)) return fail("Configuration invalide.");
    let serialized: string;
    try {
      serialized = JSON.stringify(config);
    } catch {
      return fail("Configuration invalide.");
    }
    // Borne anti-gonflement : une config d'installation reste de la métadonnée légère.
    if (serialized.length > 16_384) return fail("Configuration trop volumineuse (16 Ko maximum).");
    const json = JSON.parse(serialized) as Prisma.InputJsonValue;
    await db.$transaction(async (tx) => {
      await tx.appInstallation.update({ where: { id: install.id }, data: { config: json } });
      await audit({ storeId, actorId: ctx.user.id, action: "app.config_updated", target: install.id }, tx);
    });
    revalidateApps(storeId);
    return success(undefined, "Configuration enregistrée.");
  });
}

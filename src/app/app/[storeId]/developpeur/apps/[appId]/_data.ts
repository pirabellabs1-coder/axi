import "server-only";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getOwnedApp } from "@/lib/apps/dev-queries";
import type { AppFormDefaults } from "../app-form";
import { devBase } from "../../_components/dev-base";

/** Chargement commun des onglets : utilisateur (e-mail vérifié), app possédée (sinon 404) et client OAuth associé. */
export async function loadAppTab(params: Promise<{ storeId: string; appId: string }>) {
  const { storeId, appId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  // Même garde que les actions du portail (requireDeveloper) : pas d'accès aux identifiants sans e-mail vérifié.
  if (!user.emailVerified) redirect(`/verification?next=${encodeURIComponent(`/app/${storeId}/developpeur/apps/${appId}`)}`);
  const app = await getOwnedApp(appId, user.id);
  if (!app) notFound();
  const client = app.oauthClientId
    ? await db.oAuthClient.findUnique({ where: { clientId: app.oauthClientId }, select: { clientId: true, redirectUris: true, lastUsedAt: true } })
    : null;
  return { user, app, client, storeId, dev: devBase(storeId) };
}

export function formDefaults(app: Awaited<ReturnType<typeof loadAppTab>>["app"], redirectUris: string[]): AppFormDefaults {
  return {
    name: app.name,
    slug: app.slug,
    tagline: app.tagline ?? "",
    description: app.description ?? "",
    category: app.category,
    requestedScopes: app.requestedScopes,
    pricingType: app.pricingType,
    priceAmount: app.priceAmount,
    priceInterval: (app.priceInterval as "month" | "year" | null) ?? "",
    trialDays: app.trialDays,
    appUrl: app.appUrl ?? "",
    webhookUrl: app.webhookUrl ?? "",
    supportUrl: app.supportUrl ?? "",
    iconUrl: app.iconUrl ?? "",
    redirectUris,
  };
}

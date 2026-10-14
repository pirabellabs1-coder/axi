"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { formToObject } from "@/lib/action";
import { connectableStores, createAuthorizationCode, loadAndValidateAuthorize, pickAuthorizeParams, redirectWith } from "./oauth";
import { formatScopes } from "./scopes";
import { getMcpKillSwitch } from "./runtime";

/**
 * Décision de l'écran de consentement OAuth (/oauth/authorize). Toute la demande est revalidée côté
 * serveur à partir des champs du formulaire (jamais de confiance dans les champs cachés).
 */

async function validated(formData: FormData) {
  const params = pickAuthorizeParams(formToObject(formData));
  const v = await loadAndValidateAuthorize(params);
  // Erreur de demande : toujours affichée sur la page Axi, jamais renvoyée vers l'URI du client.
  if (!v.ok) redirect(`/oauth/authorize?error=${encodeURIComponent(v.error)}`);
  return v.request;
}

export async function denyAuthorization(formData: FormData): Promise<void> {
  // Refus possible seulement depuis l'écran de consentement d'un utilisateur connecté.
  if (!(await getCurrentUser())) redirect("/connexion");
  const request = await validated(formData);
  redirect(redirectWith(request.redirectUri, { error: "access_denied", error_description: "The user denied the request.", state: request.state }));
}

export async function approveAuthorization(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  if (!user.emailVerified) redirect("/verification");
  if ((await getMcpKillSwitch()).enabled) redirect("/oauth/authorize?error=temporarily_unavailable");
  const request = await validated(formData);
  const storeId = String(formData.get("storeId") ?? "");
  const stores = await connectableStores(user.id, request.scopes);
  const store = stores.find((s) => s.id === storeId);
  if (!store || !store.oauth || store.scopes.length === 0) {
    redirect("/oauth/authorize?error=no_store");
  }
  const code = await createAuthorizationCode({ request, userId: user.id, storeId: store.id, scopes: store.scopes });
  await audit({ storeId: store.id, actorId: user.id, action: "api.oauth.authorized", target: request.client.id, metadata: { client: request.client.name, scopes: formatScopes(store.scopes), redirectHost: new URL(request.redirectUri).host } });
  redirect(redirectWith(request.redirectUri, { code, state: request.state }));
}

import "server-only";
import { notFound, redirect } from "next/navigation";
import { getStorefront } from "@/lib/storefront/data";
import { getBuyer, type Buyer } from "./session";
import { getBuyerKillSwitch } from "./settings";

type StorefrontStore = NonNullable<Awaited<ReturnType<typeof getStorefront>>>["store"];

export type AccountPageContext =
  | { state: "disabled"; store: StorefrontStore }
  | { state: "ready"; store: StorefrontStore; buyer: Buyer; readOnly: boolean };

/**
 * Contexte des pages /s/[slug]/compte/** : boutique publique (SUSPENDED / ARCHIVED / brouillon : 404),
 * comptes activés, acheteur connecté (sinon redirection vers la connexion avec retour à la page demandée).
 * Lecture seule si la boutique est fermée temporairement ou si l'arrêt d'urgence plateforme est actif.
 */
export async function getAccountPage(slug: string, returnTo: string): Promise<AccountPageContext> {
  const sf = await getStorefront(slug);
  if (!sf) notFound();
  const store = sf.store;
  if (store.status !== "PUBLISHED" && store.status !== "CLOSED_TEMPORARILY") notFound();
  if (!store.accountsEnabled) return { state: "disabled", store };
  const buyer = await getBuyer(store);
  if (!buyer) redirect(`/s/${store.slug}/compte/connexion?next=${encodeURIComponent(returnTo)}`);
  const kill = await getBuyerKillSwitch();
  return { state: "ready", store, buyer, readOnly: store.status === "CLOSED_TEMPORARILY" || kill.enabled };
}

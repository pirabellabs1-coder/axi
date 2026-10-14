import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { Customer } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { normalizeIp } from "@/lib/rate-limit";
import { SESSION_DAYS, buyerCookieName, buyerCookiePath, hashSessionToken, isSessionTokenShape, isSessionValid, newSessionToken, sessionExpiry, shouldTouchSession } from "./otp";

/**
 * Session acheteur (lot 1, F1). CONTRAT figé pour les équipes B, D, E :
 *
 *   getBuyer(store) → { customerId, customer } | null
 *
 * Lit le cookie `axi_buyer` (jeton aléatoire de 32 octets ; seul son sha256 est en base) et ne renvoie
 * l'acheteur que si la session appartient à CETTE boutique, n'est ni révoquée ni expirée, et que les comptes
 * sont activés sur la boutique. Mise en cache par requête. Glissement de 90 jours, écrit au plus toutes les 10 min.
 */
export type BuyerStoreRef = { id: string; slug?: string };
export type Buyer = { customerId: string; customer: Customer; sessionId: string };

const APP_DOMAIN = (process.env.NEXT_PUBLIC_APP_DOMAIN ?? "localhost:3000").toLowerCase();

const SECURE = process.env.NODE_ENV === "production";

/** Chemin et nom du cookie selon l'hôte (voir buyerCookiePath / buyerCookieName dans otp.ts). */
async function cookieTarget(slug: string): Promise<{ name: string; path: string }> {
  const host = (await headers()).get("host");
  return { name: buyerCookieName(host, APP_DOMAIN, SECURE), path: buyerCookiePath(host, slug, APP_DOMAIN) };
}

async function writeCookie(slug: string, token: string) {
  const jar = await cookies();
  const { name, path } = await cookieTarget(slug);
  jar.set(name, token, { httpOnly: true, sameSite: "lax", secure: SECURE, path, maxAge: SESSION_DAYS * 86400 });
}

const readSession = cache(async (storeId: string): Promise<Buyer | null> => {
  const jar = await cookies();
  const { name } = await cookieTarget("x");
  const token = jar.get(name)?.value;
  if (!isSessionTokenShape(token)) return null;
  const session = await db.customerSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { customer: true, store: { select: { accountsEnabled: true, status: true, slug: true } } },
  });
  const now = new Date();
  if (!session || !isSessionValid(session, storeId, now)) return null;
  if (!session.store.accountsEnabled || session.customer.storeId !== storeId) return null;
  if (session.store.status !== "PUBLISHED" && session.store.status !== "CLOSED_TEMPORARILY") return null;

  if (shouldTouchSession(session, now)) {
    // Écriture conditionnelle : une seule mise à jour même si plusieurs requêtes arrivent ensemble.
    const touched = await db.customerSession.updateMany({
      where: { id: session.id, lastSeenAt: session.lastSeenAt, revokedAt: null },
      data: { lastSeenAt: now, expiresAt: sessionExpiry(now) },
    });
    // Cookie prolongé quand on est dans une action serveur (impossible pendant le rendu : ignoré).
    if (touched.count === 1) {
      try {
        await writeCookie(session.store.slug, token);
      } catch {
        /* rendu de Server Component : le cookie sera prolongé à la prochaine action */
      }
    }
  }
  return { customerId: session.customerId, customer: session.customer, sessionId: session.id };
});

export async function getBuyer(store: BuyerStoreRef): Promise<Buyer | null> {
  if (!store?.id) return null;
  return readSession(store.id);
}

/** Ouvre une session (après vérification du code) et pose le cookie. */
export async function createBuyerSession(storeId: string, slug: string, customerId: string): Promise<void> {
  const token = newSessionToken();
  const h = await headers();
  await db.customerSession.create({
    data: {
      storeId,
      customerId,
      tokenHash: hashSessionToken(token),
      userAgent: h.get("user-agent")?.slice(0, 255) ?? null,
      ip: normalizeIp(h.get("x-forwarded-for") ?? h.get("x-real-ip")),
      lastSeenAt: new Date(),
      expiresAt: sessionExpiry(),
    },
  });
  await writeCookie(slug, token);
}

/** Déconnexion de l'appareil courant : session révoquée et cookie effacé. */
export async function destroyBuyerSession(storeId: string, slug: string): Promise<void> {
  const jar = await cookies();
  const { name, path } = await cookieTarget(slug);
  const token = jar.get(name)?.value;
  if (isSessionTokenShape(token)) {
    await db.customerSession.updateMany({ where: { tokenHash: hashSessionToken(token), storeId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  jar.set(name, "", { httpOnly: true, sameSite: "lax", secure: SECURE, path, maxAge: 0 });
}

/**
 * Révoque toutes les sessions d'un client (déconnexion de tous les appareils, changement de téléphone par le
 * commerçant, demande de suppression). Toujours borné à la boutique. Utilisable dans une transaction.
 */
export async function revokeCustomerSessions(storeId: string, customerId: string, client: Tx | typeof db = db): Promise<number> {
  const r = await client.customerSession.updateMany({ where: { storeId, customerId, revokedAt: null }, data: { revokedAt: new Date() } });
  return r.count;
}

/** Identifiants des produits favoris de l'acheteur connecté (cœurs des cartes produit, équipe E). */
export async function getFavoriteProductIds(store: BuyerStoreRef): Promise<Set<string>> {
  const buyer = await getBuyer(store);
  if (!buyer) return new Set();
  const rows = await db.customerFavorite.findMany({ where: { storeId: store.id, customerId: buyer.customerId }, select: { productId: true }, take: 200 });
  return new Set(rows.map((r) => r.productId));
}

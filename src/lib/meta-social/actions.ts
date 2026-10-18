"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { requireStore } from "@/lib/auth/permissions";
import { guard, fail, success, zRawId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { metaAppSecret, PAGE_SUBSCRIBED_FIELDS, socialLoginConfig } from "./config";
import { exchangeLoginCode, grantedPermissions, listManagedPages, MetaGraphError, subscribePage, toLongLivedToken, unsubscribePage, type MetaPage } from "./graph";

/**
 * Connexion d'une Page Facebook (et du compte Instagram professionnel qui lui est lié) à une boutique, via
 * Facebook Login for Business (configuration NEXT_PUBLIC_META_SOCIAL_CONFIG_ID, response_type=code).
 *
 *  1. `startSocialConnection` : code → jeton (côté serveur, secret de l'app), jeton longue durée, liste des Pages.
 *     Le jeton n'est JAMAIS renvoyé en clair : le navigateur reçoit une « session » chiffrée (AES-256-GCM,
 *     clé serveur) liée à la boutique et à l'utilisateur, valable 15 minutes, pour choisir la Page.
 *  2. `connectSocialPage` : relit la liste avec ce jeton (la Page doit y figurer), abonne l'app aux webhooks de la
 *     Page (`subscribed_apps`), enregistre la Page et le compte Instagram lié, jeton de Page chiffré au repos.
 * Une Page (ou un compte Instagram) ne peut être reliée qu'à UNE boutique Axi : routage strict des webhooks.
 * Capacité `integrations.manage` ; fonctionnalité de plan `liveShopping`.
 */

const SESSION_TTL_MS = 15 * 60_000;

type Session = { s: string; u: string; t: string; e: number };

export type PageChoice = { id: string; name: string; instagram: string | null };

async function socialContext(storeId: string) {
  const ctx = await requireStore(storeId, "integrations.manage");
  if (!PLANS[ctx.planId].features.liveShopping) {
    return { ctx, error: fail(`« Commenter pour acheter » est inclus à partir du plan Scale. Changez de plan : /app/${ctx.store.id}/abonnement`) };
  }
  if (!socialLoginConfig() || !metaAppSecret()) return { ctx, error: fail("La connexion Facebook / Instagram n'est pas encore configurée sur Axi.") };
  return { ctx, error: null };
}

function cleanMessage(e: unknown): string {
  return e instanceof MetaGraphError ? e.message : "Erreur inattendue pendant la connexion à Meta.";
}

const startSchema = z.object({ storeId: zRawId, code: z.string().trim().min(10).max(2000) });

/** Étape 1 : échange du code et liste des Pages. Connecte directement s'il n'y a qu'une Page. */
export async function startSocialConnection(input: { storeId: string; code: string }): Promise<ActionResult<{ pages: PageChoice[]; session: string } | undefined>> {
  return guard(async () => {
    const parsed = startSchema.safeParse(input);
    if (!parsed.success) return fail("Requête invalide.");
    const { ctx, error } = await socialContext(parsed.data.storeId);
    if (error) return error;
    const rl = await rateLimit(`social-connect:${ctx.store.id}`, 10, 600);
    if (!rl.ok) return fail("Trop de tentatives. Réessayez dans quelques minutes.");

    let token: string;
    let pages: MetaPage[];
    try {
      token = await toLongLivedToken(await exchangeLoginCode(parsed.data.code));
      pages = await listManagedPages(token);
    } catch (e) {
      return fail(cleanMessage(e));
    }
    if (pages.length === 0) return fail("Aucune Page Facebook n'a été partagée avec Axi. Relancez la connexion et cochez votre Page (et son compte Instagram).");

    const session = encryptSecret(JSON.stringify({ s: ctx.store.id, u: ctx.user.id, t: token, e: Date.now() + SESSION_TTL_MS } satisfies Session));
    if (pages.length === 1) {
      const r = await connectWithToken(ctx.store.id, ctx.user.id, token, pages[0].id);
      return r.ok ? success(undefined, r.message) : r;
    }
    return success({ session, pages: pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram?.username ? `@${p.instagram.username}` : p.instagram ? "compte Instagram lié" : null })) });
  });
}

const connectSchema = z.object({ storeId: zRawId, session: z.string().min(20).max(8000), pageId: z.string().regex(/^\d{5,32}$/) });

/** Étape 2 : la Page choisie est connectée. */
export async function connectSocialPage(input: { storeId: string; session: string; pageId: string }): Promise<ActionResult> {
  return guard(async () => {
    const parsed = connectSchema.safeParse(input);
    if (!parsed.success) return fail("Requête invalide.");
    const { ctx, error } = await socialContext(parsed.data.storeId);
    if (error) return error;
    let session: Session;
    try {
      session = JSON.parse(decryptSecret(parsed.data.session)) as Session;
    } catch {
      return fail("Session de connexion invalide : relancez la connexion.");
    }
    if (session.s !== ctx.store.id || session.u !== ctx.user.id || typeof session.t !== "string" || !(session.e > Date.now())) {
      return fail("Session de connexion expirée : relancez la connexion.");
    }
    return connectWithToken(ctx.store.id, ctx.user.id, session.t, parsed.data.pageId);
  });
}

async function connectWithToken(storeId: string, userId: string, userToken: string, pageId: string): Promise<ActionResult> {
  let page: MetaPage | undefined;
  let scopes: string[] = [];
  try {
    page = (await listManagedPages(userToken)).find((p) => p.id === pageId);
    if (!page) return fail("Cette Page n'a pas été partagée avec Axi.");
    scopes = await grantedPermissions(userToken);
  } catch (e) {
    return fail(cleanMessage(e));
  }

  // Une Page / un compte déjà relié à une AUTRE boutique : refus (routage strict des webhooks).
  const taken = await db.socialAccount.findFirst({
    where: { storeId: { not: storeId }, OR: [{ platform: "FACEBOOK", externalId: page.id }, ...(page.instagram ? [{ platform: "INSTAGRAM" as const, externalId: page.instagram.id }] : [])] },
    select: { id: true },
  });
  if (taken) return fail("Cette Page (ou son compte Instagram) est déjà reliée à une autre boutique Axi. Déconnectez-la d'abord de l'autre boutique.");

  try {
    await subscribePage(page.id, page.accessToken, PAGE_SUBSCRIBED_FIELDS);
  } catch (e) {
    return fail(`Abonnement aux notifications de la Page impossible. ${cleanMessage(e)}`);
  }

  const tokenEncrypted = encryptSecret(page.accessToken);
  const rows = [
    { platform: "FACEBOOK" as const, externalId: page.id, name: page.name, username: null as string | null },
    ...(page.instagram ? [{ platform: "INSTAGRAM" as const, externalId: page.instagram.id, name: page.instagram.username ? `@${page.instagram.username}` : `${page.name} (Instagram)`, username: page.instagram.username }] : []),
  ];
  try {
    await db.$transaction(async (tx) => {
      for (const r of rows) {
        await tx.socialAccount.upsert({
          where: { platform_externalId: { platform: r.platform, externalId: r.externalId } },
          create: { storeId, platform: r.platform, externalId: r.externalId, pageId: page.id, name: r.name, username: r.username, tokenEncrypted, scopes, status: "active", connectedById: userId },
          update: { name: r.name, username: r.username, pageId: page.id, tokenEncrypted, scopes, status: "active", lastError: null, connectedById: userId },
        });
      }
      // Garde-fou : l'upsert ne doit jamais avoir rattaché un compte d'une autre boutique.
      const foreign = await tx.socialAccount.count({ where: { storeId: { not: storeId }, OR: rows.map((r) => ({ platform: r.platform, externalId: r.externalId })) } });
      if (foreign > 0) throw new Error("foreign");
    });
  } catch (e) {
    if ((e as Error).message === "foreign" || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) {
      return fail("Cette Page est déjà reliée à une autre boutique Axi.");
    }
    throw e;
  }
  await audit({ storeId, actorId: userId, action: "social.connected", target: page.id, metadata: { instagram: !!page.instagram, scopes: scopes.length } });
  revalidatePath(`/app/${storeId}/live`);
  return success(undefined, page.instagram ? `${page.name} et son compte Instagram sont connectés.` : `${page.name} est connectée (aucun compte Instagram professionnel lié à cette Page).`);
}

/** Déconnecte une Page (et le compte Instagram lié, qui partage son jeton). Les réservations sont conservées. */
export async function disconnectSocialAccount(storeId: string, accountId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "integrations.manage");
    const account = await db.socialAccount.findFirst({ where: { id: accountId, storeId: ctx.store.id }, select: { id: true, pageId: true, tokenEncrypted: true } });
    if (!account) return fail("Compte introuvable.");
    try {
      await unsubscribePage(account.pageId, decryptSecret(account.tokenEncrypted));
    } catch {
      // Jeton déjà révoqué : la suppression locale suffit (plus aucun routage possible).
    }
    await db.socialAccount.deleteMany({ where: { storeId: ctx.store.id, pageId: account.pageId } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "social.disconnected", target: account.pageId });
    revalidatePath(`/app/${ctx.store.id}/live`);
    return success(undefined, "Compte déconnecté.");
  });
}

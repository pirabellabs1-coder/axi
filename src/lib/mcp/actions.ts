"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { AuthError, loadStoreContext, requireStore, type Capability, type StoreContext } from "@/lib/auth/permissions";
import { guard, fail, success, zId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { MCP_LIMITS, PLANS } from "@/config/plans";
import { parseScopes, planScopes, planForScope, SCOPE_LABELS } from "./scopes";
import { generateApiToken } from "./tokens";

/**
 * Connecteurs IA — actions de l'espace marchand : jetons API (créer, révoquer, faire tourner), applications
 * connectées par OAuth (révoquer), MCP vitrine public (activer/désactiver).
 * Jetons : capacité `integrations.manage` (propriétaire). Le secret n'est renvoyé qu'UNE fois, jamais relu.
 */

const EXPIRY_DAYS = [0, 7, 30, 90, 365] as const;

const createSchema = z.object({
  name: z.string().trim().min(2, "Nom trop court (2 caractères minimum)").max(60, "60 caractères maximum"),
  scopes: z.array(z.string()).min(1, "Choisissez au moins une autorisation").max(20),
  expiresInDays: z.number().int().refine((n) => (EXPIRY_DAYS as readonly number[]).includes(n), "Durée invalide"),
});

export type CreatedToken = { id: string; token: string; prefix: string; name: string };

/**
 * Contexte pour une RÉVOCATION : mêmes contrôles que requireStore (membre, e-mail vérifié, capacité) mais
 * autorisée même si la boutique est suspendue : retirer un accès doit toujours rester possible.
 */
async function requireStoreForRevocation(storeId: string, cap: Capability): Promise<StoreContext> {
  const ctx = await loadStoreContext(storeId);
  if (!ctx) throw new AuthError("Boutique introuvable ou accès refusé");
  if (!ctx.user.emailVerified) throw new AuthError("Vérifiez d'abord votre adresse e-mail.", "UNAUTHENTICATED");
  if (!ctx.can(cap)) throw new AuthError("Votre rôle ne permet pas cette action");
  return ctx;
}

function revalidateIa(storeId: string) {
  revalidatePath(`/app/${storeId}/integrations/ia`);
}

function activeTokenWhere(storeId: string) {
  return { storeId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
}

export async function createApiToken(storeId: string, input: z.input<typeof createSchema>): Promise<ActionResult<CreatedToken>> {
  return guard(async () => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Formulaire invalide");
    const ctx = await requireStore(storeId, "integrations.manage");
    const limits = MCP_LIMITS[ctx.planId];
    const scopes = parseScopes(parsed.data.scopes);
    if (!scopes.length) return fail("Choisissez au moins une autorisation");
    const allowed = new Set(planScopes(ctx.planId));
    const blocked = scopes.filter((s) => !allowed.has(s));
    if (blocked.length) {
      const plan = PLANS[planForScope(blocked[0])];
      return fail(`« ${SCOPE_LABELS[blocked[0]].label} » est inclus à partir du plan ${plan.name}. Changez de plan depuis la page Abonnement.`);
    }
    const { token, prefix, hash } = generateApiToken();
    const expiresAt = parsed.data.expiresInDays ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000) : null;
    const max = limits.maxTokens;
    const row = await db.$transaction(async (tx) => {
      // Plafond compté sous verrou de la boutique : deux créations simultanées ne peuvent pas le dépasser.
      if (max != null) {
        await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${ctx.store.id} FOR UPDATE`;
        const active = await tx.apiToken.count({ where: activeTokenWhere(ctx.store.id) });
        if (active >= max) return { limit: active } as const;
      }
      const created = await tx.apiToken.create({ data: { storeId: ctx.store.id, name: parsed.data.name, prefix, secretHash: hash, scopes, createdById: ctx.user.id, expiresAt } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "api.token.created", target: created.id, metadata: { name: created.name, prefix, scopes, expiresAt } }, tx);
      return created;
    });
    if ("limit" in row) {
      return fail(`Limite atteinte : ${row.limit}/${max} jeton${max! > 1 ? "s" : ""} actif${max! > 1 ? "s" : ""} sur le plan ${PLANS[ctx.planId].name}. Révoquez un jeton ou changez de plan.`);
    }
    revalidateIa(ctx.store.id);
    return success({ id: row.id, token, prefix, name: row.name }, "Jeton créé");
  });
}

export async function revokeApiToken(storeId: string, tokenId: string): Promise<ActionResult> {
  return guard(async () => {
    if (!zId.safeParse(tokenId).success) return fail("Jeton introuvable");
    const ctx = await requireStoreForRevocation(storeId, "integrations.manage");
    const done = await db.$transaction(async (tx) => {
      const r = await tx.apiToken.updateMany({ where: { id: tokenId, storeId: ctx.store.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (r.count) await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "api.token.revoked", target: tokenId }, tx);
      return r.count;
    });
    if (!done) return fail("Jeton introuvable ou déjà révoqué");
    revalidateIa(ctx.store.id);
    return success(undefined, "Jeton révoqué : il ne fonctionne plus");
  });
}

/** Remplace un jeton par un nouveau secret (mêmes nom, autorisations et durée) ; l'ancien cesse immédiatement de fonctionner. */
export async function rotateApiToken(storeId: string, tokenId: string): Promise<ActionResult<CreatedToken>> {
  return guard(async () => {
    if (!zId.safeParse(tokenId).success) return fail("Jeton introuvable");
    const ctx = await requireStore(storeId, "integrations.manage");
    const old = await db.apiToken.findFirst({ where: { id: tokenId, storeId: ctx.store.id, revokedAt: null } });
    if (!old) return fail("Jeton introuvable ou déjà révoqué");
    const allowed = new Set(planScopes(ctx.planId));
    const scopes = parseScopes(old.scopes).filter((s) => allowed.has(s));
    if (!scopes.length) return fail("Aucune autorisation de ce jeton n'est incluse dans votre plan actuel : créez-en un nouveau.");
    const lifetime = old.expiresAt ? old.expiresAt.getTime() - old.createdAt.getTime() : null;
    const { token, prefix, hash } = generateApiToken();
    const row = await db.$transaction(async (tx) => {
      const r = await tx.apiToken.updateMany({ where: { id: old.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (r.count === 0) throw new Error("Jeton déjà révoqué");
      const created = await tx.apiToken.create({ data: { storeId: ctx.store.id, name: old.name, prefix, secretHash: hash, scopes, createdById: ctx.user.id, expiresAt: lifetime ? new Date(Date.now() + lifetime) : null } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "api.token.rotated", target: created.id, metadata: { previous: old.id, prefix } }, tx);
      return created;
    });
    revalidateIa(ctx.store.id);
    return success({ id: row.id, token, prefix, name: row.name }, "Nouveau secret généré");
  });
}

/** Retire l'accès d'une application connectée par OAuth (propriétaire, ou membre qui l'a autorisée). */
export async function revokeOAuthGrant(storeId: string, grantId: string): Promise<ActionResult> {
  return guard(async () => {
    if (!zId.safeParse(grantId).success) return fail("Application introuvable");
    const ctx = await requireStoreForRevocation(storeId, "store.settings");
    const grant = await db.oAuthGrant.findFirst({ where: { id: grantId, storeId: ctx.store.id, revokedAt: null }, select: { id: true, userId: true, client: { select: { name: true } } } });
    if (!grant) return fail("Application introuvable ou déjà déconnectée");
    if (grant.userId !== ctx.user.id && !ctx.can("integrations.manage")) return fail("Seul le propriétaire ou le membre qui a connecté cette application peut la déconnecter.");
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.oAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: now } });
      await tx.oAuthToken.updateMany({ where: { grantId: grant.id, revokedAt: null }, data: { revokedAt: now } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "api.oauth.revoked", target: grant.id, metadata: { client: grant.client.name } }, tx);
    });
    revalidateIa(ctx.store.id);
    return success(undefined, `${grant.client.name} est déconnecté`);
  });
}

/** MCP vitrine public + llms.txt : la boutique est-elle consultable par les assistants IA ? */
export async function setAiAgentsEnabled(storeId: string, enabled: boolean): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    const value = z.boolean().parse(enabled);
    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: ctx.store.id }, data: { aiAgentsEnabled: value } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "store.ai_agents", metadata: { enabled: value } }, tx);
    });
    revalidateIa(ctx.store.id);
    return success(undefined, value ? "Votre boutique est visible des assistants IA" : "Votre boutique n'est plus exposée aux assistants IA");
  });
}

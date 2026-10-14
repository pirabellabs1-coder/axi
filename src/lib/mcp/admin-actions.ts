"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdminPermission } from "@/lib/admin/context";
import { guard, fail, success, zId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { MCP_KILL_SWITCH_KEY, resetKillSwitchCache } from "./runtime";

/**
 * Console plateforme — connecteurs IA : arrêt d'urgence global (settings.manage), révocation de jetons et
 * d'autorisations OAuth, désactivation d'un client OAuth (stores.moderate). Actions préfixées admin.* dans l'audit.
 */

function revalidateAdmin() {
  revalidatePath("/admin/connecteurs-ia");
}

export async function setMcpKillSwitch(enabled: boolean, message: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    const parsed = z.object({ enabled: z.boolean(), message: z.string().trim().max(240, "240 caractères maximum") }).safeParse({ enabled, message });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    await db.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: MCP_KILL_SWITCH_KEY },
        create: { key: MCP_KILL_SWITCH_KEY, value: parsed.data, updatedBy: user.id },
        update: { value: parsed.data, updatedBy: user.id },
      });
      await audit({ actorId: user.id, action: "admin.mcp.kill_switch", metadata: parsed.data }, tx);
    });
    resetKillSwitchCache();
    revalidateAdmin();
    return success(undefined, parsed.data.enabled ? "Connecteurs IA suspendus sur toute la plateforme" : "Connecteurs IA réactivés");
  });
}

export async function adminRevokeApiToken(tokenId: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("stores.moderate");
    if (!zId.safeParse(tokenId).success) return fail("Jeton introuvable");
    const t = await db.apiToken.findUnique({ where: { id: tokenId }, select: { id: true, storeId: true, name: true, revokedAt: true } });
    if (!t || t.revokedAt) return fail("Jeton introuvable ou déjà révoqué");
    await db.$transaction(async (tx) => {
      await tx.apiToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
      await audit({ storeId: t.storeId, actorId: user.id, action: "admin.mcp.token_revoked", target: t.id, metadata: { name: t.name } }, tx);
    });
    revalidateAdmin();
    revalidatePath(`/app/${t.storeId}/integrations/ia`);
    return success(undefined, "Jeton révoqué");
  });
}

export async function adminRevokeGrant(grantId: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("stores.moderate");
    if (!zId.safeParse(grantId).success) return fail("Autorisation introuvable");
    const g = await db.oAuthGrant.findUnique({ where: { id: grantId }, select: { id: true, storeId: true, revokedAt: true, client: { select: { name: true } } } });
    if (!g || g.revokedAt) return fail("Autorisation introuvable ou déjà révoquée");
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.oAuthGrant.update({ where: { id: g.id }, data: { revokedAt: now } });
      await tx.oAuthToken.updateMany({ where: { grantId: g.id, revokedAt: null }, data: { revokedAt: now } });
      await audit({ storeId: g.storeId, actorId: user.id, action: "admin.mcp.grant_revoked", target: g.id, metadata: { client: g.client.name } }, tx);
    });
    revalidateAdmin();
    return success(undefined, "Accès de l'application révoqué");
  });
}

/** Désactive un client OAuth (application abusive) : tous ses accès cessent de fonctionner. */
export async function adminSetClientDisabled(clientId: string, disabled: boolean): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("stores.moderate");
    if (!zId.safeParse(clientId).success) return fail("Application introuvable");
    const c = await db.oAuthClient.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
    if (!c) return fail("Application introuvable");
    await db.$transaction(async (tx) => {
      await tx.oAuthClient.update({ where: { id: c.id }, data: { disabledAt: disabled ? new Date() : null } });
      await audit({ actorId: user.id, action: disabled ? "admin.mcp.client_disabled" : "admin.mcp.client_enabled", target: c.id, metadata: { name: c.name } }, tx);
    });
    revalidateAdmin();
    return success(undefined, disabled ? `${c.name} est désactivée` : `${c.name} est réactivée`);
  });
}

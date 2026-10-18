"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { cleanGoogleCategory, readSettings } from "./feed-items";
import { invalidateFeedCache } from "./feeds";
import { FEED_CHANNELS, SYNC_CHANNEL, requestCatalogSync, type FeedChannel } from "./sync";

/**
 * Écran « Catalogue WhatsApp et flux » (/app/{storeId}/integrations/whatsapp-catalogue).
 * Capacité : integrations.manage (propriétaire). Plans : flux = `catalogFeeds`, synchronisation API = `catalogSync`.
 */

const page = (storeId: string) => `/app/${storeId}/integrations/whatsapp-catalogue`;

function upsell(planName: string, what: string) {
  return `${what} est incluse à partir du plan Business (plan actuel : ${planName}). Changez de plan depuis la page Abonnement.`;
}

const zChannel = z.enum(FEED_CHANNELS);

/** Active ou désactive un flux public (Meta, Google ou TikTok). */
export async function setCatalogFeed(storeId: string, channel: FeedChannel, enabled: boolean): Promise<ActionResult> {
  return guard(async () => {
    const parsed = z.object({ storeId: z.string().min(8).max(64), channel: zChannel, enabled: z.boolean() }).safeParse({ storeId, channel, enabled });
    if (!parsed.success) return fail("Requête invalide");
    const ctx = await requireStore(parsed.data.storeId, "integrations.manage");
    const plan = PLANS[ctx.planId];
    if (parsed.data.enabled && !plan.features.catalogFeeds) return fail(upsell(plan.name, "La publication des flux catalogues"));
    await db.socialCatalogSync.upsert({
      where: { storeId_channel: { storeId: ctx.store.id, channel: parsed.data.channel } },
      create: { storeId: ctx.store.id, channel: parsed.data.channel, enabled: parsed.data.enabled },
      update: { enabled: parsed.data.enabled },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: parsed.data.enabled ? "catalog.feed_enabled" : "catalog.feed_disabled", target: parsed.data.channel });
    invalidateFeedCache(ctx.store.id);
    revalidatePath(page(ctx.store.id));
    return success(undefined, parsed.data.enabled ? "Flux activé" : "Flux désactivé");
  });
}

const optionsSchema = z.object({
  storeId: z.string().min(8).max(64),
  brand: z.string().trim().max(70, "70 caractères au maximum").optional().default(""),
  googleProductCategory: z
    .string()
    .trim()
    .max(250, "250 caractères au maximum")
    .optional()
    .default("")
    .refine((v) => v === "" || cleanGoogleCategory(v) !== null, "Indiquez un numéro de catégorie Google ou un chemin « Niveau 1 > Niveau 2 »"),
  includeOutOfStock: zBool,
});

/** Options communes aux flux et à la synchronisation (liste blanche : marque, articles en rupture). */
export async function saveCatalogOptions(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(optionsSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "integrations.manage");
    const plan = PLANS[ctx.planId];
    if (!plan.features.catalogFeeds && !plan.features.catalogSync) return fail(upsell(plan.name, "La gestion des catalogues"));
    const settings = readSettings({ brand: parsed.data.brand, includeOutOfStock: parsed.data.includeOutOfStock, googleProductCategory: parsed.data.googleProductCategory });
    const json = settings as unknown as Prisma.InputJsonValue;
    await db.$transaction(async (tx) => {
      for (const channel of [...FEED_CHANNELS, SYNC_CHANNEL]) {
        await tx.socialCatalogSync.upsert({
          where: { storeId_channel: { storeId: ctx.store.id, channel } },
          create: { storeId: ctx.store.id, channel, settings: json },
          update: { settings: json },
        });
      }
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "catalog.options_updated", metadata: { includeOutOfStock: settings.includeOutOfStock, brand: settings.brand, googleProductCategory: settings.googleProductCategory } });
    invalidateFeedCache(ctx.store.id);
    revalidatePath(page(ctx.store.id));
    return success(undefined, "Options enregistrées");
  });
}

const syncSchema = z.object({
  storeId: z.string().min(8).max(64),
  externalCatalogId: z.string().trim().regex(/^\d{5,32}$/, "Identifiant de catalogue invalide (chiffres uniquement, visible dans Commerce Manager)"),
  enabled: zBool,
});

/** Configure la synchronisation API vers le catalogue Meta relié au numéro WhatsApp Business. */
export async function saveCatalogSync(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(syncSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "integrations.manage");
    const plan = PLANS[ctx.planId];
    if (!plan.features.catalogSync) return fail(upsell(plan.name, "La synchronisation du catalogue WhatsApp"));
    const integration = await db.integration.findUnique({ where: { storeId_kind: { storeId: ctx.store.id, kind: "whatsapp_cloud" } }, select: { status: true } });
    if (parsed.data.enabled && !integration) return fail("Connectez d'abord l'API WhatsApp officielle depuis la page WhatsApp.");

    const { externalCatalogId, enabled } = parsed.data;
    const now = new Date();
    await db.$transaction(async (tx) => {
      const existing = await tx.socialCatalogSync.findUnique({ where: { storeId_channel: { storeId: ctx.store.id, channel: SYNC_CHANNEL } }, select: { id: true, externalCatalogId: true } });
      const catalogChanged = !!existing && existing.externalCatalogId !== externalCatalogId;
      const data = {
        externalCatalogId,
        enabled,
        // Activation : première synchronisation au prochain passage du worker ; désactivation : plus de planification.
        nextSyncAt: enabled ? now : null,
        ...(catalogChanged ? { status: "idle", lastError: null, consecutiveFailures: 0, itemCount: 0, lastSyncAt: null, lastSuccessAt: null } : enabled ? { consecutiveFailures: 0 } : {}),
      };
      const row = await tx.socialCatalogSync.upsert({
        where: { storeId_channel: { storeId: ctx.store.id, channel: SYNC_CHANNEL } },
        create: { storeId: ctx.store.id, channel: SYNC_CHANNEL, ...data },
        update: data,
        select: { id: true },
      });
      // Nouveau catalogue : l'état par article concernait l'ancien, il est oublié (tout sera renvoyé).
      if (catalogChanged) await tx.socialCatalogItem.deleteMany({ where: { storeId: ctx.store.id, syncId: row.id } });
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "catalog.sync_configured", metadata: { externalCatalogId, enabled } });
    revalidatePath(page(ctx.store.id));
    if (enabled && integration?.status !== "active") {
      return success(undefined, "Enregistré. La synchronisation démarrera dès que la connexion WhatsApp sera validée.");
    }
    return success(undefined, enabled ? "Synchronisation activée : premier envoi dans quelques minutes." : "Synchronisation désactivée");
  });
}

/** Bouton « Synchroniser maintenant » : synchronisation forcée, limitée à 6 par heure et par boutique. */
export async function triggerCatalogSyncNow(storeId: string): Promise<ActionResult> {
  return guard(async () => {
    if (typeof storeId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(storeId)) return fail("Requête invalide");
    const ctx = await requireStore(storeId, "integrations.manage");
    const plan = PLANS[ctx.planId];
    if (!plan.features.catalogSync) return fail(upsell(plan.name, "La synchronisation du catalogue WhatsApp"));
    const rl = await rateLimit(`catalog-sync:${ctx.store.id}`, 6, 3600);
    if (!rl.ok) return fail(`Trop de synchronisations manuelles. Réessayez dans ${Math.max(1, Math.ceil(rl.retryAfter / 60))} minute(s).`);
    const r = await requestCatalogSync(ctx.store.id);
    if (!r.ok) return fail(r.error);
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "catalog.sync_requested", target: r.syncId });
    revalidatePath(page(ctx.store.id));
    return success(undefined, "Synchronisation lancée : le résultat s'affiche ici dans quelques minutes.");
  });
}

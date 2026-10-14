"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthError, loadStoreContext, requireStore, type StoreContext } from "@/lib/auth/permissions";
import { guard, fail, success, badIds, type ActionResult } from "@/lib/action";
import { WEBHOOK_EVENTS } from "./events";
import {
  WebhookError,
  createEndpoint,
  deleteEndpoint,
  replayDelivery,
  rotateEndpointSecret,
  sendTestEvent,
  updateEndpoint,
  type WebhookActor,
} from "./service";

/**
 * Webhooks sortants — actions de l'espace marchand (/app/[storeId]/integrations/webhooks).
 * Capacité `integrations.manage` (propriétaire). Le secret n'est renvoyé qu'UNE fois (création, rotation).
 */

function actorOf(ctx: StoreContext): WebhookActor {
  return { storeId: ctx.store.id, planId: ctx.planId, role: ctx.role, userId: ctx.user.id, label: `user:${ctx.user.id}`, via: "dashboard" };
}

function revalidate(storeId: string) {
  revalidatePath(`/app/${storeId}/integrations/webhooks`);
}

/** Erreur métier du service → message lisible ; le reste remonte à guard(). */
async function run<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  return guard(async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof WebhookError) return fail(e.message);
      throw e;
    }
  });
}

const createSchema = z.object({
  url: z.string().trim().min(8, "Indiquez l'URL de réception").max(2000, "URL trop longue"),
  description: z.string().trim().max(200, "200 caractères maximum").optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Choisissez au moins un événement").max(WEBHOOK_EVENTS.length),
  includePersonalData: z.boolean().default(false),
});

export type CreatedWebhook = { id: string; secret: string };

export async function createWebhookEndpoint(storeId: string, input: z.input<typeof createSchema>): Promise<ActionResult<CreatedWebhook>> {
  return run(async () => {
    const bad = badIds(storeId);
    if (bad) return bad;
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Formulaire invalide");
    const ctx = await requireStore(storeId, "integrations.manage");
    const { endpoint, secret } = await createEndpoint(actorOf(ctx), parsed.data);
    revalidate(ctx.store.id);
    return success({ id: endpoint.id, secret }, "Point de webhook créé");
  });
}

const updateSchema = z.object({
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Choisissez au moins un événement").optional(),
  description: z.string().trim().max(200).nullable().optional(),
  active: z.boolean().optional(),
});

export async function updateWebhookEndpoint(storeId: string, endpointId: string, input: z.input<typeof updateSchema>): Promise<ActionResult> {
  return run(async () => {
    const bad = badIds(storeId, endpointId);
    if (bad) return bad;
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Formulaire invalide");
    const ctx = await requireStore(storeId, "integrations.manage");
    const ep = await updateEndpoint(actorOf(ctx), endpointId, parsed.data);
    revalidate(ctx.store.id);
    return success(undefined, parsed.data.active === undefined ? "Point de webhook mis à jour" : ep.active ? "Point de webhook activé" : "Point de webhook mis en pause");
  });
}

/** Suppression : possible même boutique suspendue (couper un flux sortant doit toujours rester possible). */
export async function deleteWebhookEndpoint(storeId: string, endpointId: string): Promise<ActionResult> {
  return run(async () => {
    const bad = badIds(storeId, endpointId);
    if (bad) return bad;
    const ctx = await loadStoreContext(storeId);
    if (!ctx) throw new AuthError("Boutique introuvable ou accès refusé");
    if (!ctx.user.emailVerified) throw new AuthError("Vérifiez d'abord votre adresse e-mail.", "UNAUTHENTICATED");
    if (!ctx.can("integrations.manage")) throw new AuthError("Votre rôle ne permet pas cette action");
    await deleteEndpoint(actorOf(ctx), endpointId);
    revalidate(ctx.store.id);
    return success(undefined, "Point de webhook supprimé");
  });
}

export async function rotateWebhookSecret(storeId: string, endpointId: string): Promise<ActionResult<CreatedWebhook & { previousValidUntil: string }>> {
  return run(async () => {
    const bad = badIds(storeId, endpointId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "integrations.manage");
    const r = await rotateEndpointSecret(actorOf(ctx), endpointId);
    revalidate(ctx.store.id);
    const warning = r.droppedOverlap
      ? " Attention : la rotation précédente datait de moins de 24 h — le secret d'avant, encore accepté par votre serveur, ne signe plus. Mettez à jour votre serveur avec ce nouveau secret."
      : "";
    return success({ id: endpointId, secret: r.secret, previousValidUntil: r.previousValidUntil }, `Nouveau secret généré.${warning}`);
  });
}

export async function sendWebhookTest(storeId: string, endpointId: string): Promise<ActionResult> {
  return run(async () => {
    const bad = badIds(storeId, endpointId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "integrations.manage");
    await sendTestEvent(actorOf(ctx), endpointId);
    revalidate(ctx.store.id);
    return success(undefined, "Événement de test programmé : il part dans quelques secondes");
  });
}

export async function replayWebhookDelivery(storeId: string, deliveryId: string): Promise<ActionResult> {
  return run(async () => {
    const bad = badIds(storeId, deliveryId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "integrations.manage");
    await replayDelivery(actorOf(ctx), deliveryId);
    revalidate(ctx.store.id);
    return success(undefined, "Livraison relancée");
  });
}

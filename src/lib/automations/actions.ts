"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zOptionalString, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { audit } from "@/lib/audit";
import { TRIGGERS, TRIGGER_META, type AutomationTrigger } from "./templates";
import { checkConfigForTrigger, configSchema, encodeConfig, getPreset, primaryChannel, MAX_DELAY_MINUTES, type AutomationConfig } from "./config";
import { activeAutomationLimit, automationLimitMessage, triggerAllowed } from "./limits";
import { simulate, type SimulationResult, type TriggerEvent } from "./engine";
import { lowStockItems, storeLowStockThreshold } from "@/lib/inventory/service";

/** Plafond technique du nombre total d'automatisations (actives ou non). */
const MAX_AUTOMATIONS = 30;

function gate(ctx: StoreContext) {
  if (!PLANS[ctx.planId].features.automations) {
    return fail(`Les automatisations sont incluses à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}). Changez de plan depuis la page Abonnement.`);
  }
  return null;
}

function triggerGate(ctx: StoreContext, trigger: AutomationTrigger) {
  if (!triggerAllowed(ctx.planId, trigger)) {
    return fail(`Le déclencheur « ${TRIGGER_META[trigger].label} » est inclus à partir du plan Scale (relance des paniers abandonnés).`, { trigger: ["Plan Scale requis"] });
  }
  return null;
}

/** Une automatisation de plus peut-elle être ACTIVE ? (limite du plan : 3 en Business, illimité en Scale) */
async function checkActiveLimit(ctx: StoreContext, excludeId?: string) {
  const limit = activeAutomationLimit(ctx.planId);
  if (limit == null) return null;
  const used = await db.automation.count({ where: { storeId: ctx.store.id, active: true, ...(excludeId ? { id: { not: excludeId } } : {}) } });
  if (used >= limit) return fail(automationLimitMessage(ctx.planId, used, limit));
  return null;
}

function parseConfig(raw: unknown): { config: AutomationConfig } | { error: ActionResult<never> } {
  let json: unknown;
  try {
    json = JSON.parse(String(raw ?? ""));
  } catch {
    return { error: fail("Configuration illisible. Rechargez la page.") };
  }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: fail(issue?.message ?? "Configuration invalide.") };
  }
  return { config: parsed.data };
}

const schema = z.object({
  storeId: z.string().min(8).max(64),
  id: zOptionalString,
  trigger: z.enum(TRIGGERS),
  delayMinutes: z.coerce.number().int().min(0, "0 minute minimum").max(MAX_DELAY_MINUTES, "14 jours maximum"),
  config: z.string().max(20_000),
  active: zBool,
});

export async function saveAutomation(_prev: ActionResult<{ id: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const parsed = parseForm(schema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "store.settings");
    const g = gate(ctx);
    if (g) return g;
    const pc = parseConfig(d.config);
    if ("error" in pc) return pc.error;
    const config = pc.config;
    const incoherent = checkConfigForTrigger(d.trigger, config);
    if (incoherent) return fail(incoherent);
    // Délai : uniquement pour les déclencheurs par événement.
    const delayMinutes = TRIGGER_META[d.trigger].kind === "event" ? d.delayMinutes : 0;

    const existing = d.id ? await db.automation.findFirst({ where: { id: d.id, storeId: ctx.store.id }, select: { id: true, active: true, trigger: true } }) : null;
    if (d.id && !existing) return fail("Automatisation introuvable.");
    if (!existing || existing.trigger !== d.trigger) {
      const tg = triggerGate(ctx, d.trigger);
      if (tg) return tg;
    }
    if (d.active && !existing?.active) {
      const lim = await checkActiveLimit(ctx, existing?.id);
      if (lim) return lim;
    }

    const data = { trigger: d.trigger, channel: primaryChannel(config), delayMinutes, template: encodeConfig(config), active: d.active };
    let id = existing?.id;
    if (existing) {
      await db.automation.updateMany({ where: { id: existing.id, storeId: ctx.store.id }, data });
    } else {
      const count = await db.automation.count({ where: { storeId: ctx.store.id } });
      if (count >= MAX_AUTOMATIONS) return fail(`Maximum ${MAX_AUTOMATIONS} automatisations par boutique.`);
      id = (await db.automation.create({ data: { ...data, storeId: ctx.store.id } })).id;
    }
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: existing ? "automation.updated" : "automation.created", target: id, metadata: { trigger: d.trigger, actions: config.actions.map((a) => a.type), active: d.active } });
    revalidatePath(`/app/${ctx.store.id}/automatisations`);
    return success({ id: id! }, existing ? "Automatisation mise à jour" : d.active ? "Automatisation créée et activée" : "Automatisation enregistrée, désactivée");
  });
}

export async function toggleAutomation(storeId: string, id: string, active: boolean): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    const automation = await db.automation.findFirst({ where: { id, storeId: ctx.store.id }, select: { id: true, active: true, trigger: true } });
    if (!automation) return fail("Automatisation introuvable.");
    // Désactiver reste toujours possible, même sans la fonctionnalité (ex. après un changement de plan).
    if (active && !automation.active) {
      const g = gate(ctx);
      if (g) return g;
      if ((TRIGGERS as readonly string[]).includes(automation.trigger)) {
        const tg = triggerGate(ctx, automation.trigger as AutomationTrigger);
        if (tg) return tg;
      }
      const lim = await checkActiveLimit(ctx, automation.id);
      if (lim) return lim;
    }
    await db.automation.updateMany({ where: { id: automation.id, storeId: ctx.store.id }, data: { active } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: active ? "automation.activated" : "automation.deactivated", target: automation.id });
    revalidatePath(`/app/${ctx.store.id}/automatisations`);
    return success(undefined, active ? "Automatisation activée" : "Automatisation désactivée");
  });
}

export async function deleteAutomation(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    const r = await db.automation.deleteMany({ where: { id, storeId: ctx.store.id } });
    if (r.count === 0) return fail("Automatisation introuvable.");
    // Exécutions programmées devenues orphelines
    await db.job.deleteMany({ where: { storeId: ctx.store.id, type: "automation.run", status: "PENDING", payload: { path: ["automationId"], equals: id } } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "automation.deleted", target: id });
    revalidatePath(`/app/${ctx.store.id}/automatisations`);
    return success(undefined, "Automatisation supprimée");
  });
}

/**
 * Modèle prêt en un clic : créé et ACTIVÉ si la limite du plan le permet, sinon créé désactivé
 * avec une explication. Le commerçant peut ensuite relire et ajuster le message.
 */
export async function createFromPreset(storeId: string, key: string): Promise<ActionResult<{ id: string; active: boolean }>> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    const g = gate(ctx);
    if (g) return g;
    const preset = getPreset(key);
    if (!preset) return fail("Modèle inconnu.");
    const tg = triggerGate(ctx, preset.trigger);
    if (tg) return tg;
    const count = await db.automation.count({ where: { storeId: ctx.store.id } });
    if (count >= MAX_AUTOMATIONS) return fail(`Maximum ${MAX_AUTOMATIONS} automatisations par boutique.`);
    const canActivate = (await checkActiveLimit(ctx)) == null;
    const created = await db.automation.create({
      data: { storeId: ctx.store.id, trigger: preset.trigger, channel: primaryChannel(preset.config), delayMinutes: preset.delayMinutes, template: encodeConfig(preset.config), active: canActivate },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "automation.created", target: created.id, metadata: { preset: key, active: canActivate } });
    revalidatePath(`/app/${ctx.store.id}/automatisations`);
    return success(
      { id: created.id, active: canActivate },
      canActivate ? `« ${preset.name} » est active.` : `« ${preset.name} » est ajoutée mais désactivée : limite d'automatisations actives de votre plan atteinte.`,
    );
  });
}

const simSchema = z.object({
  storeId: z.string().min(8).max(64),
  trigger: z.enum(TRIGGERS),
  config: z.string().max(20_000),
  orderId: z.string().min(8).max(64).nullable().optional(),
  automationId: z.string().min(8).max(64).nullable().optional(),
});

/**
 * Simulation sur une commande existante (ou le produit le plus bas en stock) : conditions, canaux
 * et messages rendus, SANS rien envoyer ni écrire.
 */
export async function simulateAutomation(input: z.input<typeof simSchema>): Promise<ActionResult<SimulationResult>> {
  return guard(async () => {
    const p = simSchema.safeParse(input);
    if (!p.success) return fail("Simulation impossible : paramètres invalides.");
    const d = p.data;
    const ctx = await requireStore(d.storeId, "store.settings");
    const pc = parseConfig(d.config);
    if ("error" in pc) return pc.error;
    const storeId = ctx.store.id;
    const meta = TRIGGER_META[d.trigger];

    let event: TriggerEvent = { storeId };
    if (meta.audience === "merchant") {
      // Article réellement en stock bas (seuil du produit, sinon de la boutique), sinon un produit quelconque.
      const [low] = await lowStockItems(storeId, { storeThreshold: await storeLowStockThreshold(storeId), scope: "active", limit: 1 });
      const product = low ? { id: low.productId } : await db.product.findFirst({ where: { storeId, status: "ACTIVE" }, orderBy: { stock: "asc" }, select: { id: true } });
      if (!product) return fail("Ajoutez un produit pour simuler cette automatisation.");
      event = { storeId, productId: product.id, variantId: low?.variantId ?? null };
    } else {
      const order = d.orderId
        ? await db.order.findFirst({ where: { id: d.orderId, storeId }, select: { id: true, customerId: true, customerPhone: true, customerName: true } })
        : await db.order.findFirst({ where: { storeId }, orderBy: { createdAt: "desc" }, select: { id: true, customerId: true, customerPhone: true, customerName: true } });
      if (!order) return fail("Aucune commande pour simuler. Passez une commande test depuis votre boutique.");
      if (d.trigger === "customer.inactive") event = { storeId, customerId: order.customerId, phone: order.customerPhone, name: order.customerName };
      else if (d.trigger === "cart.abandoned") {
        // Panier fictif : on simule avec le client de la commande, sans panier réel.
        event = { storeId, customerId: order.customerId, phone: order.customerPhone, name: order.customerName };
      } else event = { storeId, orderId: order.id, customerId: order.customerId };
    }
    const result = await simulate(storeId, d.trigger, pc.config, event, d.automationId ?? undefined);
    if (!result) return fail("Élément introuvable pour la simulation.");
    return success(result);
  });
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, type Capability } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";
import { parseMoneyInput } from "@/lib/money";
import { parseLoyaltyConfig, type LoyaltyConfig } from "./config";
import { adjustLoyalty } from "./service";

async function loyaltyContext(storeId: string, cap: Capability) {
  const ctx = await requireStore(storeId, cap);
  if (!PLANS[ctx.planId].features.loyalty) {
    return { ctx, error: fail(`Le programme de fidélité est inclus à partir du plan Business. Changez de plan : /app/${ctx.store.id}/abonnement`) };
  }
  return { ctx, error: null };
}

const configSchema = z.object({
  storeId: z.string().min(1),
  enabled: zBool,
  pointsPer1000: z.coerce.number({ message: "Nombre attendu" }).int("Nombre entier attendu").min(1, "1 point minimum").max(1000, "1 000 points maximum"),
  rewardPoints: z.coerce.number({ message: "Nombre attendu" }).int("Nombre entier attendu").min(1, "1 point minimum").max(1_000_000),
  rewardValue: z.string().trim().min(1, "Indiquez la valeur de la récompense"),
});

export async function saveLoyaltyConfig(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(configSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { ctx, error } = await loyaltyContext(parsed.data.storeId, "store.settings");
    if (error) return error;
    const rewardValue = parseMoneyInput(parsed.data.rewardValue, ctx.store.currency);
    if (rewardValue == null || rewardValue > 100_000_000) return fail("Montant invalide", { rewardValue: ["Montant invalide"] });
    const before = parseLoyaltyConfig(ctx.store.loyaltyConfig);
    const config: LoyaltyConfig = { enabled: parsed.data.enabled, pointsPer1000: parsed.data.pointsPer1000, rewardPoints: parsed.data.rewardPoints, rewardValue };
    await db.store.update({ where: { id: ctx.store.id }, data: { loyaltyConfig: config as unknown as Prisma.InputJsonValue } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "loyalty.config_updated", metadata: { before, after: config } });
    revalidatePath(`/app/${ctx.store.id}/fidelite`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(undefined, config.enabled ? "Programme de fidélité enregistré" : "Programme désactivé");
  });
}

const adjustSchema = z.object({
  storeId: z.string().min(1),
  customerId: z.string().min(1, "Choisissez un client"),
  kind: z.enum(["add", "remove", "reward"]),
  points: z.coerce.number({ message: "Nombre attendu" }).int("Nombre entier attendu").min(1, "1 point minimum").max(1_000_000),
  note: z.string().trim().min(3, "Indiquez le motif (3 caractères minimum)").max(200, "200 caractères maximum"),
});

export async function adjustLoyaltyPoints(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(adjustSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { ctx, error } = await loyaltyContext(parsed.data.storeId, "customers.manage");
    if (error) return error;
    const d = parsed.data;
    // Client d'une autre boutique (ou inexistant) : « introuvable », sans aucune écriture.
    const customer = await db.customer.findFirst({ where: { id: d.customerId, storeId: ctx.store.id }, select: { id: true } });
    if (!customer) return fail("Client introuvable.");
    const delta = d.kind === "add" ? d.points : -d.points;
    const result = await db.$transaction(async (tx) => {
      const r = await adjustLoyalty(tx, { storeId: ctx.store.id, customerId: d.customerId, delta, reason: d.kind === "reward" ? "reward" : "adjustment" });
      if (r.ok) {
        await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "loyalty.adjusted", target: d.customerId, metadata: { delta, kind: d.kind, note: d.note, balance: r.balance } }, tx);
      }
      return r;
    });
    if (!result.ok) return fail(`Solde insuffisant : ce client a ${result.balance} point${result.balance > 1 ? "s" : ""}.`, { points: ["Solde insuffisant"] });
    revalidatePath(`/app/${ctx.store.id}/fidelite`);
    revalidatePath(`/app/${ctx.store.id}/clients/${d.customerId}`);
    return success(undefined, d.kind === "reward" ? "Récompense enregistrée" : delta > 0 ? `${d.points} points ajoutés` : `${d.points} points retirés`);
  });
}

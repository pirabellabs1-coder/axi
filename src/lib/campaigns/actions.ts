"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zOptionalString, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";
import { CreditError } from "@/lib/inbox/service";
import { MAX_CAMPAIGN_MESSAGE } from "./segments";
import { executeCampaign } from "./service";

async function campaignContext(storeId: string) {
  const ctx = await requireStore(storeId, "customers.manage");
  if (!PLANS[ctx.planId].features.campaigns) {
    return { ctx, error: fail(`Les campagnes WhatsApp sont incluses à partir du plan Business. Changez de plan : /app/${ctx.store.id}/abonnement`) };
  }
  return { ctx, error: null };
}

function revalidate(storeId: string) {
  revalidatePath(`/app/${storeId}/campagnes`);
  revalidatePath(`/app/${storeId}/conversations`);
}

const schema = z
  .object({
    storeId: z.string().min(1),
    name: z.string().trim().min(2, "Donnez un nom à la campagne").max(80, "80 caractères maximum"),
    segmentKind: z.enum(["all", "loyal", "inactive", "new", "tag"], { message: "Choisissez une audience" }),
    tag: zOptionalString,
    message: z.string().trim().min(5, "Le message est trop court").max(MAX_CAMPAIGN_MESSAGE, `${MAX_CAMPAIGN_MESSAGE} caractères maximum`),
    intent: z.enum(["draft", "send", "schedule"]),
    scheduledAt: zOptionalString,
  })
  .superRefine((v, ctx) => {
    if (v.segmentKind === "tag" && !v.tag?.trim()) ctx.addIssue({ code: "custom", path: ["tag"], message: "Choisissez une étiquette" });
    if (v.intent === "schedule") {
      const d = v.scheduledAt ? new Date(v.scheduledAt) : null;
      if (!d || Number.isNaN(d.getTime())) ctx.addIssue({ code: "custom", path: ["scheduledAt"], message: "Choisissez une date d'envoi" });
      else if (d.getTime() < Date.now() + 5 * 60_000) ctx.addIssue({ code: "custom", path: ["scheduledAt"], message: "Choisissez une date au moins 5 minutes dans le futur" });
      else if (d.getTime() > Date.now() + 90 * 86_400_000) ctx.addIssue({ code: "custom", path: ["scheduledAt"], message: "90 jours maximum" });
    }
  });

export async function createCampaign(_prev: ActionResult<{ id: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return guard<{ id: string }>(async () => {
    const parsed = parseForm(schema, formData);
    if ("error" in parsed) return parsed.error;
    const { ctx, error } = await campaignContext(parsed.data.storeId);
    if (error) return error;
    const d = parsed.data;
    const segment: Prisma.InputJsonValue = d.segmentKind === "tag" ? { kind: "tag", tag: d.tag!.trim().toLowerCase() } : { kind: d.segmentKind };

    const campaign = await db.campaign.create({
      data: {
        storeId: ctx.store.id,
        name: d.name,
        message: d.message,
        segment,
        status: d.intent === "schedule" ? "SCHEDULED" : "DRAFT",
        scheduledAt: d.intent === "schedule" ? new Date(d.scheduledAt!) : null,
      },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: `campaign.${d.intent === "draft" ? "created" : d.intent === "schedule" ? "scheduled" : "sent"}`, target: campaign.id, metadata: { segment } });

    if (d.intent === "send") {
      try {
        const r = await executeCampaign(ctx.store.id, campaign.id, ctx.user.id);
        revalidate(ctx.store.id);
        return success(
          { id: campaign.id },
          r.mode === "api" ? `Campagne mise en file d'envoi pour ${r.recipients} client${r.recipients > 1 ? "s" : ""}` : `Campagne prête : ${r.recipients} message${r.recipients > 1 ? "s" : ""} à envoyer depuis WhatsApp`,
        );
      } catch (e) {
        revalidate(ctx.store.id);
        if (e instanceof CreditError) return fail(`${e.message} La campagne est enregistrée en brouillon.`);
        throw e;
      }
    }
    revalidate(ctx.store.id);
    return success({ id: campaign.id }, d.intent === "schedule" ? "Campagne planifiée" : "Brouillon enregistré");
  });
}

export async function sendCampaignNow(storeId: string, campaignId: string): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, error } = await campaignContext(storeId);
    if (error) return error;
    const c = await db.campaign.findFirst({ where: { id: campaignId, storeId: ctx.store.id, status: { in: ["DRAFT", "SCHEDULED"] } }, select: { id: true } });
    if (!c) return fail("Campagne introuvable ou déjà envoyée");
    try {
      const r = await executeCampaign(ctx.store.id, c.id, ctx.user.id);
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "campaign.sent", target: c.id, metadata: { recipients: r.recipients, mode: r.mode } });
      revalidate(ctx.store.id);
      return success(undefined, r.mode === "api" ? `Envoi lancé pour ${r.recipients} client${r.recipients > 1 ? "s" : ""}` : `${r.recipients} message${r.recipients > 1 ? "s" : ""} prêt${r.recipients > 1 ? "s" : ""} à envoyer depuis WhatsApp`);
    } catch (e) {
      if (e instanceof CreditError) return fail(e.message);
      throw e;
    }
  });
}

export async function cancelCampaign(storeId: string, campaignId: string): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, error } = await campaignContext(storeId);
    if (error) return error;
    const r = await db.campaign.updateMany({ where: { id: campaignId, storeId: ctx.store.id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
    if (r.count === 0) return fail("Seule une campagne planifiée peut être annulée");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "campaign.cancelled", target: campaignId });
    revalidate(ctx.store.id);
    return success(undefined, "Campagne annulée");
  });
}

export async function deleteCampaign(storeId: string, campaignId: string): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, error } = await campaignContext(storeId);
    if (error) return error;
    const r = await db.campaign.deleteMany({ where: { id: campaignId, storeId: ctx.store.id, status: { in: ["DRAFT", "CANCELLED"] } } });
    if (r.count === 0) return fail("Seuls les brouillons et campagnes annulées peuvent être supprimés");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "campaign.deleted", target: campaignId });
    revalidate(ctx.store.id);
    return success(undefined, "Campagne supprimée");
  });
}

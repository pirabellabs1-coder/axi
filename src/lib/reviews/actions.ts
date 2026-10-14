"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ReviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";

async function reviewContext(storeId: string) {
  const ctx = await requireStore(storeId, "customers.manage");
  if (!PLANS[ctx.planId].features.reviews) {
    return { ctx, error: fail(`Les avis clients sont inclus à partir du plan Business. Changez de plan : /app/${ctx.store.id}/abonnement`) };
  }
  return { ctx, error: null };
}

function revalidate(storeId: string, slug: string) {
  revalidatePath(`/app/${storeId}/avis`);
  revalidatePath(`/s/${slug}`, "layout");
}

export async function moderateReview(storeId: string, reviewId: string, status: ReviewStatus): Promise<ActionResult> {
  return guard(async () => {
    if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) return fail("Statut invalide");
    const { ctx, error } = await reviewContext(storeId);
    if (error) return error;
    const r = await db.review.updateMany({ where: { id: reviewId, storeId: ctx.store.id }, data: { status } });
    if (r.count === 0) return fail("Avis introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: `review.${status.toLowerCase()}`, target: reviewId });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, status === "APPROVED" ? "Avis publié" : status === "REJECTED" ? "Avis refusé" : "Avis remis en attente");
  });
}

const replySchema = z.object({
  storeId: z.string().min(1),
  reviewId: z.string().min(1),
  reply: z.string().trim().max(1000, "1 000 caractères maximum"),
});

export async function replyToReview(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(replySchema, formData);
    if ("error" in parsed) return parsed.error;
    const { ctx, error } = await reviewContext(parsed.data.storeId);
    if (error) return error;
    const reply = parsed.data.reply || null;
    const r = await db.review.updateMany({ where: { id: parsed.data.reviewId, storeId: ctx.store.id }, data: { reply } });
    if (r.count === 0) return fail("Avis introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: reply ? "review.replied" : "review.reply_removed", target: parsed.data.reviewId });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, reply ? "Réponse publiée" : "Réponse retirée");
  });
}

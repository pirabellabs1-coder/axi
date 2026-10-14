"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zRawId, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { clientIp, rateLimitAll } from "@/lib/rate-limit";
import { getCountry } from "@/config/site";
import { normalizePhone } from "@/lib/utils";
import { parseStreamUrl, reminderCampaignName, reminderTag, STREAM_PLATFORMS } from "./stream";

/**
 * Actions du live shopping (lot 4 §18).
 *  - Marchand : création, modification, épinglage, statut (capacité `theme.manage`, plan `liveShopping`).
 *  - Boutique (public) : « Me rappeler sur WhatsApp » — consentement marketing enregistré (`Consent`)
 *    et campagne de rappel programmée à l'heure du direct (mécanique existante `runDueCampaigns`,
 *    segment par étiquette : aucun nouveau type de job).
 */

const MAX_EVENTS = 100;

async function liveContext(storeId: string) {
  const ctx = await requireStore(storeId, "theme.manage");
  if (!PLANS[ctx.planId].features.liveShopping) {
    return { ctx, error: fail(`Le live shopping est inclus à partir du plan Scale. Changez de plan : /app/${ctx.store.id}/abonnement`) };
  }
  return { ctx, error: null };
}

const eventSchema = z.object({
  storeId: zRawId,
  eventId: z.string().regex(/^[A-Za-z0-9_-]{0,64}$/, "Identifiant invalide").optional(),
  title: z.string().trim().min(3, "Titre trop court").max(80, "80 caractères maximum"),
  startsAt: z.string().trim().min(10, "Date et heure requises").max(40),
  endsAt: z.string().trim().max(40).optional(),
  streamUrl: z.string().trim().max(500),
  productIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Identifiant invalide")).max(12, "12 produits maximum").optional(),
  pinnedId: z.string().regex(/^[A-Za-z0-9_-]{0,64}$/, "Identifiant invalide").optional(),
});

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Crée ou met à jour un direct. Les produits sont revérifiés : seuls les produits actifs de la boutique passent. */
export async function saveLiveEvent(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(eventSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { ctx, error } = await liveContext(parsed.data.storeId);
    if (error) return error;
    const storeId = ctx.store.id;

    const startsAt = parseDate(parsed.data.startsAt);
    if (!startsAt) return fail("Date et heure de début invalides", { startsAt: ["Date invalide"] });
    const endsAt = parseDate(parsed.data.endsAt);
    if (endsAt && endsAt <= startsAt) return fail("La fin doit suivre le début", { endsAt: ["La fin doit suivre le début"] });

    const stream = parseStreamUrl(parsed.data.streamUrl);
    if (!stream) return fail(`Lien de diffusion non reconnu. Plateformes acceptées : ${STREAM_PLATFORMS.join(", ")}.`, { streamUrl: ["Lien non reconnu"] });

    const wanted = [...new Set(parsed.data.productIds ?? [])].slice(0, 12);
    const products = wanted.length
      ? await db.product.findMany({ where: { storeId, id: { in: wanted }, status: "ACTIVE" }, select: { id: true } })
      : [];
    const productIds = wanted.filter((id) => products.some((p) => p.id === id));
    const pinnedId = parsed.data.pinnedId && productIds.includes(parsed.data.pinnedId) ? parsed.data.pinnedId : (productIds[0] ?? null);

    const data = { title: parsed.data.title, startsAt, endsAt, streamUrl: stream.url, productIds, pinnedId };
    if (parsed.data.eventId) {
      const updated = await db.liveEvent.updateMany({ where: { id: parsed.data.eventId, storeId }, data });
      if (updated.count === 0) return fail("Direct introuvable");
      await audit({ storeId, actorId: ctx.user.id, action: "live.updated", target: parsed.data.eventId, metadata: { products: productIds.length } });
    } else {
      if ((await db.liveEvent.count({ where: { storeId } })) >= MAX_EVENTS) return fail("Trop de directs enregistrés : supprimez les anciens.");
      const created = await db.liveEvent.create({ data: { ...data, storeId, createdById: ctx.user.id } });
      await audit({ storeId, actorId: ctx.user.id, action: "live.created", target: created.id, metadata: { products: productIds.length } });
    }
    revalidatePath(`/app/${storeId}/live`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(undefined, parsed.data.eventId ? "Direct enregistré." : "Direct programmé.");
  });
}

const statusSchema = z.enum(["SCHEDULED", "LIVE", "ENDED", "CANCELLED"]);

/** Change le statut d'un direct (démarrer, terminer, annuler). */
export async function setLiveEventStatus(storeId: string, eventId: string, status: z.infer<typeof statusSchema>): Promise<ActionResult> {
  return guard(async () => {
    if (!statusSchema.safeParse(status).success) return fail("Statut invalide");
    const { ctx, error } = await liveContext(storeId);
    if (error) return error;
    const res = await db.liveEvent.updateMany({ where: { id: eventId, storeId: ctx.store.id }, data: { status } });
    if (res.count === 0) return fail("Direct introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: `live.${status.toLowerCase()}`, target: eventId });
    revalidatePath(`/app/${ctx.store.id}/live`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    const labels: Record<string, string> = { SCHEDULED: "Direct reprogrammé.", LIVE: "Direct lancé : la boutique l'affiche.", ENDED: "Direct terminé.", CANCELLED: "Direct annulé." };
    return success(undefined, labels[status]);
  });
}

/** Produit épinglé (mis en avant pendant le direct) : repris par la boutique en 15 secondes au plus. */
export async function pinLiveProduct(storeId: string, eventId: string, productId: string | null): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, error } = await liveContext(storeId);
    if (error) return error;
    const event = await db.liveEvent.findFirst({ where: { id: eventId, storeId: ctx.store.id }, select: { productIds: true } });
    if (!event) return fail("Direct introuvable");
    if (productId && !event.productIds.includes(productId)) return fail("Ce produit n'est pas dans la liste du direct");
    await db.liveEvent.updateMany({ where: { id: eventId, storeId: ctx.store.id }, data: { pinnedId: productId } });
    revalidatePath(`/app/${ctx.store.id}/live`);
    return success(undefined, productId ? "Produit mis en avant." : "Mise en avant retirée.");
  });
}

export async function deleteLiveEvent(storeId: string, eventId: string): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, error } = await liveContext(storeId);
    if (error) return error;
    const res = await db.liveEvent.deleteMany({ where: { id: eventId, storeId: ctx.store.id } });
    if (res.count === 0) return fail("Direct introuvable");
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "live.deleted", target: eventId });
    revalidatePath(`/app/${ctx.store.id}/live`);
    return success(undefined, "Direct supprimé.");
  });
}

/* ───────────── Côté boutique : rappel WhatsApp ───────────── */

const reminderSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,48}$/),
  eventId: zRawId,
  name: z.string().trim().max(80).optional(),
  phone: z.string().trim().min(6).max(24),
  consent: zBool,
});

/**
 * « Me rappeler sur WhatsApp » : enregistre le client, son consentement marketing explicite, et le rattache
 * à la campagne de rappel programmée à l'heure du direct. Idempotent : deux demandes du même numéro ne
 * créent ni doublon de client ni doublon de campagne.
 */
export async function requestLiveReminder(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(reminderSchema, formData);
    if ("error" in parsed) return parsed.error;
    if (!parsed.data.consent) return fail("Cochez la case pour accepter de recevoir le rappel.", { consent: ["Consentement requis"] });

    const ip = await clientIp();
    const rl = await rateLimitAll([
      { key: `live:remind:ip:${ip}`, limit: 8, windowSec: 600 },
      { key: `live:remind:store:${parsed.data.slug}`, limit: 200, windowSec: 600 },
    ]);
    if (!rl.ok) return fail("Trop de demandes. Réessayez dans quelques minutes.");

    const store = await db.store.findFirst({
      where: { slug: parsed.data.slug, status: { in: ["PUBLISHED", "CLOSED_TEMPORARILY"] } },
      select: { id: true, slug: true, name: true, country: true, subscription: true },
    });
    if (!store) return fail("Boutique introuvable");
    if (!PLANS[effectivePlanId(store.subscription)].features.liveShopping) return fail("Les rappels ne sont pas disponibles sur cette boutique.");

    const event = await db.liveEvent.findFirst({
      where: { id: parsed.data.eventId, storeId: store.id, status: { in: ["SCHEDULED", "LIVE"] } },
      select: { id: true, title: true, startsAt: true },
    });
    if (!event) return fail("Ce direct n'est plus annoncé.");

    const phone = normalizePhone(parsed.data.phone, getCountry(store.country).dialCode);
    if (!phone) return fail("Numéro WhatsApp invalide", { phone: ["Numéro invalide"] });

    const tag = reminderTag(event.id);
    const name = parsed.data.name?.trim() || "Client";

    await db.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({ where: { storeId: store.id, phone }, select: { id: true, tags: true } });
      const customerId = existing
        ? existing.id
        : (await tx.customer.create({ data: { storeId: store.id, name, phone, tags: [tag] }, select: { id: true } })).id;
      if (existing && !existing.tags.includes(tag)) {
        await tx.customer.update({ where: { id: existing.id }, data: { tags: { set: [...existing.tags, tag].slice(0, 30) } } });
      }
      // Consentement explicite, journalisé à chaque demande (le dernier l'emporte).
      await tx.consent.create({ data: { customerId, channel: "WHATSAPP", purpose: "MARKETING", granted: true, source: "live_reminder" } });

      const campaignName = reminderCampaignName(event.id);
      const campaign = await tx.campaign.findFirst({ where: { storeId: store.id, name: campaignName, channel: "whatsapp" }, select: { id: true, status: true } });
      if (!campaign) {
        await tx.campaign.create({
          data: {
            storeId: store.id,
            name: campaignName,
            channel: "whatsapp",
            segment: { kind: "tag", tag } as Prisma.InputJsonValue,
            message: `Bonjour {prenom}, le direct « ${event.title} » commence maintenant sur ${store.name}. À tout de suite !`,
            status: "SCHEDULED",
            scheduledAt: event.startsAt,
          },
        });
      }
    });

    return success(undefined, "C'est noté : vous recevrez un message WhatsApp au début du direct.");
  });
}

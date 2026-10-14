"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, type StoreContext } from "@/lib/auth/permissions";
import { badIds, fail, guard, parseForm, success, zBool, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { occasionById } from "@/config/occasions";
import { MAX_DOCUMENT_BYTES, validateThemeDocument } from "@/lib/theme-engine/validate";
import { editorDocument, publishedDocument } from "@/lib/theme/bootstrap";
import { lot4PlanIssue } from "@/lib/theme/editor-plan";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { applyOccasion } from "./occasion-doc";
import { boundsIssue, localDateTimeToUtc } from "./rules";
import { countActiveSchedules, overlappingSchedule, scheduleAllowance, SCHEDULES_UPSELL } from "./service";

/**
 * Lot 4 §11 : actions des thèmes programmés.
 * Garanties : capacité `theme.manage`, filtre `storeId` systématique, document revalidé (`validateThemeDocument` +
 * contrôle de plan lot 4), chevauchements refusés sous verrou consultatif, `audit()` et `enqueue()` dans la MÊME
 * transaction que l'écriture (jobs `theme.schedule_notify` planifiés au début et à la fin).
 */

const SOURCES = ["published", "draft"] as const;

const createSchema = z.object({
  storeId: z.string().min(8).max(64),
  name: z.string().trim().min(2, "Donnez un nom à la programmation.").max(60),
  occasion: z.preprocess((v) => (v === "" || v === "aucune" ? undefined : v), z.string().max(40).optional()),
  startsAt: z.string().min(10).max(32),
  endsAt: z.string().min(10).max(32),
  source: z.preprocess((v) => (v === "" ? undefined : v), z.enum(SOURCES).default("published")),
  banner: zBool,
  countdown: zBool,
});

const editSchema = z.object({
  storeId: z.string().min(8).max(64),
  scheduleId: z.string().min(8).max(64),
  name: z.string().trim().min(2, "Donnez un nom à la programmation.").max(60),
  startsAt: z.string().min(10).max(32),
  endsAt: z.string().min(10).max(32),
});

function revalidate(storeId: string, slug: string) {
  revalidatePath(`/app/${storeId}/apparence/programmations`);
  revalidatePath(`/s/${slug}`, "layout");
}

/** Document de départ : thème publié (défaut) ou brouillon en cours. */
function baseDocument(ctx: StoreContext, source: "published" | "draft"): ThemeDocument {
  if (source === "draft") return editorDocument(ctx.store).doc;
  return publishedDocument(ctx.store) ?? editorDocument(ctx.store).doc;
}

/** Valide le document programmé (schéma du moteur + règles de plan lot 4) et renvoie la valeur JSON à stocker. */
function checkedDocument(ctx: StoreContext, doc: ThemeDocument): { json: Prisma.InputJsonValue } | { error: ActionResult<never> } {
  const v = validateThemeDocument(doc);
  if (!v.ok) return { error: fail(v.errors[0]?.message ?? "Thème programmé invalide.") };
  const planIssue = lot4PlanIssue(ctx.planId, v.doc, [publishedDocument(ctx.store), editorDocument(ctx.store).doc]);
  if (planIssue) return { error: fail(planIssue) };
  const json = JSON.stringify(v.doc);
  if (json.length > MAX_DOCUMENT_BYTES) return { error: fail("Le thème est trop volumineux pour être programmé.") };
  return { json: v.doc as unknown as Prisma.InputJsonValue };
}

/** Jobs de notification (début et fin) : informatifs, le rendu n'en dépend pas. */
async function enqueueNotices(tx: Parameters<typeof enqueue>[3], scheduleId: string, storeId: string, startsAt: Date, endsAt: Date) {
  await enqueue("theme.schedule_notify", { scheduleId, edge: "start" }, { storeId, runAt: startsAt }, tx);
  await enqueue("theme.schedule_notify", { scheduleId, edge: "end" }, { storeId, runAt: endsAt }, tx);
}

/* ───────────── Création ───────────── */

export async function createThemeSchedule(_prev: ActionResult<{ id: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const parsed = parseForm(createSchema, formData);
    if ("error" in parsed) return parsed.error;
    const input = parsed.data;
    const ctx = await requireStore(input.storeId, "theme.manage");
    const store = ctx.store;
    const now = new Date();

    const allowance = scheduleAllowance(ctx.planId);
    if (allowance === 0) return fail(SCHEDULES_UPSELL);

    const startsAt = localDateTimeToUtc(input.startsAt, store.timezone);
    const endsAt = localDateTimeToUtc(input.endsAt, store.timezone);
    if (!startsAt || !endsAt) return fail("Dates invalides.", { startsAt: ["Date ou heure invalide."] });
    const issue = boundsIssue({ startsAt, endsAt }, now);
    if (issue) return fail(issue, { endsAt: [issue] });

    if (allowance != null) {
      const used = await countActiveSchedules(store.id, now);
      if (used >= allowance) return fail(`Votre plan permet ${allowance} programmation${allowance > 1 ? "s" : ""} à venir. Annulez-en une ou passez au plan supérieur.`);
    }

    const occasion = occasionById(input.occasion);
    if (input.occasion && !occasion) return fail("Occasion inconnue.", { occasion: ["Occasion inconnue."] });

    let doc = baseDocument(ctx, input.source);
    if (occasion) doc = applyOccasion(doc, occasion, { endsAt, timeZone: store.timezone, banner: input.banner, countdown: input.countdown });
    const checked = checkedDocument(ctx, doc);
    if ("error" in checked) return checked.error;

    const created: { clash?: { id: string; name: string }; id?: string } = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`theme-schedule:${store.id}`}))`;
      const clash = await overlappingSchedule(tx, store.id, { startsAt, endsAt });
      if (clash) return { clash };
      const row = await tx.themeSchedule.create({
        data: {
          storeId: store.id,
          name: input.name,
          occasion: occasion?.id ?? null,
          document: checked.json,
          startsAt,
          endsAt,
          status: "SCHEDULED",
          createdById: ctx.user.id,
        },
        select: { id: true },
      });
      await enqueueNotices(tx, row.id, store.id, startsAt, endsAt);
      await audit({ storeId: store.id, actorId: ctx.user.id, action: "theme.schedule.create", target: row.id, metadata: { name: input.name, occasion: occasion?.id ?? null, startsAt, endsAt } }, tx);
      return { id: row.id };
    });
    if (created.clash) return fail(`« ${created.clash.name} » occupe déjà cette période. Les programmations ne peuvent pas se chevaucher.`);
    if (!created.id) return fail("Programmation non enregistrée. Réessayez.");

    revalidate(store.id, store.slug);
    return success({ id: created.id }, "Programmation enregistrée.");
  });
}

/* ───────────── Modification des dates et du nom ───────────── */

export async function updateThemeSchedule(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(editSchema, formData);
    if ("error" in parsed) return parsed.error;
    const input = parsed.data;
    const ctx = await requireStore(input.storeId, "theme.manage");
    const store = ctx.store;
    const now = new Date();

    const existing = await db.themeSchedule.findFirst({ where: { id: input.scheduleId, storeId: store.id }, select: { id: true, status: true } });
    if (!existing) return fail("Programmation introuvable.");
    if (existing.status === "CANCELLED") return fail("Cette programmation est annulée.");
    if (existing.status === "COMPLETED") return fail("Cette programmation est terminée.");

    const startsAt = localDateTimeToUtc(input.startsAt, store.timezone);
    const endsAt = localDateTimeToUtc(input.endsAt, store.timezone);
    if (!startsAt || !endsAt) return fail("Dates invalides.", { startsAt: ["Date ou heure invalide."] });
    const issue = boundsIssue({ startsAt, endsAt }, now);
    if (issue) return fail(issue, { endsAt: [issue] });

    const result: { clash?: { id: string; name: string } } = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`theme-schedule:${store.id}`}))`;
      const clash = await overlappingSchedule(tx, store.id, { startsAt, endsAt }, existing.id);
      if (clash) return { clash };
      await tx.themeSchedule.update({
        where: { id: existing.id },
        data: { name: input.name, startsAt, endsAt, status: startsAt.getTime() <= now.getTime() ? "ACTIVE" : "SCHEDULED" },
      });
      await enqueueNotices(tx, existing.id, store.id, startsAt, endsAt);
      await audit({ storeId: store.id, actorId: ctx.user.id, action: "theme.schedule.update", target: existing.id, metadata: { name: input.name, startsAt, endsAt } }, tx);
      return {};
    });
    if (result.clash) return fail(`« ${result.clash.name} » occupe déjà cette période. Les programmations ne peuvent pas se chevaucher.`);

    revalidate(store.id, store.slug);
    return success(undefined, "Programmation mise à jour.");
  });
}

/* ───────────── Annulation et suppression ───────────── */

export async function cancelThemeSchedule(storeId: string, scheduleId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, scheduleId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "theme.manage");
    const row = await db.themeSchedule.findFirst({ where: { id: scheduleId, storeId: ctx.store.id }, select: { id: true, name: true, status: true } });
    if (!row) return fail("Programmation introuvable.");
    if (row.status === "CANCELLED") return success(undefined, "Déjà annulée.");

    await db.$transaction(async (tx) => {
      await tx.themeSchedule.update({ where: { id: row.id }, data: { status: "CANCELLED" } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.schedule.cancel", target: row.id, metadata: { name: row.name } }, tx);
    });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Programmation annulée : la boutique revient au thème normal.");
  });
}

export async function deleteThemeSchedule(storeId: string, scheduleId: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, scheduleId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "theme.manage");
    const row = await db.themeSchedule.findFirst({ where: { id: scheduleId, storeId: ctx.store.id }, select: { id: true, name: true } });
    if (!row) return fail("Programmation introuvable.");

    await db.$transaction(async (tx) => {
      await tx.themeSchedule.deleteMany({ where: { id: row.id, storeId: ctx.store.id } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "theme.schedule.delete", target: row.id, metadata: { name: row.name } }, tx);
    });
    revalidate(ctx.store.id, ctx.store.slug);
    return success(undefined, "Programmation supprimée.");
  });
}

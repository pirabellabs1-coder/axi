"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { guard, fail, success, type ActionResult } from "@/lib/action";
import { REPORT_STATUSES } from "@/lib/reports/constants";
import { requireAdminPermission } from "./context";
import { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_TONES } from "./announcements";
import { SETTING_KEYS } from "./settings";

/** Modération (signalements), annonces et paramètres plateforme. */

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of error.issues) (out[String(i.path[0] ?? "form")] ??= []).push(i.message);
  return out;
}

// ─────────────────────────── Signalements ───────────────────────────

const zResolution = z.string().trim().max(500, "500 caractères maximum").optional();

function revalidateReports(storeId?: string) {
  revalidatePath("/admin/signalements");
  revalidatePath("/admin", "layout");
  if (storeId) revalidatePath(`/admin/boutiques/${storeId}`);
}

export async function setReportStatus(reportId: string, status: string, resolution?: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("stores.moderate");
    const parsed = z.object({ status: z.enum(REPORT_STATUSES), resolution: zResolution }).safeParse({ status, resolution });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const report = await db.storeReport.findUnique({ where: { id: reportId } });
    if (!report) return fail("Signalement introuvable");
    await db.$transaction(async (tx) => {
      await tx.storeReport.update({ where: { id: reportId }, data: { status: parsed.data.status, resolution: parsed.data.resolution || report.resolution } });
      await audit({ storeId: report.storeId, actorId: user.id, action: "admin.report.status_changed", target: reportId, metadata: { from: report.status, to: parsed.data.status, resolution: parsed.data.resolution ?? null } }, tx);
    });
    revalidateReports(report.storeId);
    return success(undefined, "Signalement mis à jour");
  });
}

/**
 * Décision rapide sur un signalement :
 *  - suspend : boutique suspendue (motif = résolution), signalement traité ;
 *  - unlist  : retirée de la marketplace (marketplaceBlocked, le marchand ne peut pas la relister) ;
 *  - dismiss : signalement rejeté, aucune action sur la boutique.
 * Les autres signalements ouverts de la même boutique sont clos avec la même décision.
 */
export async function resolveReport(reportId: string, decision: "suspend" | "unlist" | "dismiss", resolution: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("stores.moderate");
    const parsed = z
      .object({ decision: z.enum(["suspend", "unlist", "dismiss"]), resolution: z.string().trim().min(5, "Motif trop court (5 caractères minimum)").max(500) })
      .safeParse({ decision, resolution });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides", fieldErrorsOf(parsed.error));
    const report = await db.storeReport.findUnique({ where: { id: reportId } });
    if (!report) return fail("Signalement introuvable");
    const store = await db.store.findUnique({ where: { id: report.storeId }, select: { id: true, status: true, name: true } });
    if (!store) return fail("Boutique introuvable");
    const { decision: d, resolution: why } = parsed.data;
    const closed = await db.$transaction(async (tx) => {
      if (d === "suspend" && store.status !== "SUSPENDED") {
        await tx.store.update({ where: { id: store.id }, data: { status: "SUSPENDED", statusReason: why } });
        await audit({ storeId: store.id, actorId: user.id, action: "admin.store.suspended", target: store.id, metadata: { reason: why, previousStatus: store.status, reportId } }, tx);
      }
      if (d === "unlist") {
        await tx.store.update({ where: { id: store.id }, data: { listedInMarketplace: false, marketplaceBlocked: true } });
        await audit({ storeId: store.id, actorId: user.id, action: "admin.store.listed_toggled", target: store.id, metadata: { listedInMarketplace: false, marketplaceBlocked: true, reportId } }, tx);
      }
      const status = d === "dismiss" ? "DISMISSED" : "RESOLVED";
      const label = d === "suspend" ? "Boutique suspendue" : d === "unlist" ? "Retirée de la marketplace" : "Rejeté";
      const { count } = await tx.storeReport.updateMany({ where: { storeId: store.id, status: { in: ["OPEN", "REVIEWING"] } }, data: { status, resolution: `${label} : ${why}` } });
      if (count === 0) await tx.storeReport.update({ where: { id: reportId }, data: { status, resolution: `${label} : ${why}` } });
      await audit({ storeId: store.id, actorId: user.id, action: "admin.report.resolved", target: reportId, metadata: { decision: d, resolution: why, closed: Math.max(1, count) } }, tx);
      return Math.max(1, count);
    });
    revalidateReports(store.id);
    revalidatePath("/marketplace");
    const what = d === "suspend" ? `${store.name} suspendue` : d === "unlist" ? `${store.name} retirée de la marketplace` : "Signalement rejeté";
    return success(undefined, closed > 1 ? `${what}, ${closed} signalements clos` : what);
  });
}

// ─────────────────────────── Annonces ───────────────────────────

const announcementSchema = z
  .object({
    title: z.string().trim().min(3, "Titre trop court").max(90, "90 caractères maximum"),
    body: z.string().trim().min(5, "Texte trop court").max(400, "400 caractères maximum"),
    tone: z.enum(ANNOUNCEMENT_TONES),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    startsAt: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional()),
    endsAt: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable()),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.endsAt && v.startsAt && v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "La fin doit suivre le début" });
  });

export type AnnouncementInput = z.input<typeof announcementSchema>;

function revalidateAnnouncements() {
  revalidatePath("/admin/annonces");
  revalidatePath("/app", "layout");
}

export async function saveAnnouncement(id: string | null, input: AnnouncementInput): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("announcements.manage");
    const parsed = announcementSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides", fieldErrorsOf(parsed.error));
    const v = parsed.data;
    const data = { title: v.title, body: v.body, tone: v.tone, audience: v.audience, startsAt: v.startsAt ?? new Date(), endsAt: v.endsAt, active: v.active };
    if (id) {
      const existing = await db.announcement.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return fail("Annonce introuvable");
      await db.$transaction(async (tx) => {
        await tx.announcement.update({ where: { id }, data });
        await audit({ actorId: user.id, action: "admin.announcement.updated", target: id, metadata: { title: v.title, audience: v.audience } }, tx);
      });
    } else {
      await db.$transaction(async (tx) => {
        const a = await tx.announcement.create({ data });
        await audit({ actorId: user.id, action: "admin.announcement.created", target: a.id, metadata: { title: v.title, audience: v.audience } }, tx);
      });
    }
    revalidateAnnouncements();
    return success(undefined, id ? "Annonce mise à jour" : "Annonce publiée");
  });
}

export async function toggleAnnouncement(id: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("announcements.manage");
    const a = await db.announcement.findUnique({ where: { id } });
    if (!a) return fail("Annonce introuvable");
    await db.$transaction(async (tx) => {
      await tx.announcement.update({ where: { id }, data: { active: !a.active } });
      await audit({ actorId: user.id, action: a.active ? "admin.announcement.paused" : "admin.announcement.resumed", target: id, metadata: { title: a.title } }, tx);
    });
    revalidateAnnouncements();
    return success(undefined, a.active ? "Annonce mise en pause" : "Annonce réactivée");
  });
}

export async function deleteAnnouncement(id: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("announcements.manage");
    const a = await db.announcement.findUnique({ where: { id } });
    if (!a) return fail("Annonce introuvable");
    await db.$transaction(async (tx) => {
      await tx.announcement.delete({ where: { id } });
      await audit({ actorId: user.id, action: "admin.announcement.deleted", target: id, metadata: { title: a.title } }, tx);
    });
    revalidateAnnouncements();
    return success(undefined, "Annonce supprimée");
  });
}

// ─────────────────────────── Paramètres ───────────────────────────

export async function setMarketplaceMaintenance(enabled: boolean, message: string): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    const parsed = z.object({ enabled: z.boolean(), message: z.string().trim().max(240, "240 caractères maximum") }).safeParse({ enabled, message });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    await db.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: SETTING_KEYS.maintenance },
        create: { key: SETTING_KEYS.maintenance, value: parsed.data, updatedBy: user.id },
        update: { value: parsed.data, updatedBy: user.id },
      });
      await audit({ actorId: user.id, action: "admin.settings.maintenance", metadata: parsed.data }, tx);
    });
    revalidatePath("/admin/parametres");
    revalidatePath("/marketplace");
    return success(undefined, parsed.data.enabled ? "Marketplace en maintenance" : "Marketplace rouverte");
  });
}

const manualSchema = z.object({
  momoNumber: z.string().trim().max(30).regex(/^[+\d\s]*$/, "Numéro : chiffres, espaces et + uniquement"),
  momoName: z.string().trim().max(80),
  bankDetails: z.string().trim().max(400),
  instructions: z.string().trim().max(400),
});

export async function saveManualPayment(input: z.input<typeof manualSchema>): Promise<ActionResult> {
  return guard(async () => {
    const { user } = await requireAdminPermission("settings.manage");
    const parsed = manualSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides", fieldErrorsOf(parsed.error));
    await db.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: SETTING_KEYS.manualPayment },
        create: { key: SETTING_KEYS.manualPayment, value: parsed.data, updatedBy: user.id },
        update: { value: parsed.data, updatedBy: user.id },
      });
      await audit({ actorId: user.id, action: "admin.settings.manual_payment", metadata: { momoNumber: parsed.data.momoNumber ? "défini" : "vide", bankDetails: parsed.data.bankDetails ? "défini" : "vide" } }, tx);
    });
    revalidatePath("/admin/parametres");
    return success(undefined, "Coordonnées de paiement enregistrées");
  });
}

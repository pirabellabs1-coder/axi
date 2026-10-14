import "server-only";
import { cache } from "react";
import { db, type Tx } from "@/lib/db";
import { PLANS, type PlanId } from "@/config/plans";
import { validateThemeDocument } from "@/lib/theme-engine/validate";
import type { ThemeDocument } from "@/lib/theme-engine/types";
import { countsTowardLimit, isActiveAt, overlaps, pickActive, type ScheduleStatus } from "./rules";

/**
 * Lot 4 §11 : résolution des thèmes programmés AU RENDU, sans cron.
 *
 * `scheduledThemeAt(storeId, at)` renvoie la programmation qui prend la main à cet instant (`startsAt ≤ at < endsAt`,
 * statut autre qu'annulé) et son document revalidé. Le retour au thème normal est donc exact à la seconde et ne
 * dépend d'aucune écriture : le job `theme.schedule_notify` ne fait que prévenir le commerçant et tenir le statut à jour.
 *
 * Un document invalide (thème devenu incompatible) est ignoré : la boutique reste sur son thème normal.
 */

export type ActiveSchedule = { id: string; name: string; occasion: string | null; startsAt: Date; endsAt: Date; doc: ThemeDocument };

const SELECT = { id: true, name: true, occasion: true, document: true, startsAt: true, endsAt: true, status: true } as const;

/** Mémorisé pour la durée de la requête : la mise en page et la page appellent la même résolution. */
const loadAt = cache(async (storeId: string, atMs: number) => {
  const at = new Date(atMs);
  return db.themeSchedule.findMany({
    where: { storeId, status: { not: "CANCELLED" }, startsAt: { lte: at }, endsAt: { gt: at } },
    orderBy: { startsAt: "desc" },
    take: 3,
    select: SELECT,
  });
});

export async function scheduledThemeAt(storeId: string, at: Date): Promise<ActiveSchedule | null> {
  let rows: Awaited<ReturnType<typeof loadAt>>;
  try {
    rows = await loadAt(storeId, at.getTime());
  } catch {
    return null; // la boutique ne doit jamais tomber à cause d'une programmation
  }
  const row = pickActive(
    rows.map((r) => ({ ...r, status: r.status as ScheduleStatus })),
    at,
  );
  if (!row) return null;
  const v = validateThemeDocument(row.document);
  if (!v.ok) return null;
  return { id: row.id, name: row.name, occasion: row.occasion, startsAt: row.startsAt, endsAt: row.endsAt, doc: v.doc };
}

/** Aperçu « voir à la date » : réservé aux membres (vérifié par l'appelant). `at` au format ISO ou `datetime-local`. */
export function parsePreviewAt(raw: string | string[] | undefined): Date | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || v.length < 10 || v.length > 40) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return null;
  // Garde-fou : ±5 ans autour de maintenant.
  const delta = Math.abs(d.getTime() - Date.now());
  return delta > 5 * 365 * 86_400_000 ? null : d;
}

/* ───────────── Administration (écran des programmations) ───────────── */

export type ScheduleRow = {
  id: string;
  name: string;
  occasion: string | null;
  startsAt: Date;
  endsAt: Date;
  status: ScheduleStatus;
  createdAt: Date;
};

export async function listSchedules(storeId: string, take = 100): Promise<ScheduleRow[]> {
  const rows = await db.themeSchedule.findMany({
    where: { storeId },
    orderBy: [{ startsAt: "desc" }],
    take,
    select: { id: true, name: true, occasion: true, startsAt: true, endsAt: true, status: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, status: r.status as ScheduleStatus }));
}

/** Limite de plan : nombre de programmations à venir ou en cours (null = illimité, 0 = non inclus). */
export function scheduleAllowance(planId: PlanId): number | null {
  const p = PLANS[planId];
  return p.features.scheduledThemes ? p.limits.scheduledThemes : 0;
}

export const SCHEDULES_UPSELL = "Les thèmes programmés sont inclus à partir du plan Business.";

/** Nombre de programmations qui comptent dans la limite (à venir ou en cours). */
export async function countActiveSchedules(storeId: string, now: Date, exceptId?: string): Promise<number> {
  const rows = await db.themeSchedule.findMany({
    where: { storeId, status: { not: "CANCELLED" }, endsAt: { gt: now }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { startsAt: true, endsAt: true, status: true },
  });
  return rows.filter((r) => countsTowardLimit({ ...r, status: r.status as ScheduleStatus }, now)).length;
}

/**
 * Chevauchement interdit : une seule programmation vivante par instant.
 * Vérifié SOUS VERROU consultatif (`pg_advisory_xact_lock` sur la boutique) par l'action, dans la même transaction
 * que l'écriture ; deux créations simultanées ne peuvent donc pas se croiser.
 */
export async function overlappingSchedule(
  client: Tx | typeof db,
  storeId: string,
  bounds: { startsAt: Date; endsAt: Date },
  exceptId?: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await client.themeSchedule.findMany({
    where: {
      storeId,
      status: { not: "CANCELLED" },
      startsAt: { lt: bounds.endsAt },
      endsAt: { gt: bounds.startsAt },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, name: true, startsAt: true, endsAt: true, status: true },
    take: 5,
  });
  const hit = rows.find((r) => overlaps({ startsAt: r.startsAt, endsAt: r.endsAt }, bounds));
  return hit ? { id: hit.id, name: hit.name } : null;
}

export { isActiveAt };

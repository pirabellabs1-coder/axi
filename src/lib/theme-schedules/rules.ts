/**
 * Lot 4 §11 : règles PURES des thèmes programmés (aucun accès base, aucune horloge implicite).
 *
 * Bornes : une programmation est active quand `startsAt ≤ now < endsAt` (début inclus, fin exclue : le retour au
 * thème normal est exact à la seconde). Les instants sont stockés en UTC ; le commerçant les saisit dans le fuseau
 * de sa boutique (`localDateTimeToUtc`).
 */

export type ScheduleStatus = "SCHEDULED" | "ACTIVE" | "COMPLETED" | "CANCELLED";

/** Statuts qui peuvent prendre la main au rendu (les autres sont inertes). */
export const LIVE_STATUSES: ScheduleStatus[] = ["SCHEDULED", "ACTIVE"];

export type ScheduleBounds = { startsAt: Date; endsAt: Date };

/** Durée maximale d'une programmation : 180 jours (garde-fou, évite un thème « programmé » permanent). */
export const MAX_SCHEDULE_DAYS = 180;
/** Durée minimale : 5 minutes. */
export const MIN_SCHEDULE_MINUTES = 5;

/* ───────────── Fuseau ───────────── */

/** Décalage (minutes) du fuseau par rapport à UTC à l'instant `d` (heure locale − UTC) ; 0 si fuseau inconnu. */
export function timeZoneOffsetMinutes(d: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
    return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
  } catch {
    return 0; // fuseau inconnu : traité comme UTC
  }
}

/**
 * « AAAA-MM-JJTHH:MM » saisi dans le fuseau de la boutique → instant UTC. `null` si la forme est invalide.
 * Deux passes : le décalage est recalculé sur l'instant candidat (correct même avec changement d'heure).
 */
export function localDateTimeToUtc(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!Number.isFinite(naive)) return null;
  const first = new Date(naive - timeZoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  const exact = new Date(naive - timeZoneOffsetMinutes(first, timeZone) * 60_000);
  return Number.isFinite(exact.getTime()) ? exact : null;
}

/** Instant UTC → « AAAA-MM-JJTHH:MM » dans le fuseau de la boutique (valeur d'un champ `datetime-local`). */
export function utcToLocalInput(d: Date, timeZone: string): string {
  const shifted = new Date(d.getTime() + timeZoneOffsetMinutes(d, timeZone) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** « AAAA-MM-JJ » du jour dans le fuseau de la boutique. */
export function localDay(d: Date, timeZone: string): string {
  const shifted = new Date(d.getTime() + timeZoneOffsetMinutes(d, timeZone) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/* ───────────── Bornes et chevauchements ───────────── */

/** Active à cet instant : `startsAt ≤ at < endsAt` (exact à la seconde, aucune tolérance). */
export function isActiveAt(b: ScheduleBounds, at: Date): boolean {
  return b.startsAt.getTime() <= at.getTime() && at.getTime() < b.endsAt.getTime();
}

/** Deux intervalles semi-ouverts [start, end) se chevauchent-ils ? (fin == début : pas de chevauchement). */
export function overlaps(a: ScheduleBounds, b: ScheduleBounds): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/** Message d'erreur si les bornes sont invalides, sinon null. */
export function boundsIssue(b: ScheduleBounds, now: Date): string | null {
  const start = b.startsAt.getTime();
  const end = b.endsAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Dates invalides.";
  if (end <= start) return "La fin doit être après le début.";
  if (end - start < MIN_SCHEDULE_MINUTES * 60_000) return `Une programmation dure au moins ${MIN_SCHEDULE_MINUTES} minutes.`;
  if (end - start > MAX_SCHEDULE_DAYS * 86_400_000) return `Une programmation dure au plus ${MAX_SCHEDULE_DAYS} jours.`;
  if (end <= now.getTime()) return "Cette période est déjà passée.";
  return null;
}

/** Statut affiché (dérivé de l'horloge : le statut en base n'est qu'informatif). */
export function effectiveStatus(row: ScheduleBounds & { status: ScheduleStatus }, now: Date): ScheduleStatus {
  if (row.status === "CANCELLED") return "CANCELLED";
  if (isActiveAt(row, now)) return "ACTIVE";
  return now.getTime() >= row.endsAt.getTime() ? "COMPLETED" : "SCHEDULED";
}

export const STATUS_LABELS: Record<ScheduleStatus, string> = {
  SCHEDULED: "Programmé",
  ACTIVE: "En cours",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
};

export const STATUS_TONES: Record<ScheduleStatus, "info" | "success" | "neutral" | "warning"> = {
  SCHEDULED: "info",
  ACTIVE: "success",
  COMPLETED: "neutral",
  CANCELLED: "warning",
};

/**
 * Programmation qui prend la main à `at` parmi des lignes déjà filtrées sur la boutique.
 * Chevauchement impossible par construction ; en cas de données anciennes incohérentes, la plus récemment
 * commencée gagne (comportement déterministe).
 */
export function pickActive<T extends ScheduleBounds & { status: ScheduleStatus; id: string }>(rows: readonly T[], at: Date): T | null {
  const live = rows.filter((r) => r.status !== "CANCELLED" && isActiveAt(r, at));
  if (live.length <= 1) return live[0] ?? null;
  return live.reduce((best, r) => (r.startsAt.getTime() > best.startsAt.getTime() || (r.startsAt.getTime() === best.startsAt.getTime() && r.id > best.id) ? r : best));
}

/** Nombre de programmations qui comptent dans la limite de plan : à venir ou en cours, non annulées. */
export function countsTowardLimit(row: ScheduleBounds & { status: ScheduleStatus }, now: Date): boolean {
  return row.status !== "CANCELLED" && row.endsAt.getTime() > now.getTime();
}

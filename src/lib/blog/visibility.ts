import { BLOG_SCHEDULE_MIN_MS, type BlogStatus } from "./constants";

/**
 * Visibilité et statuts des articles (fonctions pures, testées : tests/blog-visibility.test.ts).
 *
 * Publication programmée résolue à la LECTURE, sans tâche planifiée :
 * un article est public si `status = PUBLISHED`, ou `status = SCHEDULED` avec `publishedAt ≤ maintenant`.
 */

type PostLike = { status: BlogStatus | string; publishedAt: Date | string | null };

const time = (d: Date | string | null): number | null => (d == null ? null : new Date(d).getTime());

/** Article visible par les visiteurs de la boutique à l'instant `now`. */
export function isPostPublic(p: PostLike, now: Date = new Date()): boolean {
  if (p.status === "PUBLISHED") return true;
  if (p.status === "SCHEDULED") {
    const t = time(p.publishedAt);
    return t !== null && t <= now.getTime();
  }
  return false;
}

/** Filtre Prisma des articles publics (même règle que `isPostPublic`). Toujours combiné avec `storeId`. */
export function publicPostWhere(storeId: string, now: Date = new Date()) {
  return {
    storeId,
    OR: [{ status: "PUBLISHED" as const }, { status: "SCHEDULED" as const, publishedAt: { lte: now } }],
  };
}

/** Statut affiché : un article programmé dont l'heure est passée apparaît « Publié ». */
export function effectiveStatus(p: PostLike, now: Date = new Date()): BlogStatus {
  if (p.status === "SCHEDULED" && isPostPublic(p, now)) return "PUBLISHED";
  return (["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(p.status) ? p.status : "DRAFT") as BlogStatus;
}

/** Date de publication affichée et triée (publication, sinon création). */
export function postDate(p: { publishedAt: Date | string | null; createdAt: Date | string }): Date {
  return new Date(p.publishedAt ?? p.createdAt);
}

export type PublishIntent = "draft" | "publish" | "schedule" | "archive";

/**
 * Statut et date à enregistrer selon l'intention du commerçant.
 *  - publish : PUBLISHED ; date de première publication conservée si elle est passée, sinon maintenant ;
 *  - schedule : SCHEDULED à une date future (≥ 2 min) ;
 *  - draft / archive : la date de publication éventuelle est conservée (republication à la même date).
 */
export function resolvePublication(
  intent: PublishIntent,
  opts: { now?: Date; scheduledAt?: Date | null; previousPublishedAt?: Date | null } = {},
): { ok: true; status: BlogStatus; publishedAt: Date | null } | { ok: false; error: string } {
  const now = opts.now ?? new Date();
  const prev = opts.previousPublishedAt ?? null;
  switch (intent) {
    case "draft":
      return { ok: true, status: "DRAFT", publishedAt: prev };
    case "archive":
      return { ok: true, status: "ARCHIVED", publishedAt: prev };
    case "publish":
      return { ok: true, status: "PUBLISHED", publishedAt: prev && prev.getTime() <= now.getTime() ? prev : now };
    case "schedule": {
      const at = opts.scheduledAt;
      if (!at || Number.isNaN(at.getTime())) return { ok: false, error: "Indiquez la date et l'heure de publication." };
      if (at.getTime() < now.getTime() + BLOG_SCHEDULE_MIN_MS) return { ok: false, error: "Choisissez une date future, ou publiez maintenant." };
      if (at.getTime() > now.getTime() + 366 * 86_400_000) return { ok: false, error: "La programmation est limitée à un an." };
      return { ok: true, status: "SCHEDULED", publishedAt: at };
    }
  }
}

/**
 * Convertit une date « locale » saisie (AAAA-MM-JJTHH:MM, champ datetime-local) dans le fuseau de la boutique en instant UTC.
 * Renvoie null si la saisie est invalide.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(guess)) return null;
  // Décalage du fuseau à cet instant (deux passes pour les changements d'heure).
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - t;
  };
  try {
    let t = guess - offset(guess);
    t = guess - offset(t);
    return new Date(t);
  } catch {
    return null;
  }
}

/** Instant UTC → valeur de champ datetime-local dans le fuseau de la boutique. */
export function utcToZonedLocal(d: Date | string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(d));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  } catch {
    return new Date(d).toISOString().slice(0, 16);
  }
}

import "server-only";
import { db } from "@/lib/db";

export type ThemeVersionSummary = {
  id: string;
  label: string | null;
  publishedAt: string;
  actorName: string | null;
};

/** Dernières versions publiées du thème (table ThemeVersion), la plus récente d'abord. */
export async function listThemeVersions(storeId: string, take = 20): Promise<ThemeVersionSummary[]> {
  const rows = await db.themeVersion.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, label: true, publishedAt: true, createdAt: true, actorId: true },
  });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(actors.map((a) => [a.id, a.name]));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    publishedAt: (r.publishedAt ?? r.createdAt).toISOString(),
    actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
  }));
}

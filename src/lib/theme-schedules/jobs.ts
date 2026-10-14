import "server-only";
import { db } from "@/lib/db";
import type { JobHandlers } from "@/lib/jobs";
import { notifyStore } from "@/lib/notifications/service";
import { occasionName } from "@/config/occasions";

/**
 * Lot 4 §11 : `theme.schedule_notify` { scheduleId, edge: "start" | "end" }.
 *
 * Rôle PUREMENT informatif : prévenir le commerçant et tenir `ThemeSchedule.status` à jour. Le rendu, lui, résout la
 * programmation active à chaque requête (`scheduledThemeAt`) : même si ce job ne tourne jamais, la boutique affiche
 * le bon thème et revient au thème normal à la seconde près.
 *
 * Les jobs périmés (dates modifiées depuis la planification) ne font rien : l'instant réel est revérifié ici.
 * Notifications idempotentes grâce à la clé `theme-schedule:<id>:<edge>`.
 */
export const handlers: JobHandlers = {
  "theme.schedule_notify": async (payload) => {
    const scheduleId = typeof payload.scheduleId === "string" ? payload.scheduleId : null;
    const edge = payload.edge === "end" ? "end" : "start";
    if (!scheduleId) return;

    const row = await db.themeSchedule.findUnique({
      where: { id: scheduleId },
      select: { id: true, storeId: true, name: true, occasion: true, startsAt: true, endsAt: true, status: true },
    });
    if (!row || row.status === "CANCELLED") return;

    const now = Date.now();
    const label = occasionName(row.occasion) ? `${row.name} · ${occasionName(row.occasion)}` : row.name;
    const href = `/app/${row.storeId}/apparence/programmations`;

    if (edge === "start") {
      // Job périmé : la période n'a pas (encore) commencé, ou elle est déjà finie.
      if (now < row.startsAt.getTime() || now >= row.endsAt.getTime()) return;
      if (row.status === "SCHEDULED") await db.themeSchedule.updateMany({ where: { id: row.id, status: "SCHEDULED" }, data: { status: "ACTIVE" } });
      await notifyStore(row.storeId, {
        kind: "other",
        title: "Thème programmé en ligne",
        text: `« ${label} » habille votre boutique jusqu'à la fin de la période. Vous pouvez l'annuler à tout moment.`,
        href,
        key: `theme-schedule:${row.id}:start`,
      });
      return;
    }

    if (now < row.endsAt.getTime()) return; // job périmé (fin repoussée)
    if (row.status !== "COMPLETED") await db.themeSchedule.updateMany({ where: { id: row.id, status: { in: ["SCHEDULED", "ACTIVE"] } }, data: { status: "COMPLETED" } });
    await notifyStore(row.storeId, {
      kind: "other",
      title: "Retour au thème normal",
      text: `La programmation « ${label} » est terminée : votre boutique a repris son thème habituel.`,
      href,
      key: `theme-schedule:${row.id}:end`,
    });
  },
};

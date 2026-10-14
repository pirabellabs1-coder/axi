import "server-only";
import { db } from "@/lib/db";
import { queueNotification, type JobHandlers } from "@/lib/jobs";
import { notifyStore } from "@/lib/notifications/service";

/**
 * Job `pos.session_report` (lot 3 §4) : à la clôture d'une session, le rapport Z (déjà figé en base)
 * est porté à la connaissance du commerçant — notification interne et e-mail de contact — en insistant
 * sur l'écart de caisse et les écarts de prix hors ligne.
 */
export const handlers: JobHandlers = {
  "pos.session_report": async (payload) => {
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
    if (!sessionId) return;
    const session = await db.posSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        storeId: true,
        status: true,
        discrepancy: true,
        expectedCash: true,
        countedCash: true,
        report: true,
        closedAt: true,
        device: { select: { name: true } },
        store: { select: { name: true, contactEmail: true, currency: true } },
      },
    });
    if (!session || session.status !== "CLOSED") return;
    const report = (session.report ?? {}) as { salesCount?: number; grossTotal?: number; offlinePriceMismatches?: number };
    const gap = session.discrepancy ?? 0;
    const lines = [
      `Caisse « ${session.device.name} » fermée.`,
      `Ventes : ${report.salesCount ?? 0} pour ${report.grossTotal ?? 0} ${session.store.currency}.`,
      `Espèces attendues : ${session.expectedCash ?? 0} — comptées : ${session.countedCash ?? 0} (écart ${gap > 0 ? "+" : ""}${gap}).`,
      report.offlinePriceMismatches ? `${report.offlinePriceMismatches} vente(s) hors ligne enregistrée(s) au prix encaissé : à vérifier.` : null,
    ].filter(Boolean) as string[];

    await notifyStore(session.storeId, {
      kind: "other",
      key: `pos:session:${session.id}`,
      title: gap === 0 ? "Rapport Z de caisse" : "Rapport Z de caisse — écart",
      text: lines.join(" "),
      href: `/app/${session.storeId}/caisse`,
    });
    if (session.store.contactEmail) {
      await queueNotification(session.storeId, "email", session.store.contactEmail, "merchant.pos_session_report", {
        subject: `Rapport Z — ${session.device.name}${gap === 0 ? "" : " (écart de caisse)"}`,
        text: lines.join("\n"),
      });
    }
  },
};

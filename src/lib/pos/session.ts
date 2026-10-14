import "server-only";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { notifyStore } from "@/lib/notifications/service";
import { buildZReport, type ZReport } from "./cash";
import { sessionSales } from "./service";

/**
 * Sessions de caisse (lot 3 §2) : ouverture avec un fond de caisse, mouvements d'espèces, clôture avec
 * comptage et rapport Z. Une session ne se ferme pas tant que des ventes restent en file sur l'appareil
 * (contrôle côté appareil) ; le rapport est écrit une seule fois et devient immuable.
 */

export class PosSessionError extends Error {}

export async function openSession(p: { storeId: string; deviceId: string; locationId: string; actorId: string; openingFloat: number }): Promise<{ id: string; reopened: boolean }> {
  if (!Number.isInteger(p.openingFloat) || p.openingFloat < 0) throw new PosSessionError("Fond de caisse invalide.");
  return db.$transaction(async (tx) => {
    const open = await tx.posSession.findFirst({
      where: { storeId: p.storeId, deviceId: p.deviceId, status: "OPEN" },
      select: { id: true },
      orderBy: { openedAt: "desc" },
    });
    // Une seule session ouverte par appareil : on reprend l'existante (reprise après fermeture de l'onglet).
    if (open) return { id: open.id, reopened: true };
    const session = await tx.posSession.create({
      data: { storeId: p.storeId, deviceId: p.deviceId, locationId: p.locationId, status: "OPEN", openedById: p.actorId, openingFloat: p.openingFloat },
      select: { id: true },
    });
    await audit({ storeId: p.storeId, actorId: p.actorId, action: "pos.session_opened", target: session.id, metadata: { deviceId: p.deviceId, openingFloat: p.openingFloat } }, tx);
    return { id: session.id, reopened: false };
  });
}

/**
 * Un membre sans capacité de gestion (STAFF) ne peut agir que sur la session qu'il a lui-même ouverte
 * (correctif mineur n° 9 : un caissier pouvait sortir des espèces ou clôturer la session d'un collègue,
 * sur n'importe quel appareil de la boutique).
 */
function assertOwnSession(session: { openedById: string | null }, p: { actorId: string; canManage?: boolean }): void {
  if (p.canManage) return;
  if (session.openedById !== p.actorId) {
    throw new PosSessionError("Cette session a été ouverte par un autre caissier : seul le gérant peut y toucher.");
  }
}

export async function addCashMovement(p: {
  storeId: string;
  sessionId: string;
  actorId: string;
  actorName?: string | null;
  kind: "in" | "out";
  amount: number;
  reason: string;
  /** Capacité de gestion (`store.settings`) : accès à toutes les sessions de la boutique. */
  canManage?: boolean;
}): Promise<void> {
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new PosSessionError("Montant invalide.");
  const reason = p.reason.trim().slice(0, 120);
  if (reason.length < 3) throw new PosSessionError("Indiquez le motif du mouvement de caisse.");
  const session = await db.posSession.findFirst({ where: { id: p.sessionId, storeId: p.storeId }, select: { id: true, status: true, openedById: true } });
  if (!session) throw new PosSessionError("Session introuvable.");
  if (session.status !== "OPEN") throw new PosSessionError("Session déjà fermée.");
  assertOwnSession(session, p);
  await db.$transaction(async (tx) => {
    await tx.posCashMovement.create({ data: { sessionId: session.id, kind: p.kind, amount: p.amount, reason, actorId: p.actorId } });
    await audit({ storeId: p.storeId, actorId: p.actorId, action: "pos.cash_movement", target: session.id, metadata: { kind: p.kind, amount: p.amount, reason } }, tx);
    // Toute SORTIE d'espèces prévient le gérant : c'est le seul mouvement qui fait quitter l'argent
    // du tiroir sans vente, donc le premier vecteur de détournement.
    if (p.kind === "out") {
      await notifyStore(
        p.storeId,
        {
          kind: "other",
          key: `pos:cash_out:${session.id}:${Date.now()}`,
          title: "Sortie d'espèces en caisse",
          text: `${p.actorName?.trim() || "Un caissier"} a retiré ${p.amount} du tiroir — motif : ${reason}.`,
          href: `/app/${p.storeId}/caisse`,
        },
        tx,
      );
    }
  });
}

/**
 * Remboursements rendus EN ESPÈCES sur les ventes de la session (majeur n° 9).
 * Un remboursement « original » d'une vente au comptoir sort du tiroir : il doit être déduit des espèces
 * attendues. Les remboursements en avoir (`store_credit`) ne touchent pas la caisse.
 */
export async function sessionCashRefunds(client: Tx | typeof db, sessionId: string): Promise<number> {
  const rows = await client.refund.findMany({
    where: { status: "DONE", method: "original", order: { posSessionId: sessionId } },
    select: { amount: true },
  });
  return rows.reduce((sum, r) => sum + Math.max(0, r.amount), 0);
}

/** Rapport Z calculé en direct (session ouverte) ou relu tel quel (session fermée : immuable). */
export async function sessionReport(storeId: string, sessionId: string, client: Tx | typeof db = db): Promise<{ report: ZReport; status: "OPEN" | "CLOSED"; openingFloat: number }> {
  const session = await client.posSession.findFirst({
    where: { id: sessionId, storeId },
    select: { id: true, status: true, openingFloat: true, countedCash: true, report: true, cashMoves: { select: { kind: true, amount: true } } },
  });
  if (!session) throw new PosSessionError("Session introuvable.");
  if (session.status === "CLOSED" && session.report) {
    return { report: session.report as unknown as ZReport, status: "CLOSED", openingFloat: session.openingFloat };
  }
  const sales = await sessionSales(client, session.id);
  const report = buildZReport({
    sales: sales.map((s) => ({ total: s.total, discount: s.discount, taxTotal: s.taxTotal, priceSource: s.priceSource })),
    payments: sales.flatMap((s) => s.paymentAttempts.filter((a) => a.status === "CONFIRMED").map((a) => ({ kind: a.provider, amount: a.amount }))),
    cashMoves: session.cashMoves,
    openingFloat: session.openingFloat,
    countedCash: session.countedCash,
    cashRefunds: await sessionCashRefunds(client, session.id),
  });
  return { report, status: session.status as "OPEN" | "CLOSED", openingFloat: session.openingFloat };
}

/** Clôture : comptage, écart, rapport Z figé. Idempotente (une session déjà fermée n'est pas réécrite). */
export async function closeSession(p: {
  storeId: string;
  sessionId: string;
  actorId: string;
  countedCash: number;
  /** Capacité de gestion (`store.settings`) : accès à toutes les sessions de la boutique. */
  canManage?: boolean;
  /**
   * Appareil qui demande la clôture (mineur n° 13) : la session doit lui appartenir. Un autre appareil
   * de la boutique ne ferme pas la caisse d'un collègue, même avec le bon `sessionId`.
   */
  deviceId?: string | null;
  /**
   * Ventes encore en file sur l'appareil, DÉCLARÉES par lui : la clôture est refusée tant qu'elles ne
   * sont pas synchronisées (le serveur ne peut pas voir la file IndexedDB, mais il refuse de figer un
   * rapport Z que l'appareil sait incomplet).
   */
  pendingSales?: number;
  /**
   * Ventes ENCAISSÉES mais refusées par le serveur (« à régulariser »), déclarées par l'appareil : l'argent
   * est dans le tiroir sans commande. La clôture exige une confirmation explicite et les inscrit au rapport Z,
   * pour que l'écart de caisse ne soit jamais trompeur.
   */
  blockedSales?: number;
  blockedAmount?: number;
  acknowledgeBlocked?: boolean;
}): Promise<ZReport> {
  if (!Number.isInteger(p.countedCash) || p.countedCash < 0) throw new PosSessionError("Montant compté invalide.");
  if ((p.pendingSales ?? 0) > 0) {
    throw new PosSessionError("Des ventes restent à synchroniser sur cet appareil : synchronisez-les avant de fermer la caisse.");
  }
  const blockedCount = Math.max(0, Math.trunc(p.blockedSales ?? 0));
  const blockedAmount = Math.max(0, Math.trunc(p.blockedAmount ?? 0));
  if (blockedCount > 0 && !p.acknowledgeBlocked) {
    throw new PosSessionError(
      `${blockedCount} vente(s) encaissée(s) attendent une régularisation. Régularisez-les, ou cochez la confirmation pour fermer quand même : elles seront inscrites au rapport Z.`,
    );
  }
  return db.$transaction(async (tx) => {
    const session = await tx.posSession.findFirst({
      where: { id: p.sessionId, storeId: p.storeId },
      select: { id: true, status: true, openingFloat: true, openedById: true, deviceId: true, report: true, cashMoves: { select: { kind: true, amount: true } } },
    });
    if (!session) throw new PosSessionError("Session introuvable.");
    if (session.status === "CLOSED") return session.report as unknown as ZReport;
    if (p.deviceId && session.deviceId !== p.deviceId) {
      throw new PosSessionError("Cette session appartient à un autre appareil de caisse : fermez-la depuis cet appareil.");
    }
    assertOwnSession(session, p);

    const sales = await sessionSales(tx, session.id);
    const report = buildZReport({
      sales: sales.map((s) => ({ total: s.total, discount: s.discount, taxTotal: s.taxTotal, priceSource: s.priceSource })),
      payments: sales.flatMap((s) => s.paymentAttempts.filter((a) => a.status === "CONFIRMED").map((a) => ({ kind: a.provider, amount: a.amount }))),
      cashMoves: session.cashMoves,
      openingFloat: session.openingFloat,
      countedCash: p.countedCash,
      cashRefunds: await sessionCashRefunds(tx, session.id),
    });
    const closed = await tx.posSession.updateMany({
      where: { id: session.id, storeId: p.storeId, status: "OPEN" },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedById: p.actorId,
        countedCash: p.countedCash,
        expectedCash: report.expectedCash,
        discrepancy: report.discrepancy ?? 0,
        report: (blockedCount > 0 ? { ...report, unregularized: { count: blockedCount, amount: blockedAmount } } : report) as unknown as object,
      },
    });
    if (closed.count === 0) throw new PosSessionError("Session déjà fermée.");
    await enqueue("pos.session_report", { sessionId: session.id }, { storeId: p.storeId }, tx);
    await audit(
      { storeId: p.storeId, actorId: p.actorId, action: "pos.session_closed", target: session.id, metadata: { counted: p.countedCash, expected: report.expectedCash, discrepancy: report.discrepancy, sales: report.salesCount, mismatches: report.offlinePriceMismatches, unregularizedSales: blockedCount, unregularizedAmount: blockedAmount } },
      tx,
    );
    return report;
  });
}

import "server-only";
import type { ReturnStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueue, queueNotification, type JobHandlers } from "@/lib/jobs";
import { formatMoney } from "@/lib/money";
import { RETURN_STATUS_BUYER_TEXT, RETURN_STATUS_LABELS } from "./state";
import { parseReturnPolicy, RESOLUTION_LABELS, type ResolutionKind } from "./policy";

/**
 * Gestionnaires de jobs des retours, chargés à la demande par src/lib/jobs.ts (LAZY_JOB_MODULES).
 * `return.status_changed` : notification à l'acheteur (e-mail s'il en a laissé un ; WhatsApp : P1, canal non branché)
 * et, pour une nouvelle demande, notification interne du commerçant. Idempotent par clé (retentatives du worker).
 */

const STATUSES = new Set<ReturnStatus>(["REQUESTED", "APPROVED", "RECEIVED", "RESOLVED", "REJECTED", "CANCELLED"]);

export async function handleReturnStatusChanged(p: Record<string, unknown>): Promise<void> {
  const returnId = typeof p.returnId === "string" ? p.returnId : null;
  const to = typeof p.to === "string" && STATUSES.has(p.to as ReturnStatus) ? (p.to as ReturnStatus) : null;
  if (!returnId || !to) return;
  const ret = await db.returnRequest.findUnique({
    where: { id: returnId },
    select: {
      id: true, storeId: true, reference: true, requestedBy: true, resolution: true, refundAmount: true, storeCreditAmount: true, rejectionReason: true,
      order: { select: { id: true, reference: true, customerName: true, customerEmail: true, trackingToken: true, currency: true } },
      store: { select: { name: true, returnPolicy: true } },
    },
  });
  if (!ret) return;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const key = `return:${ret.id}:${to}`;

  // Commerçant : nouvelle demande de l'acheteur (centre de notifications, idempotent par clé).
  if (to === "REQUESTED" && ret.requestedBy === "customer") {
    const { notifyStore } = await import("@/lib/notifications/service");
    await notifyStore(ret.storeId, {
      kind: "other",
      key,
      title: `Demande de retour ${ret.reference}`,
      text: `${ret.order.customerName} souhaite retourner des articles de la commande ${ret.order.reference}.`,
      href: `/app/${ret.storeId}/retours/${ret.id}`,
    });
  }

  // Acheteur : e-mail transactionnel (jamais deux fois pour la même transition).
  const email = ret.order.customerEmail;
  if (!email) return;
  const already = await db.notification.findFirst({ where: { storeId: ret.storeId, template: "customer.return_status", payload: { path: ["key"], equals: key } }, select: { id: true } });
  if (already) return;
  const lines = [`Bonjour ${ret.order.customerName},`, "", `Retour ${ret.reference} (commande ${ret.order.reference}) : ${RETURN_STATUS_LABELS[to].toLowerCase()}.`, RETURN_STATUS_BUYER_TEXT[to]];
  if (to === "APPROVED") {
    const policy = parseReturnPolicy(ret.store.returnPolicy);
    if (policy.instructions) lines.push("", `Instructions de ${ret.store.name} :`, policy.instructions);
  }
  if (to === "REJECTED" && ret.rejectionReason) lines.push("", `Motif : ${ret.rejectionReason}`);
  if (to === "RESOLVED") {
    const res = ret.resolution as ResolutionKind;
    if (res === "REFUND") lines.push("", `Remboursement de ${formatMoney(ret.refundAmount, ret.order.currency)}.`);
    else if (res === "STORE_CREDIT") lines.push("", `Avoir de ${formatMoney(ret.storeCreditAmount, ret.order.currency)} ajouté à votre compte client, utilisable sur votre prochaine commande.`);
    else if (res === "EXCHANGE") lines.push("", "Une commande d'échange a été créée par la boutique.");
    else lines.push("", `Résolution : ${RESOLUTION_LABELS[res] ?? res}.`);
  }
  lines.push("", `Suivre votre retour : ${base}/suivi/${ret.order.trackingToken}/retour`);
  await queueNotification(ret.storeId, "email", email, "customer.return_status", { key, subject: `Retour ${ret.reference} : ${RETURN_STATUS_LABELS[to].toLowerCase()}`, text: lines.join("\n") });
  await enqueue("notification.send", {});
}

export const handlers: JobHandlers = {
  "return.status_changed": async (payload) => handleReturnStatusChanged(payload),
};

import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { sendMail } from "@/lib/email";
import { formatMoney } from "@/lib/money";
import { SITE } from "@/config/site";

/**
 * Outbox transactionnelle : enqueue() s'appelle DANS la transaction qui modifie la donnée.
 * Le worker (runJobs) est déclenché par /api/jobs/run (cron) ou `pnpm jobs`.
 */
export type JobType =
  | "order.created"
  | "order.status_changed"
  | "payment.succeeded"
  | "payment.failed"
  | "order.fulfilled"
  | "notification.send"
  | "subscription.changed"
  | "store.published"
  | "member.invited"
  // Plateforme d'applications : événements de cycle de vie (gestionnaires no-op pour l'instant)
  | "app.installed"
  | "app.uninstalled"
  // Moteur d'automatisations (src/lib/automations/engine.ts) et paniers abandonnés (src/lib/carts/service.ts)
  | "automation.run"
  | "cart.check"
  | "loyalty.sync"
  // Lot 1 : gestionnaires chargés à la demande (voir LAZY_JOB_MODULES)
  | LazyJobType;

/**
 * Types de jobs dont le gestionnaire vit dans un module de domaine, importé dynamiquement à l'exécution
 * (pas d'import circulaire ; une équipe ajoute son gestionnaire dans son module sans toucher au worker).
 */
export type LazyJobType =
  | "giftcard.issue"
  | "giftcard.deliver"
  | "giftcard.expire_sweep"
  | "tenders.unpaid_sweep"
  | "return.status_changed"
  // Lot 2 : taux de change (quotidien), webhooks sortants (éventail puis livraison), purge des clés d'idempotence de l'API REST
  | "fx.refresh"
  | "webhook.fanout"
  | "webhook.deliver"
  | "idempotency.purge"
  // Lot 4 : notification des thèmes programmés, synchronisation des catalogues sociaux (dont WhatsApp, lot 1 bis),
  // envoi des notifications push, purge des générations IA expirées
  | "theme.schedule_notify"
  | "social.sync"
  | "push.send"
  | "ai.generation_purge"
  // Vague 2 (produits numériques) : émission des accès de téléchargement après paiement confirmé
  | "digital.deliver"
  // Lot 3 (opérations) : réconciliation du stock par dépôt, relève des transporteurs sans webhook,
  // information de l'acheteur à chaque étape d'expédition, rapport Z d'une session de caisse
  | "inventory.reconcile"
  | "shipment.poll"
  | "shipment.status_changed"
  | "pos.session_report"
  // Domaines achetés via Axi (src/lib/domains/jobs.ts) : achat / renouvellement après facture payée, suivi d'opération
  | "domain.register"
  | "domain.renew"
  | "domain.poll"
  // TikTok Shop (src/lib/tiktok-shop/jobs.ts) : balayage 10 min, synchro d'une boutique, import d'une commande, publication
  | "tiktok_shop.sweep"
  | "tiktok_shop.sync"
  | "tiktok_shop.order"
  | "tiktok_shop.publish";

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { storeId?: string | null; runAt?: Date } = {}, tx: Tx | typeof db = db) {
  return tx.job.create({
    data: {
      type,
      payload: payload as Prisma.InputJsonValue,
      storeId: opts.storeId ?? null,
      runAt: opts.runAt ?? new Date(),
    },
  });
}

export type JobHandler = (payload: Record<string, unknown>, job: { id: string; storeId: string | null }) => Promise<void>;
type Handler = JobHandler;

/** Contrat des modules de domaine : `export const handlers: JobHandlers = { "giftcard.issue": async (p, job) => { … } }`. */
export type JobHandlers = Partial<Record<LazyJobType, JobHandler>>;

const LAZY_JOB_MODULES: Record<LazyJobType, () => Promise<{ handlers: JobHandlers }>> = {
  "giftcard.issue": () => import("@/lib/giftcards/jobs"),
  "giftcard.deliver": () => import("@/lib/giftcards/jobs"),
  "giftcard.expire_sweep": () => import("@/lib/giftcards/jobs"),
  "tenders.unpaid_sweep": () => import("@/lib/giftcards/jobs"),
  "return.status_changed": () => import("@/lib/returns/jobs"),
  "fx.refresh": () => import("@/lib/currency/jobs"),
  "webhook.fanout": () => import("@/lib/webhooks/jobs"),
  "webhook.deliver": () => import("@/lib/webhooks/jobs"),
  "idempotency.purge": () => import("@/lib/api/jobs"),
  "theme.schedule_notify": () => import("@/lib/theme-schedules/jobs"),
  "social.sync": () => import("@/lib/social/jobs"),
  "push.send": () => import("@/lib/push/jobs"),
  "ai.generation_purge": () => import("@/lib/ai/design/jobs"),
  "digital.deliver": () => import("@/lib/digital/jobs"),
  "inventory.reconcile": () => import("@/lib/inventory/jobs"),
  "shipment.poll": () => import("@/lib/shipping/jobs"),
  "shipment.status_changed": () => import("@/lib/shipping/jobs"),
  "pos.session_report": () => import("@/lib/pos/jobs"),
  "domain.register": () => import("@/lib/domains/jobs"),
  "domain.renew": () => import("@/lib/domains/jobs"),
  "domain.poll": () => import("@/lib/domains/jobs"),
  "tiktok_shop.sweep": () => import("@/lib/tiktok-shop/jobs"),
  "tiktok_shop.sync": () => import("@/lib/tiktok-shop/jobs"),
  "tiktok_shop.order": () => import("@/lib/tiktok-shop/jobs"),
  "tiktok_shop.publish": () => import("@/lib/tiktok-shop/jobs"),
};

/** Gestionnaire paresseux : un type déclaré sans implémentation échoue (retenté puis DEAD), jamais marqué DONE à tort. */
function lazyHandler(type: LazyJobType): Handler {
  return async (payload, job) => {
    const mod = await LAZY_JOB_MODULES[type]();
    const handler = mod.handlers[type];
    if (!handler) throw new Error(`Gestionnaire non implémenté : ${type}`);
    await handler(payload, job);
  };
}

const handlers: Record<JobType, Handler> = {
  "order.created": async (p) => {
    const order = await db.order.findUnique({ where: { id: String(p.orderId) }, include: { store: true, items: true } });
    if (!order) return;
    // Notification marchand (e-mail) + client si e-mail fourni. WhatsApp API : P1 (Integration).
    const lines = order.items.map((i) => `• ${i.quantity} × ${i.name}${i.variantName ? ` (${i.variantName})` : ""} — ${formatMoney(i.lineTotal, order.currency)}`).join("\n");
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    if (order.store.contactEmail) {
      await queueNotification(order.storeId, "email", order.store.contactEmail, "merchant.order_created", {
        subject: `Nouvelle commande ${order.reference} — ${order.customerName}`,
        text: `Nouvelle commande ${order.reference} sur ${order.store.name}.\n\n${lines}\n\nTotal : ${formatMoney(order.total, order.currency)}\nClient : ${order.customerName} (+${order.customerPhone})\nMode : ${order.fulfillmentType}\n\nGérer : ${base}/app/${order.storeId}/commandes/${order.id}`,
      });
    }
    if (order.customerEmail) {
      await queueNotification(order.storeId, "email", order.customerEmail, "customer.order_created", {
        subject: `Votre commande ${order.reference} chez ${order.store.name}`,
        text: `Merci ${order.customerName} !\n\nVotre commande ${order.reference} a bien été reçue par ${order.store.name}. Elle sera confirmée par le commerçant.\n\n${lines}\n\nTotal : ${formatMoney(order.total, order.currency)}\n\nSuivre : ${base}/suivi/${order.trackingToken}`,
      });
    }
    await enqueue("notification.send", {});
    // Centre de notifications (idempotent par clé) puis automatisations
    const { notifyStore } = await import("@/lib/notifications/service");
    await notifyStore(order.storeId, {
      kind: "order.new",
      key: `order:${order.id}`,
      title: `Nouvelle commande ${order.reference}`,
      text: `${order.customerName}, ${formatMoney(order.total, order.currency)}, ${order.items.length} article${order.items.length > 1 ? "s" : ""}.`,
      href: `/app/${order.storeId}/commandes/${order.id}`,
    });
    if (order.paymentStatus === "PENDING" && order.paymentReference) {
      await notifyStore(order.storeId, {
        kind: "payment.verify",
        key: `pay:${order.id}`,
        title: `Paiement à vérifier : ${order.reference}`,
        text: `${order.paymentMethodLabel ?? "Paiement"} déclaré par le client (référence ${order.paymentReference}). Vérifiez la réception avant de confirmer.`,
        href: `/app/${order.storeId}/commandes/${order.id}`,
      });
    }
    const { fireTrigger } = await import("@/lib/automations/engine");
    await fireTrigger("order.created", { storeId: order.storeId, orderId: order.id, customerId: order.customerId });
  },
  "order.status_changed": async (p) => {
    const order = await db.order.findUnique({ where: { id: String(p.orderId) }, include: { store: true } });
    if (!order) return;
    // Automatisations (déclencheurs de statut), indépendantes de l'e-mail transactionnel ci-dessous
    const STATUS_TRIGGERS = { CONFIRMED: "order.confirmed", READY: "order.ready", DELIVERED: "order.delivered", CANCELLED: "order.cancelled" } as const;
    const trigger = STATUS_TRIGGERS[String(p.to) as keyof typeof STATUS_TRIGGERS];
    if (trigger) {
      const { fireTrigger } = await import("@/lib/automations/engine");
      await fireTrigger(trigger, { storeId: order.storeId, orderId: order.id, customerId: order.customerId });
    }
    if (!order.customerEmail) return;
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    // Lot 2 §1.1 : message dans la langue de la commande (`Order.locale`) si un modèle complet existe, sinon en français.
    const msg = (await import("@/lib/i18n/notify")).orderStatusMessage({
      status: String(p.to),
      orderLocale: order.locale,
      reference: order.reference,
      customerName: order.customerName,
      storeName: order.store.name,
      trackUrl: `${base}/suivi/${order.trackingToken}`,
    });
    if (!msg) return;
    await queueNotification(order.storeId, "email", order.customerEmail, "customer.order_status", { subject: msg.subject, text: msg.text });
    await enqueue("notification.send", {});
  },
  "payment.succeeded": async (p) => {
    // Vague 2 : mise en file de la remise numérique (job dédié, retenté indépendamment) AVANT la facture,
    // pour qu'un échec d'émission de facture ne retarde pas la remise des fichiers.
    await (await import("@/lib/digital/jobs")).onPaymentSucceeded(p);
    await (await import("@/lib/tax/jobs")).onPaymentSucceeded(p);
  },
  "payment.failed": async (p) => {
    const order = await db.order.findUnique({ where: { id: String(p.orderId) }, select: { id: true, storeId: true, reference: true, customerId: true, customerName: true, total: true, currency: true } });
    if (!order) return;
    const attemptId = p.attemptId ? String(p.attemptId) : null;
    const { notifyStore } = await import("@/lib/notifications/service");
    await notifyStore(order.storeId, {
      kind: "payment.failed",
      key: `payfail:${order.id}:${attemptId ?? "-"}`,
      title: `Paiement échoué : ${order.reference}`,
      text: `Le paiement en ligne de ${order.customerName} (${formatMoney(order.total, order.currency)}) n'a pas abouti.`,
      href: `/app/${order.storeId}/commandes/${order.id}`,
    });
    const { fireTrigger } = await import("@/lib/automations/engine");
    await fireTrigger("payment.failed", { storeId: order.storeId, orderId: order.id, attemptId, customerId: order.customerId });
  },
  "order.fulfilled": async () => {},
  "store.published": async () => {},
  "app.installed": async (p) => (await import("@/lib/apps/lifecycle-webhooks")).handlers["app.installed"](p),
  "app.uninstalled": async (p) => (await import("@/lib/apps/lifecycle-webhooks")).handlers["app.uninstalled"](p),
  "subscription.changed": async () => {},
  "automation.run": async (p) => {
    const { runAutomationJob } = await import("@/lib/automations/engine");
    await runAutomationJob(p);
  },
  "giftcard.issue": lazyHandler("giftcard.issue"),
  "giftcard.deliver": lazyHandler("giftcard.deliver"),
  "giftcard.expire_sweep": lazyHandler("giftcard.expire_sweep"),
  "tenders.unpaid_sweep": lazyHandler("tenders.unpaid_sweep"),
  "return.status_changed": lazyHandler("return.status_changed"),
  "fx.refresh": lazyHandler("fx.refresh"),
  "webhook.fanout": lazyHandler("webhook.fanout"),
  "webhook.deliver": lazyHandler("webhook.deliver"),
  "idempotency.purge": lazyHandler("idempotency.purge"),
  "theme.schedule_notify": lazyHandler("theme.schedule_notify"),
  "social.sync": lazyHandler("social.sync"),
  "push.send": lazyHandler("push.send"),
  "ai.generation_purge": lazyHandler("ai.generation_purge"),
  "digital.deliver": lazyHandler("digital.deliver"),
  "inventory.reconcile": lazyHandler("inventory.reconcile"),
  "shipment.poll": lazyHandler("shipment.poll"),
  "shipment.status_changed": lazyHandler("shipment.status_changed"),
  "pos.session_report": lazyHandler("pos.session_report"),
  "domain.register": lazyHandler("domain.register"),
  "domain.renew": lazyHandler("domain.renew"),
  "domain.poll": lazyHandler("domain.poll"),
  "tiktok_shop.sweep": lazyHandler("tiktok_shop.sweep"),
  "tiktok_shop.sync": lazyHandler("tiktok_shop.sync"),
  "tiktok_shop.order": lazyHandler("tiktok_shop.order"),
  "tiktok_shop.publish": lazyHandler("tiktok_shop.publish"),
  "cart.check": async (p) => {
    const { checkAbandonedCart } = await import("@/lib/carts/service");
    await checkAbandonedCart(p);
  },
  "loyalty.sync": async (p) => {
    // Relance d'une attribution / d'un retrait de points échoué après la transition de commande (idempotent).
    const { awardLoyaltyForOrder, revokeLoyaltyForOrder } = await import("@/lib/loyalty/service");
    const orderId = String(p.orderId ?? "");
    if (!orderId) return;
    if (p.to === "DELIVERED") await awardLoyaltyForOrder(orderId);
    else if (p.to === "CANCELLED" || p.to === "REFUNDED") await revokeLoyaltyForOrder(orderId);
  },
  "member.invited": async (p) => {
    await sendMail({ to: String(p.email), subject: `Invitation à rejoindre ${p.storeName} sur ${SITE.name}`, text: String(p.text) });
  },
  "notification.send": async () => {
    // Vide la file des notifications en attente (toutes boutiques)
    const pending = await db.notification.findMany({ where: { status: "QUEUED", attempts: { lt: 3 } }, take: 50, orderBy: { createdAt: "asc" } });
    for (const n of pending) {
      try {
        if (n.channel === "email") {
          const payload = (n.payload ?? {}) as { subject?: string; text?: string };
          const res = await sendMail({ to: n.recipient, subject: payload.subject ?? SITE.name, text: payload.text ?? "" });
          if (!res.ok) throw new Error(res.error);
        } else if (n.channel === "whatsapp" && n.storeId) {
          // Envoi réel via l'API WhatsApp Cloud. Imports dynamiques : évite le cycle jobs ↔ inbox.
          const payload = (n.payload ?? {}) as { messageId?: string; text?: string; attachmentUrl?: string };
          const { sendWhatsappText, sendWhatsappImage } = await import("@/lib/whatsapp/send");
          const { recordOutboundStatus } = await import("@/lib/inbox/service");
          const res = payload.attachmentUrl
            ? await sendWhatsappImage(n.storeId, n.recipient, payload.attachmentUrl, payload.text ?? "")
            : await sendWhatsappText(n.storeId, n.recipient, payload.text ?? "");
          if (res.ok) {
            if (payload.messageId) await recordOutboundStatus({ storeId: n.storeId, messageId: payload.messageId, providerRef: res.providerRef ?? undefined, status: "SENT" });
            await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } } });
          } else if (res.permanent || n.attempts + 1 >= 3) {
            // Échec définitif : rembourse le crédit (recordOutboundStatus) et clôt la notification.
            if (payload.messageId) await recordOutboundStatus({ storeId: n.storeId, messageId: payload.messageId, status: "FAILED", error: res.error });
            await db.notification.update({ where: { id: n.id }, data: { status: "FAILED", attempts: { increment: 1 }, error: res.error.slice(0, 500) } });
          } else {
            // Aléa transitoire : on rejoue au prochain cycle.
            await db.notification.update({ where: { id: n.id }, data: { status: "QUEUED", attempts: { increment: 1 }, error: res.error.slice(0, 500) } });
          }
          continue;
        } else {
          // sms ou canal sans intégration active : jamais présenté comme « envoyé ».
          await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: "Canal non activé" } });
          continue;
        }
        await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } } });
      } catch (e) {
        await db.notification.update({
          where: { id: n.id },
          data: { status: n.attempts + 1 >= 3 ? "FAILED" : "QUEUED", attempts: { increment: 1 }, error: String((e as Error).message).slice(0, 500) },
        });
      }
    }
  },
};

export async function queueNotification(storeId: string, channel: string, recipient: string, template: string, payload: Record<string, unknown>, tx: Tx | typeof db = db) {
  return tx.notification.create({ data: { storeId, channel, recipient, template, payload: payload as Prisma.InputJsonValue } });
}

/** Exécute jusqu'à `limit` jobs. Verrou optimiste par updateMany (sûr avec plusieurs workers). */
export async function runJobs(limit = 25): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const candidate = await db.job.findFirst({ where: { status: "PENDING", runAt: { lte: new Date() } }, orderBy: { runAt: "asc" } });
    if (!candidate) break;
    const locked = await db.job.updateMany({ where: { id: candidate.id, status: "PENDING" }, data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } } });
    if (locked.count === 0) continue;
    const handler = handlers[candidate.type as JobType];
    try {
      if (!handler) throw new Error(`Handler inconnu : ${candidate.type}`);
      await handler((candidate.payload ?? {}) as Record<string, unknown>, { id: candidate.id, storeId: candidate.storeId });
      await db.job.update({ where: { id: candidate.id }, data: { status: "DONE" } });
      processed++;
    } catch (e) {
      failed++;
      const attempts = candidate.attempts + 1;
      const dead = attempts >= candidate.maxAttempts;
      // Backoff exponentiel borné : 1, 2, 4, 8 min
      const delayMs = Math.min(2 ** attempts, 16) * 60_000;
      await db.job.update({
        where: { id: candidate.id },
        data: { status: dead ? "DEAD" : "PENDING", runAt: new Date(Date.now() + delayMs), lastError: String((e as Error).message).slice(0, 1000) },
      });
    }
  }
  return { processed, failed };
}

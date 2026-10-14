import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { enqueue, queueNotification } from "@/lib/jobs";
import { CreditError, ensureConversation, isWhatsappApiActive, queueOutboundMessage } from "@/lib/inbox/service";
import { notifyStore } from "@/lib/notifications/service";
import { effectivePrice } from "@/lib/commerce/pricing";
import { effectivePlanId } from "@/lib/billing/rules";
import { PLANS } from "@/config/plans";
import { SITE } from "@/config/site";
import { formatMoney } from "@/lib/money";
import { randomReference } from "@/lib/utils";
import { decodeConfig, whatsappPurpose, type AutomationConfig, type AutomationAction } from "./config";
import { TRIGGER_META, isTrigger, renderTemplate, firstName, ACTION_LABELS, type AutomationTrigger, type TemplateVars } from "./templates";
import { capAllows, capWindowStart, dedupeKey, evaluateConditions, subjectKey, type Decision } from "./rules";
import { activeAutomationLimit, triggerAllowed } from "./limits";
import { effectiveLowStockThreshold } from "@/lib/inventory/policy";
import { storeLowStockThreshold } from "@/lib/inventory/service";

/**
 * Moteur d'automatisations.
 *
 *  fireTrigger(event)      : un événement métier (job) programme un job `automation.run` par
 *                            automatisation active, avec son délai ;
 *  executeAutomation(...)  : contrôle du plan, conditions, anti-doublon, plafond de fréquence,
 *                            actions (dans UNE transaction) puis journal ;
 *  le balayage (sweep.ts)  : déclencheurs temporels (inactivité, demande d'avis, stock bas).
 *
 * Journal : lignes `Notification` au canal « automation » (SENT = exécutée, SKIPPED = ignorée avec
 * raison, FAILED = échec), gabarit `automation:{id}`. Ces lignes ne sont jamais QUEUED : le worker
 * d'envoi ne les touche pas.
 * WhatsApp : API active → message en file + débit de crédits (remboursé si l'envoi échoue) ;
 * sinon brouillon « à envoyer » (lien wa.me) dans la boîte de réception, jamais présenté comme envoyé.
 */

export const LOG_CHANNEL = "automation";
export const logTemplate = (automationId: string) => `automation:${automationId}`;

export type TriggerEvent = {
  storeId: string;
  orderId?: string | null;
  attemptId?: string | null;
  cartId?: string | null;
  customerId?: string | null;
  phone?: string | null;
  name?: string | null;
  productId?: string | null;
  variantId?: string | null;
  /** Stock bas : id du mouvement qui a fait passer sous le seuil (une exécution par franchissement). */
  crossingId?: string | null;
};

export type LoadedAutomation = { id: string; storeId: string; trigger: AutomationTrigger; delayMinutes: number; active: boolean; createdAt: Date; config: AutomationConfig };

export function loadAutomation(row: { id: string; storeId: string; trigger: string; channel: string; delayMinutes: number; active: boolean; createdAt: Date; template: string }): LoadedAutomation | null {
  if (!isTrigger(row.trigger)) return null;
  return { id: row.id, storeId: row.storeId, trigger: row.trigger, delayMinutes: row.delayMinutes, active: row.active, createdAt: row.createdAt, config: decodeConfig(row.template, row) };
}

const appBase = () => (process.env.NEXT_PUBLIC_APP_URL ?? SITE.url).replace(/\/$/, "");

/* ───────────────────────── Déclenchement par événement ───────────────────────── */

/** Programme l'exécution des automatisations actives de ce déclencheur (événements uniquement). */
export async function fireTrigger(trigger: AutomationTrigger, event: TriggerEvent, client: Tx | typeof db = db): Promise<number> {
  if (TRIGGER_META[trigger].kind !== "event") return 0;
  const autos = await client.automation.findMany({ where: { storeId: event.storeId, trigger, active: true }, select: { id: true, delayMinutes: true } });
  const now = Date.now();
  for (const a of autos) {
    await enqueue("automation.run", { automationId: a.id, event }, { storeId: event.storeId, runAt: new Date(now + Math.max(0, a.delayMinutes) * 60_000) }, client);
  }
  return autos.length;
}

/** Handler du job `automation.run`. */
export async function runAutomationJob(payload: Record<string, unknown>) {
  const automationId = String(payload.automationId ?? "");
  const event = (payload.event ?? {}) as TriggerEvent;
  const row = await db.automation.findFirst({ where: { id: automationId, storeId: String(event.storeId ?? "") } });
  if (!row) return; // supprimée entre-temps
  const a = loadAutomation(row);
  if (!a) return;
  if (!a.active) {
    await writeLog(db, a, "SKIPPED", { reason: "Automatisation désactivée avant l'envoi", key: null, subject: null, ctx: null });
    return;
  }
  await executeAutomation(a, event);
}

/* ───────────────────────── Plan ───────────────────────── */

/** Le plan de la boutique autorise-t-il cette automatisation à s'exécuter ? (null = oui) */
export async function planBlockReason(a: Pick<LoadedAutomation, "id" | "storeId" | "trigger">): Promise<string | null> {
  const store = await db.store.findUnique({ where: { id: a.storeId }, select: { status: true, subscription: true } });
  if (!store) return "Boutique introuvable";
  if (store.status === "SUSPENDED" || store.status === "ARCHIVED") return "Boutique suspendue";
  const planId = effectivePlanId(store.subscription);
  if (!PLANS[planId].features.automations) return `Le plan ${PLANS[planId].name} n'inclut pas les automatisations`;
  if (!triggerAllowed(planId, a.trigger)) return "La relance des paniers abandonnés est incluse dans le plan Scale";
  const limit = activeAutomationLimit(planId);
  if (limit != null) {
    // Après une descente de plan : seules les plus anciennes automatisations actives, dans la limite, s'exécutent.
    const allowed = await db.automation.findMany({ where: { storeId: a.storeId, active: true }, orderBy: { createdAt: "asc" }, take: limit, select: { id: true } });
    if (!allowed.some((x) => x.id === a.id)) return `Au-delà de la limite de ${limit} automatisations actives du plan ${PLANS[planId].name}`;
  }
  return null;
}

/* ───────────────────────── Contexte ───────────────────────── */

export type ExecContext = {
  store: { id: string; name: string; slug: string; currency: string; contactEmail: string | null };
  ownerEmail: string | null;
  order: { id: string; reference: string; status: string; total: number; fulfillmentType: "PICKUP" | "DELIVERY" | "WHATSAPP" | "DIGITAL"; currency: string; trackingToken: string; createdAt: Date } | null;
  customer: { id: string; name: string; phone: string; email: string | null; ordersCount: number; createdAt: Date; lastOrderAt: Date | null; tags: string[] } | null;
  cart: { id: string; token: string; total: number; convertedOrderId: string | null; createdAt: Date; items: number } | null;
  /** `threshold` : seuil effectif (produit, sinon boutique). */
  product: { id: string; name: string; stock: number; threshold: number } | null;
  phone: string | null;
  name: string;
  email: string | null;
  marketingConsent: boolean | null;
  vars: TemplateVars;
  label: string;
};

async function latestMarketingConsent(customerId: string | null | undefined, client: Tx | typeof db = db): Promise<boolean | null> {
  if (!customerId) return null;
  const c = await client.consent.findFirst({ where: { customerId, channel: "WHATSAPP", purpose: "MARKETING" }, orderBy: { createdAt: "desc" }, select: { granted: true } });
  return c ? c.granted : null;
}

/** Charge tout ce dont les conditions et les messages ont besoin. null si l'objet n'existe plus. */
export async function loadContext(trigger: AutomationTrigger, event: TriggerEvent): Promise<ExecContext | null> {
  const storeId = event.storeId;
  const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true, name: true, slug: true, currency: true, contactEmail: true } });
  if (!store) return null;
  const owner = await db.membership.findFirst({ where: { storeId, role: "OWNER" }, select: { user: { select: { email: true } } } });
  const base = appBase();

  let order: ExecContext["order"] = null;
  let orderEmail: string | null = null;
  let orderName: string | null = null;
  let orderPhone: string | null = null;
  let customerId = event.customerId ?? null;
  if (event.orderId) {
    const o = await db.order.findFirst({ where: { id: event.orderId, storeId } });
    if (!o) return null;
    order = { id: o.id, reference: o.reference, status: o.status, total: o.total, fulfillmentType: o.fulfillmentType, currency: o.currency, trackingToken: o.trackingToken, createdAt: o.createdAt };
    orderEmail = o.customerEmail;
    orderName = o.customerName;
    orderPhone = o.customerPhone;
    customerId = customerId ?? o.customerId;
  }

  let cart: ExecContext["cart"] = null;
  if (event.cartId) {
    const c = await db.cart.findFirst({
      where: { id: event.cartId, storeId },
      include: { items: { include: { product: { select: { price: true, promoPrice: true, promoStart: true, promoEnd: true, status: true } }, variant: { select: { price: true } } } } },
    });
    if (!c) return null;
    const now = new Date();
    const total = c.items.reduce((s, it) => {
      if (it.product.status !== "ACTIVE") return s;
      const opts = Array.isArray(it.options) ? (it.options as { priceDelta?: number }[]) : [];
      const unit = (it.variant?.price ?? effectivePrice(it.product, now).price) + opts.reduce((x, o) => x + (Number(o.priceDelta) || 0), 0);
      return s + unit * it.quantity;
    }, 0);
    cart = { id: c.id, token: c.token, total, convertedOrderId: c.convertedOrderId, createdAt: c.createdAt, items: c.items.length };
  }

  let product: ExecContext["product"] = null;
  if (event.productId) {
    const p = await db.product.findFirst({ where: { id: event.productId, storeId }, select: { id: true, name: true, stock: true, lowStockThreshold: true } });
    if (!p) return null;
    const threshold = effectiveLowStockThreshold(p.lowStockThreshold, await storeLowStockThreshold(storeId));
    product = { id: p.id, name: p.name, stock: p.stock, threshold };
    if (event.variantId) {
      const v = await db.variant.findFirst({ where: { id: event.variantId, productId: p.id }, select: { name: true, stock: true } });
      if (v) product = { id: p.id, name: `${p.name} (${v.name})`, stock: v.stock, threshold };
    }
  }

  let customer: ExecContext["customer"] = null;
  const phoneHint = (event.phone ?? orderPhone ?? "").replace(/\D/g, "") || null;
  const cust = customerId
    ? await db.customer.findFirst({ where: { id: customerId, storeId } })
    : phoneHint
      ? await db.customer.findUnique({ where: { storeId_phone: { storeId, phone: phoneHint } } })
      : null;
  if (cust) customer = { id: cust.id, name: cust.name, phone: cust.phone, email: cust.email, ordersCount: cust.ordersCount, createdAt: cust.createdAt, lastOrderAt: cust.lastOrderAt, tags: cust.tags };
  if (trigger === "customer.inactive" && !customer) return null;

  const phone = phoneHint ?? customer?.phone ?? null;
  const name = (orderName ?? event.name ?? customer?.name ?? "").trim();
  const email = orderEmail ?? customer?.email ?? null;
  const marketingConsent = await latestMarketingConsent(customer?.id);

  const storeUrl = `${base}/s/${store.slug}`;
  let lien = storeUrl;
  if (order) lien = `${base}/suivi/${order.trackingToken}`;
  if (cart) lien = `${storeUrl}?panier=${cart.token}`;
  if (product) lien = `${base}/app/${storeId}/produits/${product.id}`;

  const total = order ? formatMoney(order.total, order.currency) : cart ? formatMoney(cart.total, store.currency) : "";
  const vars: TemplateVars = {
    prenom: firstName(name) || name,
    client: name,
    boutique: store.name,
    reference: order?.reference ?? "",
    total,
    lien,
    produit: product?.name ?? "",
    stock: product ? String(product.stock) : "",
  };
  const label = order ? `Commande ${order.reference}${name ? `, ${name}` : ""}` : product ? `Produit ${product.name}` : cart ? `Panier de ${name || "client"}` : name || "Client";

  return { store, ownerEmail: owner?.user.email ?? null, order, customer, cart, product, phone, name, email, marketingConsent, vars, label };
}

/** Garde-fous d'état au moment de l'exécution (le délai a pu changer la situation). */
async function stateBlockReason(trigger: AutomationTrigger, ctx: ExecContext, threshold: number | null): Promise<string | null> {
  if (ctx.order && trigger !== "order.cancelled" && trigger !== "payment.failed" && ctx.order.status === "CANCELLED") return "Commande annulée entre-temps";
  if (trigger === "order.ready" && ctx.order && !["READY", "OUT_FOR_DELIVERY", "DELIVERED"].includes(ctx.order.status)) return "La commande n'est plus au statut « Prête »";
  if (trigger === "payment.failed" && ctx.order) {
    const o = await db.order.findUnique({ where: { id: ctx.order.id }, select: { paymentStatus: true } });
    if (o?.paymentStatus === "PAID") return "Le paiement a finalement abouti";
  }
  if (trigger === "cart.abandoned" && ctx.cart) {
    if (ctx.cart.convertedOrderId) return "Le client a finalisé sa commande";
    if (ctx.cart.items === 0) return "Panier vide";
    if (ctx.phone) {
      const ordered = await db.order.findFirst({ where: { storeId: ctx.store.id, customerPhone: ctx.phone, createdAt: { gte: ctx.cart.createdAt } }, select: { id: true } });
      if (ordered) return "Le client a finalisé sa commande";
    }
  }
  if (trigger === "customer.inactive" && ctx.customer?.lastOrderAt && threshold != null) {
    if (ctx.customer.lastOrderAt.getTime() > Date.now() - threshold * 86_400_000) return "Le client a commandé récemment";
  }
  // Stock bas : seuil du produit, sinon seuil par défaut de la boutique.
  if (trigger === "product.low_stock" && ctx.product && ctx.product.stock > ctx.product.threshold) return "Stock réapprovisionné";
  return null;
}

function evalCtx(ctx: ExecContext) {
  return {
    order: ctx.order ? { total: ctx.order.total, fulfillmentType: ctx.order.fulfillmentType, currency: ctx.order.currency } : null,
    customer: ctx.customer ? { ordersCount: ctx.customer.ordersCount, createdAt: ctx.customer.createdAt, lastOrderAt: ctx.customer.lastOrderAt, tags: ctx.customer.tags } : null,
    marketingConsent: ctx.marketingConsent,
    hasPhone: !!ctx.phone,
    now: new Date(),
  };
}

/* ───────────────────────── Exécution ───────────────────────── */

class SkipError extends Error {}

type ActionResult = { type: AutomationAction["type"]; status: "queued" | "draft" | "done" | "skipped"; detail: string };

export type ExecOutcome = { status: "sent" | "skipped" | "failed" | "duplicate"; reason?: string };

type LogCtx = { key: string | null; subject: string | null; ctx: ExecContext | null; reason?: string; results?: ActionResult[] };

async function writeLog(client: Tx | typeof db, a: LoadedAutomation, status: "SENT" | "SKIPPED" | "FAILED", l: LogCtx) {
  await client.notification.create({
    data: {
      storeId: a.storeId,
      channel: LOG_CHANNEL,
      recipient: l.ctx?.phone ?? "store",
      template: logTemplate(a.id),
      status,
      error: l.reason?.slice(0, 500) ?? null,
      sentAt: status === "SENT" ? new Date() : null,
      attempts: 1,
      payload: {
        automationId: a.id,
        name: a.config.name,
        trigger: a.trigger,
        dedupeKey: l.key,
        subjectKey: l.subject,
        label: l.ctx?.label ?? null,
        orderId: l.ctx?.order?.id ?? null,
        results: l.results ?? [],
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Une exécution déjà journalisée (réussie ou ignorée) pour cette clé ? */
async function alreadyProcessed(client: Tx | typeof db, a: LoadedAutomation, key: string) {
  const hit = await client.notification.findFirst({
    where: { storeId: a.storeId, channel: LOG_CHANNEL, template: logTemplate(a.id), status: { in: ["SENT", "SKIPPED"] }, payload: { path: ["dedupeKey"], equals: key } },
    select: { id: true },
  });
  return !!hit;
}

function couponCode(): string {
  return randomReference("AXI", 6).replace("-", "");
}

async function performActions(tx: Tx, a: LoadedAutomation, ctx: ExecContext, apiActive: boolean): Promise<ActionResult[]> {
  const storeId = a.storeId;
  const vars: TemplateVars = { ...ctx.vars };
  const results: ActionResult[] = [];
  let dispatch = false;
  const merchant = TRIGGER_META[a.trigger].audience === "merchant";
  // Le coupon d'abord : son code est utilisable dans les messages ({coupon}).
  const ordered = [...a.config.actions].sort((x, y) => (x.type === "coupon" ? -1 : 0) - (y.type === "coupon" ? -1 : 0));

  for (const action of ordered) {
    switch (action.type) {
      case "coupon": {
        let code = couponCode();
        for (let i = 0; i < 4; i++) {
          const clash = await tx.coupon.findUnique({ where: { storeId_code: { storeId, code } }, select: { id: true } });
          if (!clash) break;
          code = couponCode();
        }
        await tx.coupon.create({
          data: {
            storeId,
            code,
            type: action.couponType,
            value: action.couponType === "FREE_DELIVERY" ? 0 : action.value,
            maxUses: 1,
            maxUsesPerCustomer: 1,
            startsAt: new Date(),
            endsAt: new Date(Date.now() + action.validDays * 86_400_000),
            active: true,
          },
        });
        vars.coupon = code;
        results.push({ type: "coupon", status: "done", detail: `Coupon ${code} créé (usage unique, ${action.validDays} j)` });
        break;
      }
      case "whatsapp": {
        if (!ctx.phone) {
          results.push({ type: "whatsapp", status: "skipped", detail: "Aucun numéro de téléphone" });
          break;
        }
        const body = renderTemplate(action.message, vars);
        const purpose = whatsappPurpose(a.trigger, action);
        const conversation = await ensureConversation(tx, { storeId, phone: ctx.phone, name: ctx.name || `+${ctx.phone}`, customerId: ctx.customer?.id ?? null });
        await queueOutboundMessage(tx, {
          storeId,
          conversationId: conversation.id,
          phone: ctx.phone,
          body,
          authorId: null,
          apiActive,
          creditType: purpose === "marketing" ? "WA_MARKETING" : "WA_UTILITY",
          template: `automation.${a.trigger}`,
          orderId: ctx.order?.id ?? null,
        });
        if (apiActive) dispatch = true;
        results.push(apiActive ? { type: "whatsapp", status: "queued", detail: "Message en file d'envoi (API WhatsApp), 1 crédit débité" } : { type: "whatsapp", status: "draft", detail: "Brouillon à envoyer depuis la boîte de réception (lien wa.me)" });
        break;
      }
      case "email": {
        const to = merchant ? (ctx.store.contactEmail ?? ctx.ownerEmail) : ctx.email;
        if (!to) {
          results.push({ type: "email", status: "skipped", detail: merchant ? "Aucune adresse e-mail de contact" : "Le client n'a pas donné d'adresse e-mail" });
          break;
        }
        await queueNotification(storeId, "email", to, `automation.${a.trigger}`, { subject: renderTemplate(action.subject, vars), text: renderTemplate(action.message, vars) }, tx);
        dispatch = true;
        results.push({ type: "email", status: "queued", detail: merchant ? "E-mail à la boutique en file d'envoi" : "E-mail au client en file d'envoi" });
        break;
      }
      case "notify": {
        await notifyStore(storeId, { kind: merchant ? "stock.low" : "automation", title: a.config.name, text: renderTemplate(action.message, vars), href: ctx.order ? `/app/${storeId}/commandes/${ctx.order.id}` : ctx.product ? `/app/${storeId}/produits/${ctx.product.id}` : `/app/${storeId}/automatisations` }, tx);
        results.push({ type: "notify", status: "done", detail: "Notification ajoutée au centre de notifications" });
        break;
      }
      case "tag": {
        if (!ctx.customer) {
          results.push({ type: "tag", status: "skipped", detail: "Aucune fiche client" });
          break;
        }
        if (!ctx.customer.tags.some((t) => t.toLowerCase() === action.tag.toLowerCase())) {
          await tx.customer.update({ where: { id: ctx.customer.id }, data: { tags: { push: action.tag } } });
        }
        results.push({ type: "tag", status: "done", detail: `Étiquette « ${action.tag} »` });
        break;
      }
    }
  }
  if (results.every((r) => r.status === "skipped")) {
    throw new SkipError(`Aucune action possible : ${results.map((r) => r.detail.toLowerCase()).join(", ")}`);
  }
  if (dispatch) await enqueue("notification.send", {}, { storeId }, tx);
  if (ctx.order) {
    await tx.orderEvent.create({
      data: { orderId: ctx.order.id, actorLabel: "Automatisation", type: "notification", message: `« ${a.config.name} » : ${results.filter((r) => r.status !== "skipped").map((r) => r.detail).join(" ; ")}`.slice(0, 500) },
    });
  }
  return results;
}

/**
 * Exécute une automatisation pour un événement. Ne lève que sur une erreur inattendue
 * (le job est alors rejoué) ; les refus métier sont journalisés.
 */
export async function executeAutomation(a: LoadedAutomation, event: TriggerEvent, opts: { fromSweep?: boolean } = {}): Promise<ExecOutcome> {
  if (!opts.fromSweep) {
    const blocked = await planBlockReason(a);
    if (blocked) {
      await writeLog(db, a, "SKIPPED", { reason: blocked, key: null, subject: null, ctx: null });
      return { status: "skipped", reason: blocked };
    }
  }
  const ctx = await loadContext(a.trigger, { ...event, storeId: a.storeId });
  if (!ctx) {
    await writeLog(db, a, "SKIPPED", { reason: "Élément introuvable (supprimé entre-temps)", key: null, subject: null, ctx: null });
    return { status: "skipped", reason: "introuvable" };
  }
  const key = dedupeKey(a.trigger, {
    orderId: ctx.order?.id ?? event.orderId,
    attemptId: event.attemptId,
    cartId: ctx.cart?.id,
    customerId: ctx.customer?.id,
    lastOrderAt: ctx.customer?.lastOrderAt ?? null,
    productId: ctx.product?.id,
    variantId: event.variantId,
    crossingId: event.crossingId,
  });
  const subject = subjectKey(a.trigger, { phone: ctx.phone, productId: ctx.product?.id });
  if (await alreadyProcessed(db, a, key)) return { status: "duplicate" };

  const param = TRIGGER_META[a.trigger].param ? (a.config.params[TRIGGER_META[a.trigger].param!.key] ?? TRIGGER_META[a.trigger].param!.default) : null;
  const stateBlock = await stateBlockReason(a.trigger, ctx, param);
  const decision: Decision = stateBlock ? { ok: false, reason: stateBlock } : evaluateConditions(a.trigger, a.config, evalCtx(ctx));
  if (!decision.ok) {
    await writeLog(db, a, "SKIPPED", { reason: decision.reason, key, subject, ctx });
    return { status: "skipped", reason: decision.reason };
  }

  const apiActive = TRIGGER_META[a.trigger].audience === "customer" && a.config.actions.some((x) => x.type === "whatsapp") ? await isWhatsappApiActive(a.storeId) : false;
  try {
    await db.$transaction(
      async (tx) => {
        // Verrou par (automatisation, sujet) : deux jobs simultanés ne doublonnent pas et le plafond reste juste.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`automation:${a.id}:${subject}`}))`;
        if (await alreadyProcessed(tx, a, key)) throw new SkipError("__duplicate__");
        if (a.config.cap) {
          const sent = await tx.notification.count({
            where: { storeId: a.storeId, channel: LOG_CHANNEL, template: logTemplate(a.id), status: "SENT", createdAt: { gte: capWindowStart(a.config.cap, new Date()) }, payload: { path: ["subjectKey"], equals: subject } },
          });
          if (!capAllows(sent, a.config.cap)) throw new SkipError(`Plafond atteint : ${a.config.cap.max} envoi${a.config.cap.max > 1 ? "s" : ""} par client sur ${a.config.cap.days} jours`);
        }
        const results = await performActions(tx, a, ctx, apiActive);
        await writeLog(tx, a, "SENT", { key, subject, ctx, results });
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    return { status: "sent" };
  } catch (e) {
    if (e instanceof SkipError) {
      if (e.message === "__duplicate__") return { status: "duplicate" };
      await writeLog(db, a, "SKIPPED", { reason: e.message, key, subject, ctx });
      return { status: "skipped", reason: e.message };
    }
    if (e instanceof CreditError) {
      await writeLog(db, a, "FAILED", { reason: e.message, key, subject, ctx });
      return { status: "failed", reason: e.message };
    }
    await writeLog(db, a, "FAILED", { reason: `Erreur technique : ${String((e as Error).message ?? e).slice(0, 200)}`, key, subject, ctx }).catch(() => {});
    if (opts.fromSweep) return { status: "failed", reason: "technique" };
    throw e;
  }
}

/* ───────────────────────── Simulation (aucune écriture) ───────────────────────── */

export type SimulationResult = {
  label: string;
  decision: Decision;
  alreadyDone: boolean;
  actions: { type: AutomationAction["type"]; title: string; outcome: string; preview: string | null; ok: boolean }[];
};

export async function simulate(storeId: string, trigger: AutomationTrigger, config: AutomationConfig, event: TriggerEvent, automationId?: string): Promise<SimulationResult | null> {
  const ctx = await loadContext(trigger, { ...event, storeId });
  if (!ctx) return null;
  const param = TRIGGER_META[trigger].param ? (config.params[TRIGGER_META[trigger].param!.key] ?? TRIGGER_META[trigger].param!.default) : null;
  const stateBlock = await stateBlockReason(trigger, ctx, param);
  const decision: Decision = stateBlock ? { ok: false, reason: stateBlock } : evaluateConditions(trigger, config, evalCtx(ctx));
  let alreadyDone = false;
  if (automationId) {
    const key = dedupeKey(trigger, { orderId: ctx.order?.id, attemptId: event.attemptId, cartId: ctx.cart?.id, customerId: ctx.customer?.id, lastOrderAt: ctx.customer?.lastOrderAt ?? null, productId: ctx.product?.id, variantId: event.variantId, crossingId: event.crossingId });
    alreadyDone = await db.notification
      .findFirst({ where: { storeId, channel: LOG_CHANNEL, template: logTemplate(automationId), status: { in: ["SENT", "SKIPPED"] }, payload: { path: ["dedupeKey"], equals: key } }, select: { id: true } })
      .then((x) => !!x);
  }
  const apiActive = await isWhatsappApiActive(storeId);
  const merchant = TRIGGER_META[trigger].audience === "merchant";
  const vars: TemplateVars = { ...ctx.vars, coupon: config.actions.some((x) => x.type === "coupon") ? "AXI7K3P9Q" : "" };
  const actions = config.actions.map((x) => {
    const title = ACTION_LABELS[x.type];
    switch (x.type) {
      case "whatsapp":
        if (!ctx.phone) return { type: x.type, title, outcome: "Ignoré : aucun numéro", preview: null, ok: false };
        return {
          type: x.type,
          title,
          outcome: apiActive ? `Envoi par l'API WhatsApp au +${ctx.phone} (1 crédit ${whatsappPurpose(trigger, x) === "marketing" ? "marketing" : "utilitaire"})` : `Brouillon dans la boîte de réception, à envoyer au +${ctx.phone} via wa.me`,
          preview: renderTemplate(x.message, vars),
          ok: true,
        };
      case "email": {
        const to = merchant ? (ctx.store.contactEmail ?? ctx.ownerEmail) : ctx.email;
        if (!to) return { type: x.type, title, outcome: merchant ? "Ignoré : aucune adresse de contact" : "Ignoré : le client n'a pas d'adresse e-mail", preview: null, ok: false };
        return { type: x.type, title, outcome: `E-mail à ${to}`, preview: `${renderTemplate(x.subject, vars)}\n\n${renderTemplate(x.message, vars)}`, ok: true };
      }
      case "notify":
        return { type: x.type, title, outcome: "Notification dans votre centre de notifications", preview: renderTemplate(x.message, vars), ok: true };
      case "tag":
        return { type: x.type, title, outcome: ctx.customer ? `Étiquette « ${x.tag} » ajoutée à ${ctx.customer.name}` : "Ignoré : aucune fiche client", preview: null, ok: !!ctx.customer };
      case "coupon":
        return { type: x.type, title, outcome: `Coupon unique créé (exemple : AXI7K3P9Q), valable ${x.validDays} jours`, preview: null, ok: true };
    }
  });
  return { label: ctx.label, decision, alreadyDone, actions };
}

import { TRIGGER_META, FULFILLMENT_LABELS, SEGMENT_LABELS, type AutomationTrigger } from "./templates";
import { isPromotional, type AutomationConfig } from "./config";

/**
 * Règles pures du moteur : conditions, plafond de fréquence, clés d'anti-doublon.
 * Aucune dépendance serveur : testées unitairement (tests/automations.test.ts).
 */

export type EvalContext = {
  order: { total: number; fulfillmentType: "PICKUP" | "DELIVERY" | "WHATSAPP" | "DIGITAL"; currency: string } | null;
  customer: { ordersCount: number; createdAt: Date; lastOrderAt: Date | null; tags: string[] } | null;
  /** Dernier consentement marketing WhatsApp : true, false (retiré) ou null (jamais donné). */
  marketingConsent: boolean | null;
  hasPhone: boolean;
  now: Date;
};

export type Decision = { ok: true } | { ok: false; reason: string };

const DAY = 86_400_000;

export function matchesSegment(segment: AutomationConfig["conditions"]["segment"], tag: string | null, customer: EvalContext["customer"], now: Date): boolean {
  if (segment === "all") return true;
  if (!customer) return false;
  switch (segment) {
    case "new":
      return customer.createdAt.getTime() >= now.getTime() - 30 * DAY;
    case "loyal":
      return customer.ordersCount >= 3;
    case "inactive":
      return !!customer.lastOrderAt && customer.lastOrderAt.getTime() < now.getTime() - 60 * DAY;
    case "tag":
      return !!tag && customer.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
  }
}

/**
 * Évalue les conditions « Si … ». L'ordre des vérifications donne la raison la plus utile
 * au commerçant dans le journal (« ignoré : … »).
 */
export function evaluateConditions(trigger: AutomationTrigger, config: Pick<AutomationConfig, "conditions" | "actions">, ctx: EvalContext): Decision {
  const meta = TRIGGER_META[trigger];
  if (meta.audience === "merchant") return { ok: true };
  const cond = config.conditions;

  if (cond.minTotal != null && cond.minTotal > 0) {
    if (!ctx.order) return { ok: false, reason: "Condition de montant : aucune commande associée" };
    if (ctx.order.total < cond.minTotal) return { ok: false, reason: "Montant inférieur au minimum choisi" };
  }
  if (cond.fulfillment) {
    if (!ctx.order) return { ok: false, reason: "Condition de mode de livraison : aucune commande associée" };
    if (ctx.order.fulfillmentType !== cond.fulfillment) return { ok: false, reason: `Mode « ${ctx.order.fulfillmentType === "DIGITAL" ? "Envoi numérique" : FULFILLMENT_LABELS[ctx.order.fulfillmentType]} » au lieu de « ${FULFILLMENT_LABELS[cond.fulfillment]} »` };
  }
  if (cond.segment !== "all" && !matchesSegment(cond.segment, cond.tag, ctx.customer, ctx.now)) {
    return { ok: false, reason: `Client hors du segment « ${cond.segment === "tag" && cond.tag ? `étiquette ${cond.tag}` : SEGMENT_LABELS[cond.segment]} »` };
  }
  if (isPromotional(trigger, config) && ctx.marketingConsent !== true) {
    return { ok: false, reason: ctx.marketingConsent === false ? "Le client a retiré son accord pour les messages promotionnels" : "Pas de consentement aux messages promotionnels" };
  }
  return { ok: true };
}

/** Plafond de fréquence : `sentInWindow` = exécutions réussies pour ce client dans la fenêtre. */
export function capAllows(sentInWindow: number, cap: AutomationConfig["cap"]): boolean {
  if (!cap) return true;
  return sentInWindow < cap.max;
}

export function capWindowStart(cap: NonNullable<AutomationConfig["cap"]>, now: Date): Date {
  return new Date(now.getTime() - cap.days * DAY);
}

export type DedupeInput = {
  orderId?: string | null;
  attemptId?: string | null;
  cartId?: string | null;
  customerId?: string | null;
  lastOrderAt?: Date | string | null;
  productId?: string | null;
  variantId?: string | null;
  /** Stock bas : mouvement qui a fait passer sous le seuil. */
  crossingId?: string | null;
  now?: Date;
};

/**
 * Clé d'anti-doublon : une automatisation ne s'exécute qu'une fois par clé.
 *  - commandes : une fois par commande et par déclencheur ;
 *  - panier : une seule relance par panier ;
 *  - inactivité : une fois par période d'inactivité (la date de dernière commande fait partie de la clé) ;
 *  - stock bas : une alerte par franchissement du seuil (`crossingId`), à défaut au plus une par article et par jour.
 */
export function dedupeKey(trigger: AutomationTrigger, e: DedupeInput): string {
  switch (trigger) {
    case "order.created":
    case "order.confirmed":
    case "order.ready":
    case "order.delivered":
    case "order.cancelled":
    case "review.request":
      return `${trigger}:${e.orderId ?? "?"}`;
    case "payment.failed":
      return `${trigger}:${e.orderId ?? "?"}:${e.attemptId ?? "-"}`;
    case "cart.abandoned":
      return `cart:${e.cartId ?? "?"}`;
    case "customer.inactive": {
      const last = e.lastOrderAt ? new Date(e.lastOrderAt).toISOString() : "jamais";
      return `inactive:${e.customerId ?? "?"}:${last}`;
    }
    case "product.low_stock": {
      if (e.crossingId) return `stock:${e.productId ?? "?"}:${e.variantId ?? "-"}:x:${e.crossingId}`;
      const day = (e.now ?? new Date()).toISOString().slice(0, 10);
      return `stock:${e.productId ?? "?"}:${e.variantId ?? "-"}:${day}`;
    }
  }
}

/** Sujet du plafond de fréquence : le client (téléphone) ou le produit. */
export function subjectKey(trigger: AutomationTrigger, e: { phone?: string | null; productId?: string | null }): string {
  if (TRIGGER_META[trigger].audience === "merchant") return `product:${e.productId ?? "?"}`;
  return `phone:${e.phone ?? "?"}`;
}

import "server-only";
import { randomUUID } from "node:crypto";
import type { MembershipRole, Prisma, WebhookDeliveryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { PLANS, type PlanId } from "@/config/plans";
import { effectivePlanId } from "@/lib/billing/rules";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { enqueue, queueNotification } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { isWebhookEvent, WEBHOOK_API_VERSION, WEBHOOK_EVENTS, type WebhookEvent } from "./events";
import { generateWebhookSecret, secretDisplayPrefix, signatureHeader } from "./sign";
import { decodeKeyring, encodeKeyring, rotateKeyring, signingSecrets } from "./keyring";
import { checkWebhookUrl, resolveWebhookTarget } from "./ssrf";
import { sendSignedRequest, systemLookup, type SendResult } from "./deliver";
import { buildWebhookBody, canManageWebhooks, canViewCustomers, DELIVERY_LEASE_MS, DISABLE_AFTER_FAILURES, retryDelayMs, shouldDisableEndpoint, type WebhookBody } from "./policy";

/**
 * Service des webhooks sortants, partagé par l'espace marchand (actions), l'API REST et le MCP.
 * Toute lecture/écriture est filtrée par `storeId` ; l'appelant a déjà authentifié l'acteur.
 */

export class WebhookError extends Error {
  constructor(message: string, public code: "not_found" | "plan_required" | "plan_limit" | "forbidden" | "invalid" = "invalid") {
    super(message);
    this.name = "WebhookError";
  }
}

/**
 * `scopes` : portée EFFECTIVE de l'appelant programmatique (jeton API, MCP), null pour le tableau de bord
 * (session : le rôle fait foi). Sert au contrôle de `customers:read` sur les données personnelles.
 */
export type WebhookActor = {
  storeId: string;
  planId: PlanId;
  role: MembershipRole;
  userId: string | null;
  label: string;
  via: "dashboard" | "api" | "mcp";
  scopes?: readonly string[] | null;
};

const ENDPOINT_PUBLIC_SELECT = {
  id: true, url: true, description: true, secretPrefix: true, events: true, apiVersion: true, includePersonalData: true, active: true,
  consecutiveFailures: true, disabledAt: true, disabledReason: true, lastSuccessAt: true, lastFailureAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.WebhookEndpointSelect;

export type PublicEndpoint = Prisma.WebhookEndpointGetPayload<{ select: typeof ENDPOINT_PUBLIC_SELECT }>;

function auditAction(actor: WebhookActor, action: string) {
  return actor.via === "dashboard" ? `webhook.${action}` : `api.webhook.${action}`;
}

async function auditWebhook(actor: WebhookActor, action: string, target: string, metadata: Record<string, unknown>, tx: Prisma.TransactionClient | typeof db = db) {
  await audit({ storeId: actor.storeId, actorId: actor.userId, action: auditAction(actor, action), target, metadata: { ...metadata, via: actor.via, actor: actor.label } }, tx);
}

function requireWebhooks(actor: WebhookActor) {
  if (!PLANS[actor.planId].features.webhooks) throw new WebhookError(`Les webhooks sont inclus à partir du plan Business. Changez de plan : /app/${actor.storeId}/abonnement`, "plan_required");
  if (!canManageWebhooks(actor.role)) throw new WebhookError("Seul le propriétaire de la boutique gère les webhooks.", "forbidden");
}

export function normalizeEvents(raw: readonly string[]): WebhookEvent[] {
  const set = new Set(raw.filter(isWebhookEvent));
  return WEBHOOK_EVENTS.filter((e) => set.has(e));
}

/* ───────────────────────── Points de webhook ───────────────────────── */

export type CreateEndpointInput = { url: string; description?: string | null; events: string[]; includePersonalData?: boolean };

/** Crée un point ; renvoie le secret en clair UNE seule fois. Contrôle de l'URL (syntaxe + DNS) dès la création. */
export async function createEndpoint(actor: WebhookActor, input: CreateEndpointInput): Promise<{ endpoint: PublicEndpoint; secret: string }> {
  requireWebhooks(actor);
  // Autorisation AVANT tout travail (résolution DNS comprise).
  const includePersonalData = input.includePersonalData === true;
  if (includePersonalData && !canViewCustomers(actor.role)) throw new WebhookError("Votre rôle ne permet pas d'envoyer des données personnelles.", "forbidden");
  // S1 : un appel programmatique (jeton API, MCP) ne crée un point « avec données personnelles » que s'il a
  // AUSSI la portée `customers:read`. Sans elle, le reste de l'API masque nom, téléphone, e-mail et adresse :
  // un point de webhook ne doit pas servir de contournement. Le tableau de bord (session) reste régi par le rôle.
  if (includePersonalData && actor.via !== "dashboard" && !(actor.scopes ?? []).includes("customers:read")) {
    throw new WebhookError("La portée customers:read est requise pour envoyer des données personnelles dans les webhooks.", "forbidden");
  }
  const url = input.url.trim();
  const syntax = checkWebhookUrl(url);
  if (!syntax.ok) throw new WebhookError(syntax.reason);
  const target = await resolveWebhookTarget(url, systemLookup);
  if (!target.ok) throw new WebhookError(target.reason);
  const events = normalizeEvents(input.events);
  if (!events.length || events.length !== new Set(input.events).size) throw new WebhookError("Choisissez au moins un événement valide.");
  const description = input.description?.trim().slice(0, 200) || null;

  const secret = generateWebhookSecret();
  const max = PLANS[actor.planId].limits.webhookEndpoints;
  const endpoint = await db.$transaction(async (tx) => {
    if (max != null) {
      // Plafond compté sous verrou de la boutique (deux créations simultanées ne le dépassent pas).
      await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${actor.storeId} FOR UPDATE`;
      const count = await tx.webhookEndpoint.count({ where: { storeId: actor.storeId } });
      if (count >= max) throw new WebhookError(`Limite atteinte : ${count}/${max} point${max > 1 ? "s" : ""} de webhook sur le plan ${PLANS[actor.planId].name}.`, "plan_limit");
    }
    const row = await tx.webhookEndpoint.create({
      data: {
        storeId: actor.storeId,
        url,
        description,
        secretEnc: encryptSecret(encodeKeyring({ current: secret })),
        secretPrefix: secretDisplayPrefix(secret),
        events,
        apiVersion: WEBHOOK_API_VERSION,
        includePersonalData,
        createdById: actor.userId,
      },
      select: ENDPOINT_PUBLIC_SELECT,
    });
    await auditWebhook(actor, "endpoint_created", row.id, { url, events, includePersonalData }, tx);
    return row;
  });
  return { endpoint, secret };
}

export async function listEndpoints(storeId: string): Promise<PublicEndpoint[]> {
  return db.webhookEndpoint.findMany({ where: { storeId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: ENDPOINT_PUBLIC_SELECT });
}

export async function getEndpoint(storeId: string, id: string): Promise<PublicEndpoint | null> {
  return db.webhookEndpoint.findFirst({ where: { id, storeId }, select: ENDPOINT_PUBLIC_SELECT });
}

/** Mise à jour : événements, description, activation (réactiver remet le compteur d'échecs à zéro). */
export async function updateEndpoint(actor: WebhookActor, id: string, input: { events?: string[]; description?: string | null; active?: boolean }): Promise<PublicEndpoint> {
  requireWebhooks(actor);
  const current = await db.webhookEndpoint.findFirst({ where: { id, storeId: actor.storeId }, select: { id: true, active: true } });
  if (!current) throw new WebhookError("Point de webhook introuvable.", "not_found");
  const data: Prisma.WebhookEndpointUpdateManyMutationInput = {};
  if (input.events) {
    const events = normalizeEvents(input.events);
    if (!events.length) throw new WebhookError("Choisissez au moins un événement valide.");
    data.events = events;
  }
  if (input.description !== undefined) data.description = input.description?.trim().slice(0, 200) || null;
  if (input.active !== undefined) {
    data.active = input.active;
    if (input.active && !current.active) Object.assign(data, { consecutiveFailures: 0, disabledAt: null, disabledReason: null });
  }
  return db.$transaction(async (tx) => {
    await tx.webhookEndpoint.updateMany({ where: { id, storeId: actor.storeId }, data });
    await auditWebhook(actor, "endpoint_updated", id, { fields: Object.keys(data) }, tx);
    return tx.webhookEndpoint.findFirstOrThrow({ where: { id, storeId: actor.storeId }, select: ENDPOINT_PUBLIC_SELECT });
  });
}

/** Suppression (toujours possible, même plan rétrogradé ou boutique suspendue : retirer un accès sortant). */
export async function deleteEndpoint(actor: WebhookActor, id: string): Promise<void> {
  if (!canManageWebhooks(actor.role)) throw new WebhookError("Seul le propriétaire de la boutique gère les webhooks.", "forbidden");
  const r = await db.$transaction(async (tx) => {
    const del = await tx.webhookEndpoint.deleteMany({ where: { id, storeId: actor.storeId } });
    if (del.count) await auditWebhook(actor, "endpoint_deleted", id, {}, tx);
    return del.count;
  });
  if (!r) throw new WebhookError("Point de webhook introuvable.", "not_found");
}

/** Rotation : nouveau secret affiché une fois ; l'ancien continue de signer (second `v1`) pendant 24 h. */
export async function rotateEndpointSecret(actor: WebhookActor, id: string): Promise<{ secret: string; previousValidUntil: string; droppedOverlap: boolean }> {
  requireWebhooks(actor);
  const row = await db.webhookEndpoint.findFirst({ where: { id, storeId: actor.storeId }, select: { id: true, secretEnc: true } });
  if (!row) throw new WebhookError("Point de webhook introuvable.", "not_found");
  const secret = generateWebhookSecret();
  const current = decodeKeyring(decryptSecret(row.secretEnc));
  // Deuxième rotation pendant un recouvrement : le secret d'AVANT-DERNIÈRE génération, encore accepté par le
  // destinataire, cesse immédiatement de signer. L'appelant en avertit le commerçant.
  const droppedOverlap = signingSecrets(current, new Date()).length > 1;
  const next = rotateKeyring(current, secret);
  await db.$transaction(async (tx) => {
    // Écriture conditionnelle : deux rotations simultanées ne s'écrasent pas silencieusement.
    const r = await tx.webhookEndpoint.updateMany({ where: { id, storeId: actor.storeId, secretEnc: row.secretEnc }, data: { secretEnc: encryptSecret(encodeKeyring(next)), secretPrefix: secretDisplayPrefix(secret) } });
    if (!r.count) throw new WebhookError("Le secret vient d'être modifié ailleurs : rechargez la page.");
    await auditWebhook(actor, "secret_rotated", id, { previousValidUntil: next.previousUntil }, tx);
  });
  return { secret, previousValidUntil: next.previousUntil!, droppedOverlap };
}

/* ───────────────────────── Livraisons ───────────────────────── */

const DELIVERY_SELECT = {
  id: true, endpointId: true, eventId: true, event: true, status: true, attempts: true, nextAttemptAt: true, lastStatusCode: true,
  lastError: true, responseSnippet: true, durationMs: true, deliveredAt: true, createdAt: true,
} satisfies Prisma.WebhookDeliverySelect;

export type DeliveryRow = Prisma.WebhookDeliveryGetPayload<{ select: typeof DELIVERY_SELECT }>;

export async function listDeliveries(
  storeId: string,
  opts: { endpointId?: string; status?: WebhookDeliveryStatus[]; event?: string; limit?: number; cursor?: string },
): Promise<{ items: DeliveryRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  // m5 : curseur inconnu (ligne purgée, curseur d'une autre boutique) → erreur métier, jamais un 500 Prisma.
  if (opts.cursor && !(await db.webhookDelivery.findFirst({ where: { id: opts.cursor, storeId }, select: { id: true } }))) {
    throw new WebhookError("Curseur de pagination invalide.", "invalid");
  }
  const rows = await db.webhookDelivery.findMany({
    where: { storeId, ...(opts.endpointId ? { endpointId: opts.endpointId } : {}), ...(opts.status?.length ? { status: { in: opts.status } } : {}), ...(opts.event ? { event: opts.event } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: DELIVERY_SELECT,
  });
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  return { items, nextCursor: more ? items[items.length - 1].id : null };
}

/** Rejouer une livraison (même identifiants d'événement et de livraison, nouveau cycle de relances). */
export async function replayDelivery(actor: WebhookActor, deliveryId: string): Promise<void> {
  requireWebhooks(actor);
  const d = await db.webhookDelivery.findFirst({ where: { id: deliveryId, storeId: actor.storeId }, select: { id: true, endpoint: { select: { active: true } } } });
  if (!d) throw new WebhookError("Livraison introuvable.", "not_found");
  if (!d.endpoint.active) throw new WebhookError("Ce point de webhook est désactivé : réactivez-le avant de rejouer.");
  await db.$transaction(async (tx) => {
    await tx.webhookDelivery.updateMany({ where: { id: d.id, storeId: actor.storeId }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date() } });
    await enqueue("webhook.deliver", { deliveryId: d.id }, { storeId: actor.storeId }, tx);
    await auditWebhook(actor, "delivery_replayed", d.id, {}, tx);
  });
}

/** Événement de test `app.ping` vers un seul point. */
export async function sendTestEvent(actor: WebhookActor, endpointId: string): Promise<{ deliveryId: string }> {
  requireWebhooks(actor);
  const ep = await db.webhookEndpoint.findFirst({ where: { id: endpointId, storeId: actor.storeId }, select: { id: true, active: true } });
  if (!ep) throw new WebhookError("Point de webhook introuvable.", "not_found");
  if (!ep.active) throw new WebhookError("Ce point de webhook est désactivé : réactivez-le d'abord.");
  const eventId = `evt_${randomUUID().replace(/-/g, "")}`;
  const body = buildWebhookBody({ eventId, event: "app.ping", createdAt: new Date().toISOString(), storeId: actor.storeId, data: { message: "Événement de test envoyé depuis Axi.", endpoint_id: ep.id }, includePersonalData: false });
  const delivery = await db.$transaction(async (tx) => {
    const row = await tx.webhookDelivery.create({ data: { storeId: actor.storeId, endpointId: ep.id, eventId, event: "app.ping", payload: body as unknown as Prisma.InputJsonValue }, select: { id: true } });
    await enqueue("webhook.deliver", { deliveryId: row.id }, { storeId: actor.storeId }, tx);
    return row;
  });
  return { deliveryId: delivery.id };
}

/* ───────────────────────── Jobs ───────────────────────── */

export type FanoutPayload = { storeId: string; eventId: string; event: string; data: unknown; createdAt?: string };

/**
 * `webhook.fanout` : une WebhookDelivery par point ACTIF abonné (idempotent : @@unique([endpointId, eventId]),
 * un job rejoué ne crée ni doublon ni second envoi). Données personnelles retirées si le point n'y a pas droit
 * (option du point ET créateur toujours membre avec customers.view), décidé au moment de l'événement.
 */
export async function fanoutEvent(p: FanoutPayload): Promise<{ created: number }> {
  if (!p.storeId || !p.eventId || !isWebhookEvent(p.event)) return { created: 0 };
  const store = await db.store.findUnique({ where: { id: p.storeId }, select: { id: true, status: true, subscription: true } });
  if (!store || store.status === "ARCHIVED") return { created: 0 };
  if (!PLANS[effectivePlanId(store.subscription)].features.webhooks) return { created: 0 };
  const endpoints = await db.webhookEndpoint.findMany({ where: { storeId: p.storeId, active: true, events: { has: p.event } }, select: { id: true, includePersonalData: true, createdById: true } });
  if (!endpoints.length) return { created: 0 };

  const creators = [...new Set(endpoints.filter((e) => e.includePersonalData && e.createdById).map((e) => e.createdById!))];
  const members = creators.length ? await db.membership.findMany({ where: { storeId: p.storeId, userId: { in: creators } }, select: { userId: true, role: true, expiresAt: true } }) : [];
  const now = new Date();
  const piiAllowed = new Set(members.filter((m) => (!m.expiresAt || m.expiresAt > now) && canViewCustomers(m.role)).map((m) => m.userId));

  let created = 0;
  for (const ep of endpoints) {
    const body: WebhookBody = buildWebhookBody({
      eventId: p.eventId,
      event: p.event,
      createdAt: p.createdAt ?? now.toISOString(),
      storeId: p.storeId,
      data: p.data ?? {},
      includePersonalData: ep.includePersonalData && !!ep.createdById && piiAllowed.has(ep.createdById),
    });
    await db.$transaction(async (tx) => {
      const r = await tx.webhookDelivery.createMany({ data: [{ storeId: p.storeId, endpointId: ep.id, eventId: p.eventId, event: p.event, payload: body as unknown as Prisma.InputJsonValue }], skipDuplicates: true });
      if (!r.count) return;
      const row = await tx.webhookDelivery.findUniqueOrThrow({ where: { endpointId_eventId: { endpointId: ep.id, eventId: p.eventId } }, select: { id: true } });
      await enqueue("webhook.deliver", { deliveryId: row.id }, { storeId: p.storeId }, tx);
      created++;
    });
  }
  return { created };
}

export type DeliverOutcome = { outcome: "skipped" | "succeeded" | "retry" | "dead" | "endpoint_inactive"; result?: SendResult };

/**
 * `webhook.deliver` : réclame la livraison (bail de 2 min, verrou optimiste), signe, envoie, puis programme la
 * relance (nouveau job à l'échéance) ou passe en DEAD. Ne lève pas d'exception pour un échec HTTP : le calendrier
 * de relances est le nôtre (1 min → 24 h), pas celui du worker générique.
 */
export async function deliverWebhook(deliveryId: string, deps: { send?: typeof sendSignedRequest; now?: () => Date } = {}): Promise<DeliverOutcome> {
  const now = deps.now?.() ?? new Date();
  const claimed = await db.webhookDelivery.updateMany({
    where: { id: deliveryId, status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS) },
  });
  if (!claimed.count) return { outcome: "skipped" };
  const d = await db.webhookDelivery.findUnique({
    where: { id: deliveryId },
    select: { id: true, storeId: true, eventId: true, event: true, payload: true, attempts: true, endpoint: { select: { id: true, url: true, secretEnc: true, active: true } } },
  });
  if (!d) return { outcome: "skipped" };
  if (!d.endpoint.active) {
    await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "FAILED", lastError: "Point de webhook désactivé : livraison suspendue (rejouable après réactivation)." } });
    return { outcome: "endpoint_inactive" };
  }

  const body = JSON.stringify(d.payload);
  const ts = Math.floor(now.getTime() / 1000);
  const secrets = signingSecrets(decodeKeyring(decryptSecret(d.endpoint.secretEnc)), now);
  const headers = {
    "Axi-Webhook-Id": d.eventId,
    "Axi-Event": d.event,
    "Axi-Delivery-Id": d.id,
    "Axi-Signature": signatureHeader(secrets, ts, body),
    "Axi-Api-Version": WEBHOOK_API_VERSION,
  };
  const result = await (deps.send ?? sendSignedRequest)(d.endpoint.url, body, headers);
  const attempts = d.attempts + 1;
  const common = { attempts, lastStatusCode: result.status, lastError: result.error?.slice(0, 500) ?? null, responseSnippet: result.snippet, durationMs: Math.round(result.durationMs) };

  if (result.ok) {
    await db.$transaction([
      db.webhookDelivery.update({ where: { id: d.id }, data: { ...common, status: "SUCCEEDED", deliveredAt: new Date() } }),
      db.webhookEndpoint.update({ where: { id: d.endpoint.id }, data: { consecutiveFailures: 0, lastSuccessAt: new Date() } }),
    ]);
    return { outcome: "succeeded", result };
  }

  const delay = retryDelayMs(attempts);
  const nextAt = delay == null ? null : new Date(now.getTime() + delay);
  const ep = await db.$transaction(async (tx) => {
    await tx.webhookDelivery.update({ where: { id: d.id }, data: { ...common, status: nextAt ? "FAILED" : "DEAD", ...(nextAt ? { nextAttemptAt: nextAt } : {}) } });
    if (nextAt) await enqueue("webhook.deliver", { deliveryId: d.id }, { storeId: d.storeId, runAt: nextAt }, tx);
    return tx.webhookEndpoint.update({ where: { id: d.endpoint.id }, data: { consecutiveFailures: { increment: 1 }, lastFailureAt: new Date() }, select: { id: true, consecutiveFailures: true, lastSuccessAt: true, createdAt: true, url: true } });
  });
  await maybeDisableEndpoint(d.storeId, ep, now);
  return { outcome: nextAt ? "retry" : "dead", result };
}

async function maybeDisableEndpoint(storeId: string, ep: { id: string; consecutiveFailures: number; lastSuccessAt: Date | null; url: string }, now: Date) {
  if (ep.consecutiveFailures < DISABLE_AFTER_FAILURES) return;
  // Début de la série : plus ancienne livraison non réussie depuis le dernier succès.
  const oldest = await db.webhookDelivery.findFirst({
    where: { endpointId: ep.id, status: { not: "SUCCEEDED" }, attempts: { gt: 0 }, ...(ep.lastSuccessAt ? { createdAt: { gt: ep.lastSuccessAt } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!shouldDisableEndpoint(ep.consecutiveFailures, oldest?.createdAt ?? null, now)) return;
  const reason = `Désactivé automatiquement après ${ep.consecutiveFailures} échecs consécutifs sur plus de 72 h.`;
  const r = await db.webhookEndpoint.updateMany({ where: { id: ep.id, storeId, active: true }, data: { active: false, disabledAt: now, disabledReason: reason } });
  if (!r.count) return;
  const store = await db.store.findUnique({ where: { id: storeId }, select: { contactEmail: true, name: true } });
  const href = `/app/${storeId}/integrations/webhooks`;
  const { notifyStore } = await import("@/lib/notifications/service");
  await notifyStore(storeId, { kind: "other", key: `webhook-disabled:${ep.id}:${now.toISOString().slice(0, 10)}`, title: "Webhook désactivé", text: `${ep.url} ne répond plus correctement. ${reason} Corrigez-le puis réactivez-le.`, href });
  if (store?.contactEmail) {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await queueNotification(storeId, "email", store.contactEmail, "merchant.webhook_disabled", {
      subject: `Webhook désactivé sur ${store.name}`,
      text: `Votre point de webhook ${ep.url} a été désactivé automatiquement.\n\n${reason}\n\nVérifiez votre serveur puis réactivez-le : ${base}${href}`,
    });
    await enqueue("notification.send", {});
  }
  await audit({ storeId, actorId: null, action: "webhook.endpoint_auto_disabled", target: ep.id, metadata: { consecutiveFailures: ep.consecutiveFailures } });
}

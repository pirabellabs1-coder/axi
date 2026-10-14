"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore, effectivePlanId, type StoreContext } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zRawId, badIds, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { PLANS } from "@/config/plans";
import { parseMoneyInput } from "@/lib/money";
import { clientIp, rateLimitAll, rateLimitMessage } from "@/lib/rate-limit";
import { StoreCreditError } from "@/lib/store-credit/errors";
import { buyerResolutions, ITEM_CONDITION_KEYS, parseReturnPolicy, parseTagList, returnPolicySchema, RETURN_REASON_KEYS } from "./policy";
import {
  approveReturn as approveSvc,
  cancelReturn as cancelSvc,
  createReturnTx,
  quoteReturn,
  receiveReturn as receiveSvc,
  rejectReturn as rejectSvc,
  resolveReturn as resolveSvc,
  ReturnError,
  type ActorInfo,
} from "./service";

/**
 * Actions serveur des retours (spec lot 1 §4, §6).
 *  - Commerçant : requireStore(capacité) + filtre storeId ; returns.manage, sauf la réception (returns.receive).
 *  - Acheteur (publiques) : jeton de suivi (preuve de possession de la commande) OU session acheteur de la boutique ;
 *    débit limité ; libre-service soumis à la politique active et au plan (returnsPortal).
 * Les transitions, l'audit et le job `return.status_changed` sont écrits par le service, dans la même transaction.
 */

function toFail(e: unknown): ActionResult<never> | null {
  if (e instanceof ReturnError) return fail(e.message, e.field ? { [e.field]: [e.message] } : undefined);
  if (e instanceof StoreCreditError) return fail(e.message);
  return null;
}

async function run<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  return guard(async () => {
    try {
      return await fn();
    } catch (e) {
      const f = toFail(e);
      if (f) return f;
      throw e;
    }
  });
}

const merchantActor = (ctx: StoreContext): ActorInfo => ({ kind: "merchant", id: ctx.user.id, label: ctx.user.name });
const CUSTOMER_ACTOR: ActorInfo = { kind: "customer", id: null, label: "Client" };

function revalidateReturn(storeId: string, returnId?: string, orderId?: string) {
  revalidatePath(`/app/${storeId}/retours`);
  if (returnId) revalidatePath(`/app/${storeId}/retours/${returnId}`);
  if (orderId) revalidatePath(`/app/${storeId}/commandes/${orderId}`);
}

/** JSON reçu dans un champ de formulaire (listes d'articles, photos). */
const jsonField = <S extends z.ZodTypeAny>(schema: S) =>
  z.preprocess((v) => {
    if (typeof v !== "string" || v.length > 20_000) return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, schema);

const zQty = z.coerce.number({ message: "Quantité invalide" }).int("Quantité invalide").min(0).max(10_000);
const zNote = z.string().trim().max(1000, "1 000 caractères maximum").optional().default("");

/* ───────────────────────── Commerçant ───────────────────────── */

const createSchema = z.object({
  storeId: zRawId,
  orderId: zRawId,
  mode: z.enum(["APPROVED", "RECEIVED"]),
  reason: z.enum(RETURN_REASON_KEYS, { message: "Choisissez un motif" }),
  note: zNote,
  items: jsonField(
    z
      .array(z.object({ orderItemId: zRawId, quantity: zQty, restock: z.boolean().optional(), condition: z.enum(ITEM_CONDITION_KEYS).optional() }))
      .max(50),
  ),
});

/** Retour créé par le commerçant (retour en boutique) : directement APPROVED ou RECEIVED. */
export async function createReturn(_prev: ActionResult<{ id: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const parsed = parseForm(createSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "returns.manage");
    if (!PLANS[ctx.planId].features.returnsPortal) {
      return fail(`Les retours sont inclus à partir du plan Business. Changez de plan : /app/${ctx.store.id}/abonnement`);
    }
    const items = d.items.filter((i) => i.quantity > 0);
    if (!items.length) return fail("Choisissez au moins un article à retourner.", { items: ["Choisissez au moins un article"] });
    const created = await db.$transaction((tx) =>
      createReturnTx(tx, {
        storeId: ctx.store.id,
        orderId: d.orderId,
        policy: parseReturnPolicy(ctx.store.returnPolicy),
        actor: merchantActor(ctx),
        initialStatus: d.mode,
        reason: d.reason,
        merchantNote: d.note || null,
        items: items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity, restock: i.restock ?? true, condition: i.condition ?? null })),
      }),
    );
    revalidateReturn(ctx.store.id, created.id, d.orderId);
    return success({ id: created.id }, `Retour ${created.reference} créé`);
  });
}

export async function approveReturn(storeId: string, returnId: string, note?: string): Promise<ActionResult> {
  return run(async () => {
    const bad = badIds(storeId, returnId);
    if (bad) return bad;
    const n = z.string().trim().max(1000).optional().parse(note || undefined);
    const ctx = await requireStore(storeId, "returns.manage");
    const r = await approveSvc({ storeId: ctx.store.id, returnId, actor: merchantActor(ctx), note: n ?? null });
    revalidateReturn(ctx.store.id, returnId, r.orderId);
    return success(undefined, `Retour ${r.reference} approuvé`);
  });
}

const rejectSchema = z.object({ storeId: zRawId, returnId: zRawId, reason: z.string().trim().min(3, "Indiquez le motif du refus (3 caractères minimum)").max(1000) });

export async function rejectReturn(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const parsed = parseForm(rejectSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "returns.manage");
    const r = await rejectSvc({ storeId: ctx.store.id, returnId: parsed.data.returnId, actor: merchantActor(ctx), reason: parsed.data.reason });
    revalidateReturn(ctx.store.id, parsed.data.returnId, r.orderId);
    return success(undefined, `Retour ${r.reference} refusé`);
  });
}

export async function cancelReturn(storeId: string, returnId: string): Promise<ActionResult> {
  return run(async () => {
    const bad = badIds(storeId, returnId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "returns.manage");
    const r = await cancelSvc({ storeId: ctx.store.id, returnId, actor: merchantActor(ctx) });
    revalidateReturn(ctx.store.id, returnId, r.orderId);
    return success(undefined, `Retour ${r.reference} annulé`);
  });
}

const receiveSchema = z.object({
  storeId: zRawId,
  returnId: zRawId,
  note: zNote,
  lines: jsonField(z.array(z.object({ returnItemId: zRawId, receivedQty: zQty, condition: z.enum(ITEM_CONDITION_KEYS), restock: z.boolean() })).min(1).max(50)),
});

export async function receiveReturn(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const parsed = parseForm(receiveSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "returns.receive");
    const r = await receiveSvc({ storeId: ctx.store.id, returnId: d.returnId, actor: merchantActor(ctx), lines: d.lines, note: d.note || null });
    revalidateReturn(ctx.store.id, d.returnId);
    return success(undefined, r.restocked > 0 ? `Réception enregistrée, ${r.restocked} unité${r.restocked > 1 ? "s" : ""} remise${r.restocked > 1 ? "s" : ""} en stock` : "Réception enregistrée");
  });
}

const resolveSchema = z.object({
  storeId: zRawId,
  returnId: zRawId,
  resolution: z.enum(["REFUND", "STORE_CREDIT", "EXCHANGE", "NONE"], { message: "Choisissez une résolution" }),
  refundShipping: zBool,
  waiveRestockingFee: zBool,
  amount: z.string().trim().max(20).optional().default(""),
  note: zNote,
  exchangeVariants: jsonField(z.record(zRawId, zRawId.nullable())).optional(),
});

export async function resolveReturn(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const parsed = parseForm(resolveSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "returns.manage");
    if (d.resolution === "REFUND" && !ctx.can("payments.confirm")) return fail("Votre rôle ne permet pas d'enregistrer un remboursement.");
    let amount: number | null = null;
    if (d.amount) {
      amount = parseMoneyInput(d.amount, ctx.store.currency);
      if (amount == null) return fail("Montant invalide", { amount: ["Montant invalide"] });
    }
    const r = await resolveSvc({
      storeId: ctx.store.id,
      returnId: d.returnId,
      actor: merchantActor(ctx),
      policy: parseReturnPolicy(ctx.store.returnPolicy),
      resolution: d.resolution,
      refundShipping: d.refundShipping,
      waiveRestockingFee: d.waiveRestockingFee,
      amount,
      note: d.note || null,
      exchangeVariants: d.exchangeVariants,
    });
    revalidateReturn(ctx.store.id, d.returnId);
    const msg =
      r.resolution === "REFUND" ? "Remboursement enregistré" : r.resolution === "STORE_CREDIT" ? "Avoir accordé" : r.resolution === "EXCHANGE" ? `Commande d'échange ${r.exchangeReference} créée` : "Retour clôturé";
    return success(undefined, `${r.reference} : ${msg}`);
  });
}

export type QuoteView = { merchandise: number; restockingFee: number; shipping: number; cap: number; amount: number; capped: boolean; fullReturn: boolean; paid: boolean; storeCredit: number };

/** Calcul suggéré (aperçu de la résolution quand le commerçant change les options). */
export async function quoteReturnAction(storeId: string, returnId: string, opts: { refundShipping: boolean; waiveRestockingFee: boolean }): Promise<ActionResult<QuoteView>> {
  return run(async () => {
    const bad = badIds(storeId, returnId);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "orders.view");
    const policy = parseReturnPolicy(ctx.store.returnPolicy);
    const q = await quoteReturn(db, ctx.store.id, returnId, { refundShipping: !!opts?.refundShipping, waiveRestockingFee: !!opts?.waiveRestockingFee, restockingFeePercent: policy.restockingFeePercent });
    const { storeCreditWithBonus } = await import("./amounts");
    return success({ merchandise: q.merchandise, restockingFee: q.restockingFee, shipping: q.shipping, cap: q.cap, amount: q.amount, capped: q.capped, fullReturn: q.fullReturn, paid: q.paid, storeCredit: storeCreditWithBonus(q.amount, policy.storeCreditBonusPercent) });
  });
}

/* ───────────────────────── Réglages ───────────────────────── */

const policyFormSchema = z.object({
  storeId: zRawId,
  enabled: zBool,
  windowDays: z.coerce.number({ message: "Nombre attendu" }).int("Nombre entier attendu").min(1, "1 jour minimum").max(90, "90 jours maximum"),
  allowRefund: zBool,
  allowStoreCredit: zBool,
  allowExchange: zBool,
  storeCreditBonusPercent: z.coerce.number({ message: "Nombre attendu" }).int("Nombre entier attendu").min(0, "0 % minimum").max(20, "20 % maximum"),
  restockingFeePercent: z.coerce.number({ message: "Nombre attendu" }).int("Nombre entier attendu").min(0, "0 % minimum").max(30, "30 % maximum"),
  nonReturnableTags: z.string().max(2000).optional().default(""),
  requirePhotos: zBool,
  returnShippingPaidBy: z.enum(["customer", "merchant"]),
  instructions: z.string().trim().max(1000, "1 000 caractères maximum").optional().default(""),
});

export async function saveReturnPolicy(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const parsed = parseForm(policyFormSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "store.settings");
    // La désactivation reste toujours possible après une baisse de plan ; l'activation exige returnsPortal.
    if (d.enabled && !PLANS[ctx.planId].features.returnsPortal) {
      return fail(`Les retours en libre-service sont inclus à partir du plan Business. Changez de plan : /app/${ctx.store.id}/abonnement`);
    }
    if (d.enabled && !d.allowRefund && !d.allowStoreCredit && !d.allowExchange) {
      return fail("Proposez au moins une résolution (remboursement, avoir ou échange).", { allowRefund: ["Au moins une résolution"] });
    }
    const policy = returnPolicySchema.parse({ ...d, storeId: undefined, nonReturnableTags: parseTagList(d.nonReturnableTags) });
    const before = parseReturnPolicy(ctx.store.returnPolicy);
    await db.store.update({ where: { id: ctx.store.id }, data: { returnPolicy: policy as unknown as Prisma.InputJsonValue } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "returns.policy_updated", metadata: { before, after: policy } });
    revalidatePath(`/app/${ctx.store.id}/parametres/retours`);
    revalidatePath(`/app/${ctx.store.id}/retours`);
    return success(undefined, policy.enabled ? "Politique de retours enregistrée" : "Retours en libre-service désactivés");
  });
}

/* ───────────────────────── Acheteur (publiques) ───────────────────────── */

const TOKEN_RE = /^[0-9a-f]{16,128}$/;
const REF_RE = /^[A-Z0-9-]{4,24}$/;

type BuyerOrder = {
  order: { id: string; storeId: string; reference: string; trackingToken: string };
  store: { id: string; slug: string; status: string; returnPolicy: unknown; planId: ReturnType<typeof effectivePlanId> };
  via: "token" | "session";
};

/**
 * Preuve de possession : jeton de suivi non expiré, ou session acheteur de CETTE boutique propriétaire de la commande.
 * Message unique en cas d'échec (pas d'énumération des commandes).
 */
async function resolveBuyerOrder(input: { token?: string; slug?: string; reference?: string }): Promise<BuyerOrder | null> {
  const select = {
    id: true, storeId: true, reference: true, trackingToken: true, trackingExpiresAt: true, customerId: true,
    store: { select: { id: true, slug: true, status: true, returnPolicy: true, subscription: true } },
  } as const;
  if (input.token) {
    if (!TOKEN_RE.test(input.token)) return null;
    const order = await db.order.findUnique({ where: { trackingToken: input.token }, select });
    if (!order || order.trackingExpiresAt.getTime() < Date.now()) return null;
    if (input.slug && input.slug !== order.store.slug) return null;
    return { order, store: { ...order.store, planId: effectivePlanId(order.store.subscription) }, via: "token" };
  }
  if (!input.slug || !input.reference || !REF_RE.test(input.reference) || input.slug.length > 64) return null;
  const store = await db.store.findUnique({ where: { slug: input.slug }, select: { id: true, slug: true } });
  if (!store) return null;
  const { getBuyer } = await import("@/lib/buyer/session");
  const buyer = await getBuyer(store);
  if (!buyer) return null;
  const order = await db.order.findFirst({ where: { storeId: store.id, reference: input.reference, customerId: buyer.customerId }, select });
  if (!order) return null;
  return { order, store: { ...order.store, planId: effectivePlanId(order.store.subscription) }, via: "session" };
}

const NOT_FOUND = "Commande introuvable ou lien expiré.";

const requestSchema = z.object({
  token: z.string().max(128).optional(),
  slug: z.string().max(64).optional(),
  reference: z.string().max(24).optional(),
  reason: z.enum(RETURN_REASON_KEYS, { message: "Choisissez un motif" }),
  resolution: z.enum(["REFUND", "STORE_CREDIT", "EXCHANGE"], { message: "Choisissez ce que vous souhaitez" }),
  note: zNote,
  items: jsonField(z.array(z.object({ orderItemId: zRawId, quantity: zQty, exchangeVariantId: zRawId.nullable().optional() })).max(50)),
  photos: jsonField(z.array(z.string().max(500)).max(3, "3 photos maximum")).optional(),
});

export async function requestReturn(_prev: ActionResult<{ reference: string }> | undefined, formData: FormData): Promise<ActionResult<{ reference: string }>> {
  return run(async () => {
    const parsed = parseForm(requestSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const found = await resolveBuyerOrder({ token: d.token || undefined, slug: d.slug || undefined, reference: d.reference || undefined });
    if (!found) return fail(NOT_FOUND);
    const { order, store } = found;
    if (store.status !== "PUBLISHED") return fail("Cette boutique n'accepte pas de demande pour le moment.");
    const policy = parseReturnPolicy(store.returnPolicy);
    if (!policy.enabled || !PLANS[store.planId].features.returnsPortal) return fail("Cette boutique n'accepte pas les demandes de retour en ligne. Contactez-la directement.");
    if (!buyerResolutions(policy).includes(d.resolution)) return fail("Cette option n'est pas proposée par la boutique.", { resolution: ["Option non proposée"] });

    const rl = await rateLimitAll([
      { key: `returns:ip:${await clientIp()}`, limit: 10, windowSec: 3600 },
      { key: `returns:order:${order.id}`, limit: 5, windowSec: 3600 },
      { key: `returns:store:${store.id}`, limit: 300, windowSec: 3600 },
    ]);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const items = d.items.filter((i) => i.quantity > 0);
    if (!items.length) return fail("Choisissez au moins un article à retourner.", { items: ["Choisissez au moins un article"] });
    const created = await db.$transaction((tx) =>
      createReturnTx(tx, {
        storeId: store.id,
        orderId: order.id,
        policy,
        actor: CUSTOMER_ACTOR,
        initialStatus: "REQUESTED",
        reason: d.reason,
        desiredResolution: d.resolution,
        customerNote: d.note || null,
        photos: d.photos ?? [],
        items: items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity, exchangeVariantId: d.resolution === "EXCHANGE" ? (i.exchangeVariantId ?? null) : null })),
      }),
    );
    revalidatePath(`/suivi/${order.trackingToken}/retour`);
    revalidatePath(`/s/${store.slug}/compte/retours`);
    revalidateReturn(store.id);
    return success({ reference: created.reference }, `Demande ${created.reference} envoyée`);
  });
}

const cancelMineSchema = z.object({ token: z.string().max(128).optional(), slug: z.string().max(64).optional(), reference: z.string().max(24).optional(), returnId: zRawId });

export async function cancelMyReturn(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const parsed = parseForm(cancelMineSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const found = await resolveBuyerOrder({ token: d.token || undefined, slug: d.slug || undefined, reference: d.reference || undefined });
    if (!found) return fail(NOT_FOUND);
    if (found.store.status === "SUSPENDED" || found.store.status === "ARCHIVED") return fail(NOT_FOUND);
    // Le retour doit appartenir à CETTE commande (et donc à cette boutique).
    const ret = await db.returnRequest.findFirst({ where: { id: d.returnId, storeId: found.store.id, orderId: found.order.id }, select: { id: true } });
    if (!ret) return fail("Retour introuvable.");
    const r = await cancelSvc({ storeId: found.store.id, returnId: ret.id, actor: CUSTOMER_ACTOR });
    revalidatePath(`/suivi/${found.order.trackingToken}/retour`);
    revalidatePath(`/s/${found.store.slug}/compte/retours`);
    revalidateReturn(found.store.id, ret.id);
    return success(undefined, `Demande ${r.reference} annulée`);
  });
}
